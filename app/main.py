import asyncio
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "trafficsense.db"
SEGMENTS_PATH = BASE_DIR / "seed" / "segments.json"
RAIN_FALLBACK_PATH = BASE_DIR / "fallback" / "rain_cache.json"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

app = FastAPI(title="TrafficSense Track B Backend")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, payload: dict) -> None:
        stale: list[WebSocket] = []
        for ws in self.active:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(ws)


ws_manager = ConnectionManager()
_weather_cache: dict[str, tuple[float, dict]] = {}


class TelemetryPing(BaseModel):
    segment_id: str = Field(pattern=r"^SEG_\d{3}$")
    speed_kmh: float = Field(ge=0, le=200)
    stopped_duration_sec: Optional[float] = Field(default=None, ge=0)
    vehicle_type: Literal["commuter", "bus", "taxi", "delivery", "unknown"] = "commuter"
    lat: Optional[float] = None
    lon: Optional[float] = None
    timestamp: str


class ComplaintPayload(BaseModel):
    segment_id: str = Field(pattern=r"^SEG_\d{3}$")
    category: Literal["waterlogging", "accident", "blockage", "construction", "other"]
    description: Optional[str] = Field(default=None, max_length=500)
    photo_url: Optional[str] = None
    reporter_type: Literal["commuter", "fleet"] = "commuter"
    timestamp: str


class CCTVEvent(BaseModel):
    source: Literal["cctv"] = "cctv"
    segment_id: str = Field(pattern=r"^SEG_\d{3}$")
    timestamp: str
    frame_range: Optional[list[int]] = None
    vehicle_count: int = Field(ge=0)
    stopped_count: int = Field(ge=0)
    slow_count: int = Field(ge=0)
    anomaly_confidence: float = Field(ge=0.0, le=1.0)
    dominant_class: Optional[Literal["car", "truck", "bus", "motorcycle", "mixed", "unknown"]] = "mixed"
    raw_classes: Optional[dict[str, int]] = None
    model: str = "yolov8n.pt"


class AuthorityAction(BaseModel):
    segment_id: str = Field(pattern=r"^SEG_\d{3}$")
    action: Literal["close", "divert", "dispatch", "resolve", "monitor"]
    officer_id: str
    note: Optional[str] = Field(default=None, max_length=300)
    timestamp: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def load_segments() -> list[dict]:
    if not SEGMENTS_PATH.exists():
        return []
    raw = json.loads(SEGMENTS_PATH.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        return raw.get("segments", [])
    return raw


def current_baseline_speed(seg: dict) -> float:
    baselines = seg.get("baseline_speed_kmh") or {}
    if not isinstance(baselines, dict) or not baselines:
        return 30.0
    hour_str = f"{datetime.now(timezone.utc).hour:02d}"
    if hour_str in baselines:
        return float(baselines[hour_str])
    keys = sorted(baselines.keys(), key=lambda k: abs(int(k) - int(hour_str)))
    return float(baselines[keys[0]])


def init_db() -> None:
    segments = load_segments()
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS central_state (
                segment_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                stage INTEGER NOT NULL,
                confidence REAL NOT NULL,
                reason TEXT NOT NULL,
                disruption_type TEXT NOT NULL,
                affected_count INTEGER NOT NULL,
                suggested_action TEXT NOT NULL,
                priority_score REAL NOT NULL,
                authority_action TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events_log (
                event_id TEXT PRIMARY KEY,
                segment_id TEXT NOT NULL,
                source TEXT NOT NULL,
                signal_type TEXT NOT NULL,
                weight REAL NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        ts = now_iso()
        for seg in segments:
            sid = seg.get("segment_id")
            if not sid:
                continue
            conn.execute(
                """
                INSERT OR IGNORE INTO central_state (
                    segment_id, state, stage, confidence, reason,
                    disruption_type, affected_count, suggested_action, priority_score, authority_action, updated_at
                ) VALUES (?, 'GREEN', 0, 0.0, 'normal_flow', 'congestion', 0, 'monitor', 0.0, NULL, ?)
                """,
                (sid, ts),
            )
        conn.commit()


def recalculate_segment(conn: sqlite3.Connection, segment_id: str, disruption_type: str = "congestion") -> dict:
    row = conn.execute("SELECT * FROM central_state WHERE segment_id = ?", (segment_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Unknown segment_id: {segment_id}")

    recent_events = conn.execute(
        "SELECT * FROM events_log WHERE segment_id = ? ORDER BY created_at DESC LIMIT 10",
        (segment_id,),
    ).fetchall()

    weighted_sum = sum(float(ev["weight"]) for ev in recent_events)
    count = len(recent_events)
    confidence = round(min(1.0, weighted_sum * 0.35), 2)

    if confidence >= 0.60 or count >= 3:
        state = "RED"
        stage = 2
        suggested_action = "reroute"
    elif confidence >= 0.25 or count >= 1:
        state = "YELLOW"
        stage = 1
        suggested_action = "monitor"
    else:
        state = "GREEN"
        stage = 0
        suggested_action = "monitor"

    reasons = list(dict.fromkeys(ev["signal_type"] for ev in recent_events[:3])) or ["normal_flow"]
    reason = " + ".join(reasons)
    affected_count = max(int(row["affected_count"]), count)
    priority_score = round(affected_count * max(stage, 1) * confidence, 2)
    ts = now_iso()

    conn.execute(
        """
        UPDATE central_state
        SET state = ?, stage = ?, confidence = ?, reason = ?, disruption_type = ?,
            affected_count = ?, suggested_action = ?, priority_score = ?, updated_at = ?
        WHERE segment_id = ?
        """,
        (
            state,
            stage,
            confidence,
            reason,
            disruption_type,
            affected_count,
            suggested_action,
            priority_score,
            ts,
            segment_id,
        ),
    )
    conn.commit()
    updated = dict(conn.execute("SELECT * FROM central_state WHERE segment_id = ?", (segment_id,)).fetchone())
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(ws_manager.broadcast(updated))
    except RuntimeError:
        pass
    return updated


def load_fallback_rain() -> dict[str, dict]:
    if not RAIN_FALLBACK_PATH.exists():
        return {}
    raw = json.loads(RAIN_FALLBACK_PATH.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return {item["segment_id"]: item for item in raw if "segment_id" in item}
    if isinstance(raw, dict):
        return raw
    return {}


async def fetch_segment_weather(client: httpx.AsyncClient, seg: dict) -> dict:
    sid = seg["segment_id"]
    now_ts = datetime.now(timezone.utc).timestamp()
    cached = _weather_cache.get(sid)
    if cached and (now_ts - cached[0]) < 60.0:
        reading = dict(cached[1])
        reading["source"] = "cache"
        return reading

    lat = seg.get("lat_start", 13.06)
    lon = seg.get("lon_start", 80.27)
    try:
        resp = await client.get(
            OPEN_METEO_URL,
            params={"latitude": lat, "longitude": lon, "current": "rain,precipitation"},
            timeout=3.0,
        )
        resp.raise_for_status()
        current = resp.json().get("current") or {}
        rain_val = float(current.get("rain", current.get("precipitation", 0.0)) or 0.0)
        reading = {
            "segment_id": sid,
            "rain_mm_per_hour": rain_val,
            "rain_1h_accumulated_mm": rain_val,
            "fetched_at": now_iso(),
            "source": "open_meteo",
        }
        _weather_cache[sid] = (now_ts, reading)
        return reading
    except Exception:
        fallback = load_fallback_rain().get(sid)
        if fallback:
            return {
                "segment_id": sid,
                "rain_mm_per_hour": float(fallback.get("rain_mm_per_hour", 0.0)),
                "rain_1h_accumulated_mm": float(fallback.get("rain_1h_accumulated_mm", fallback.get("rain_mm_per_hour", 0.0))),
                "fetched_at": now_iso(),
                "source": "fallback_file",
            }
        return {
            "segment_id": sid,
            "rain_mm_per_hour": 0.0,
            "rain_1h_accumulated_mm": 0.0,
            "fetched_at": now_iso(),
            "source": "fallback_file",
        }


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/segments")
def get_segments() -> list[dict]:
    return load_segments()


@app.get("/api/state")
def get_all_state() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM central_state ORDER BY priority_score DESC, segment_id ASC").fetchall()
        return [dict(r) for r in rows]


@app.get("/api/state/{segment_id}")
def get_segment_state(segment_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM central_state WHERE segment_id = ?", (segment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Unknown segment_id: {segment_id}")
        return dict(row)


@app.get("/api/weather/current")
async def get_weather_current() -> list[dict]:
    segments = [s for s in load_segments() if s.get("segment_id")]
    readings: list[dict] = []
    async with httpx.AsyncClient() as client:
        for seg in segments:
            reading = await fetch_segment_weather(client, seg)
            readings.append(reading)
            threshold = float(seg.get("flood_rain_threshold_mm") or 15.0)
            rain_mm = float(reading.get("rain_1h_accumulated_mm") or 0.0)
            if seg.get("flood_prone") and rain_mm >= threshold:
                event_id = str(uuid.uuid4())
                with get_conn() as conn:
                    conn.execute(
                        "INSERT INTO events_log (event_id, segment_id, source, signal_type, weight, created_at) VALUES (?, ?, 'weather', 'rain_threshold', 0.8, ?)",
                        (event_id, seg["segment_id"], now_iso()),
                    )
                    recalculate_segment(conn, seg["segment_id"], disruption_type="waterlogging")
    return readings


@app.post("/api/ingest/telemetry")
def ingest_telemetry(ping: TelemetryPing) -> dict:
    seg_map = {s.get("segment_id"): s for s in load_segments() if s.get("segment_id")}
    if seg_map and ping.segment_id not in seg_map:
        raise HTTPException(status_code=404, detail=f"Unknown segment_id: {ping.segment_id}")

    baseline = current_baseline_speed(seg_map.get(ping.segment_id, {}))
    is_stopped = (ping.stopped_duration_sec is not None and ping.stopped_duration_sec >= 30) or ping.speed_kmh == 0
    is_slow = ping.speed_kmh < baseline * 0.55

    if not is_stopped and not is_slow:
        return {"event_id": None, "status": "ignored_normal_speed"}

    signal_type = "stopped" if is_stopped else "speed_drop"
    base_weight = 1.5 if ping.vehicle_type in ("bus", "taxi", "delivery") else 1.0
    event_id = str(uuid.uuid4())

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO events_log (event_id, segment_id, source, signal_type, weight, created_at) VALUES (?, ?, 'telemetry', ?, ?, ?)",
            (event_id, ping.segment_id, signal_type, base_weight, now_iso()),
        )
        recalculate_segment(conn, ping.segment_id, disruption_type="congestion")

    return {"event_id": event_id, "status": "queued"}


@app.post("/api/ingest/complaint")
def ingest_complaint(complaint: ComplaintPayload) -> dict:
    seg_map = {s.get("segment_id"): s for s in load_segments() if s.get("segment_id")}
    if seg_map and complaint.segment_id not in seg_map:
        raise HTTPException(status_code=404, detail=f"Unknown segment_id: {complaint.segment_id}")

    complaint_id = str(uuid.uuid4())
    weight = 1.5 if complaint.reporter_type == "fleet" else 1.0
    disruption = "congestion" if complaint.category == "other" else complaint.category

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO events_log (event_id, segment_id, source, signal_type, weight, created_at) VALUES (?, ?, 'complaint', 'complaint', ?, ?)",
            (complaint_id, complaint.segment_id, weight, now_iso()),
        )
        recalculate_segment(conn, complaint.segment_id, disruption_type=disruption)

    return {"complaint_id": complaint_id, "status": "queued"}


@app.post("/api/ingest/cctv")
def ingest_cctv(event: CCTVEvent) -> dict:
    seg_map = {s.get("segment_id"): s for s in load_segments() if s.get("segment_id")}
    if seg_map and event.segment_id not in seg_map:
        raise HTTPException(status_code=404, detail=f"Unknown segment_id: {event.segment_id}")

    if event.anomaly_confidence < 0.35 and event.stopped_count == 0:
        return {"event_id": None, "status": "ignored_normal_cctv"}

    event_id = str(uuid.uuid4())
    weight = 1.3 * (1.4 if event.anomaly_confidence >= 0.50 else 1.0)

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO events_log (event_id, segment_id, source, signal_type, weight, created_at) VALUES (?, ?, 'cctv', 'cctv_anomaly', ?, ?)",
            (event_id, event.segment_id, weight, now_iso()),
        )
        recalculate_segment(conn, event.segment_id, disruption_type="congestion")

    return {"event_id": event_id, "status": "queued"}


@app.post("/api/authority/action")
def apply_authority_action(act: AuthorityAction) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM central_state WHERE segment_id = ?", (act.segment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Unknown segment_id: {act.segment_id}")

        ts = now_iso()
        if act.action == "close":
            conn.execute(
                """
                UPDATE central_state
                SET state = 'RED', stage = 2, confidence = 1.0, reason = 'authority_close',
                    suggested_action = 'close', authority_action = 'close', updated_at = ?
                WHERE segment_id = ?
                """,
                (ts, act.segment_id),
            )
        elif act.action == "resolve":
            conn.execute("DELETE FROM events_log WHERE segment_id = ?", (act.segment_id,))
            conn.execute(
                """
                UPDATE central_state
                SET state = 'GREEN', stage = 0, confidence = 0.0, reason = 'resolved_by_authority',
                    affected_count = 0, suggested_action = 'monitor', priority_score = 0.0,
                    authority_action = 'resolve', updated_at = ?
                WHERE segment_id = ?
                """,
                (ts, act.segment_id),
            )
        else:
            conn.execute(
                """
                UPDATE central_state
                SET authority_action = ?, suggested_action = ?, updated_at = ?
                WHERE segment_id = ?
                """,
                (act.action, act.action, ts, act.segment_id),
            )
        conn.commit()
        updated = dict(conn.execute("SELECT * FROM central_state WHERE segment_id = ?", (act.segment_id,)).fetchone())

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(ws_manager.broadcast(updated))
    except RuntimeError:
        pass
    return {"status": "applied", "state": updated}


@app.websocket("/ws/state")
async def websocket_state(ws: WebSocket) -> None:
    await ws_manager.connect(ws)
    try:
        with get_conn() as conn:
            rows = [dict(r) for r in conn.execute("SELECT * FROM central_state ORDER BY priority_score DESC, segment_id ASC").fetchall()]
        await ws.send_json({"type": "snapshot", "segments": rows})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
    except Exception:
        ws_manager.disconnect(ws)
