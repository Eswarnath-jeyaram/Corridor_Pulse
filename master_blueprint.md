# 🚦 TrafficSense — Master Blueprint
### Software-Only Traffic & Road Disruption Management System
##### 24-Hour Hackathon | Problem Statement #3

---

> [!IMPORTANT]
> **This is the reviewed-and-approved-before-code-generation blueprint.** No code is written until you sign off on each section. Everything below is the single source of truth for all teammates regardless of location.

---

## Table of Contents
1. [System & Architecture Blueprint](#1-system--architecture-blueprint)
2. [Exact Build Order](#2-exact-build-order)
3. [Distributed Team Work Split](#3-distributed-team-work-split)
4. [End-to-End Live Demo Plan](#4-end-to-end-live-demo-plan)
5. [24-Hour Hackathon Wind-Down Plan](#5-24-hour-hackathon-wind-down-plan)

---

## 1. System & Architecture Blueprint

### 1.1 Pre-Trained Terminal CCTV / HIA Model

#### ✅ Recommended Model: `yolov8n.pt` (Ultralytics YOLOv8 Nano)

| Property | Detail |
|---|---|
| **Model** | `yolov8n.pt` — YOLOv8 Nano (pre-trained, COCO 80-class) |
| **Why** | < 6 MB, runs on CPU, no GPU needed, no training required, detects vehicles (car/truck/bus/motorbike) out-of-the-box |
| **Input** | Pre-recorded `.mp4` traffic sample video OR individual JPEG/PNG frames |
| **Install** | `pip install ultralytics opencv-python` |
| **Hardware** | Any laptop CPU; no camera or edge device needed |

#### Terminal Run Command
```bash
# Single command — runs the CCTV analyzer on a sample video
python cctv_runner.py --video sample_traffic.mp4 --segment SEG_001 --output events.jsonl
```

#### What `cctv_runner.py` Does (Logic Only — Code Generated Later)
1. Opens video with OpenCV frame by frame (every Nth frame = configurable skip)
2. Runs `yolov8n.pt` inference → gets bounding boxes for vehicles
3. Per sliding 10-second window:
   - **Vehicle count** in frame
   - **Slow/stopped flag**: if detected bounding box center barely moves between consecutive sampled frames → vehicle is stopped
   - **Anomaly confidence** (0.0–1.0): ratio of stopped/slow vehicles to total detected
4. Emits a JSON event line to `stdout` or `events.jsonl` **every 10 simulated seconds**

#### CCTV Event JSON Schema (Contract)
```json
{
  "source": "cctv",
  "segment_id": "SEG_001",
  "timestamp": "2026-11-27T10:15:00Z",
  "frame_range": [300, 600],
  "vehicle_count": 12,
  "stopped_count": 4,
  "slow_count": 3,
  "anomaly_confidence": 0.58,
  "dominant_class": "car",
  "raw_classes": {"car": 8, "truck": 2, "bus": 1, "motorcycle": 1}
}
```

#### How It Connects to Backend
```
cctv_runner.py  ──(HTTP POST /api/ingest/cctv)──►  Signal Normalizer
                OR
cctv_runner.py  ──(JSONL file/pipe)──────────────►  file_watcher.py → POST /api/ingest/cctv
```

The backend Signal Normalizer converts the CCTV event into the internal `NormalizedEvent` format (Section 1.4) exactly like any other source.

---

### 1.2 Full System Architecture Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LAYER 1 — INPUT SOURCES                              │
│                                                                             │
│  ┌──────────────┐  ┌────────────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │ CCTV Runner  │  │ Telemetry Ingest   │  │ Complaint    │  │ Rainfall │  │
│  │ (yolov8n.pt) │  │ (speed/stop pings) │  │ Ingest API   │  │ Fetcher  │  │
│  │ terminal CLI │  │ /api/ingest/telem  │  │ /api/ingest/ │  │ Open-    │  │
│  │ → HTTP POST  │  │                    │  │ complaint    │  │ Meteo    │  │
│  └──────┬───────┘  └─────────┬──────────┘  └──────┬───────┘  └────┬─────┘  │
│         │                    │                     │               │        │
└─────────┼────────────────────┼─────────────────────┼───────────────┼────────┘
          │                    │                     │               │
          ▼                    ▼                     ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     LAYER 2 — NORMALIZATION & STATE                         │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                   Signal Normalizer / Adapter                        │   │
│  │  Converts ALL sources → NormalizedEvent{segment_id, signal_type,    │   │
│  │  value, timestamp, source_weight}                                    │   │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │                                             │
│  ┌──────────────┐  ┌──────────▼──────────┐  ┌──────────────────────────┐   │
│  │ Road Network │  │  Raw Signals Buffer │  │  Historical Flood Zone   │   │
│  │ + Time-of-   │  │  (sliding window    │  │  + Rain Threshold DB     │   │
│  │ Day Baseline │  │   30-60 seconds)    │  │  (SQLite / JSON file)    │   │
│  │ DB           │  └──────────┬──────────┘  └────────────┬─────────────┘   │
│  └──────┬───────┘             │                           │                 │
│         └─────────────────────▼───────────────────────────▼                │
│                    Baseline & Flood Lookup Connector                        │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 3 — DECISION ENGINE (The Brain)                    │
│                                                                             │
│  ┌────────────────────────┐    ┌─────────────────────────────────────────┐  │
│  │ Early Speed-Anomaly    │    │ Flood Risk (YELLOW) Evaluator            │  │
│  │ Detector               │    │  - rain_mm >= threshold AND flood_prone  │  │
│  │  - 2-3 veh slow/stop   │    │  → emit YELLOW_FLOOD_RISK event          │  │
│  │  - stopped 30-45s      │    └────────────────────┬────────────────────┘  │
│  │  - speed < baseline    │                         │                       │
│  └────────────┬───────────┘                         │                       │
│               │                                     │                       │
│               └─────────────────┬───────────────────┘                       │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │            Two-Stage Confidence & Escalation Block                  │    │
│  │                                                                     │    │
│  │  Stage 1 (YELLOW / Early Alert):                                    │    │
│  │    • First 1–2 slowdowns/complaints  OR                             │    │
│  │    • Rain >= flood threshold (flood-prone road)                     │    │
│  │    → Write YELLOW to Central State, notify commuters + authorities  │    │
│  │                                                                     │    │
│  │  Stage 2 (RED / Confirmed):                                         │    │
│  │    • YELLOW + speed drop  OR  clustered stops/complaints  OR        │    │
│  │    • CCTV anomaly_confidence >= 0.5  OR  authority closure action   │    │
│  │    → Write RED to Central State, trigger rerouting + strong alert   │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                           │
│  ┌───────────────────────────────▼────────────────────────┐                 │
│  │  Priority & Action Recommender                          │                 │
│  │  Ranks disruptions by impact (affected_count × stage)  │                 │
│  │  Outputs: suggested_action, priority_score              │                 │
│  └───────────────────────────────┬────────────────────────┘                 │
│                                  │                                           │
│  ┌───────────────────────────────▼────────────────────────┐                 │
│  │  Primary Central Live State Block (SQLite/JSON)        │                 │
│  │  PK: segment_id | state: GREEN/YELLOW/RED              │                 │
│  │  stage: 1/2 | reason | confidence | updated_at         │                 │
│  │  authority_action | affected_count | alt_routes[]      │                 │
│  └───────────────────────────────┬────────────────────────┘                 │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   LAYER 4 — ROUTING & REAL-TIME SYNC                        │
│                                                                             │
│  ┌────────────────────────────┐    ┌──────────────────────────────────────┐  │
│  │ Alternate Route / Rerouting│    │ Real-Time Sync / Push Block           │  │
│  │ OSRM (local docker) or     │    │  - WebSocket or SSE push to both UIs  │  │
│  │ graph-weight fallback      │    │  - Polling /api/state fallback        │  │
│  └──────────────┬─────────────┘    └──────────────────┬───────────────────┘  │
└─────────────────┼────────────────────────────────────┬┼─────────────────────┘
                  │                                    ││
         ┌────────┘                                   ││
         ▼                                            ▼▼
┌──────────────────────┐                 ┌───────────────────────────────────┐
│   COMMUTER INTERFACE │                 │  TRAFFIC AUTHORITY DASHBOARD      │
│  - Leaflet map       │                 │  - Live priority disruption list  │
│  - GREEN/YEL/RED     │                 │  - Stage 1/2 confidence badge     │
│    road overlays     │                 │  - Suggested actions              │
│  - Alternate route   │                 │  - One-click: Close/Divert/       │
│  - Delay estimate    │                 │    Dispatch/Resolve               │
│  - Complaint button  │                 │  - Writes back to Central State   │
│  - RainViewer radar  │                 │  - Historical flood map layer     │
└──────────────────────┘                 └───────────────────────────────────┘
         ▲                                            ▲
         └──────────────────┬─────────────────────────┘
                            │
              ┌─────────────▼──────────────────┐
              │  Demo Event & Rain Simulator    │
              │  - Inject rain mm               │
              │  - Simulate speed pings         │
              │  - Fire complaint               │
              │  - Trigger CCTV anomaly         │
              │  - Reset to GREEN               │
              └─────────────────────────────────┘
```

---

### 1.3 Module Inventory

| # | Module/Block | Layer | Owner Track | Tech |
|---|---|---|---|---|
| 1 | CCTV Runner (`cctv_runner.py`) | Input | Track A | Python, Ultralytics YOLOv8, OpenCV |
| 2 | Telemetry Ingest API | Input | Track B | FastAPI route |
| 3 | Complaint Ingest API | Input | Track B | FastAPI route |
| 4 | Live Rainfall Fetcher | Input | Track B | Open-Meteo API + cache |
| 5 | Demo Event & Rain Simulator | Input | Track D | Simple FastAPI routes or curl scripts |
| 6 | Road Network & Baseline DB | Data | Track B | SQLite seed file |
| 7 | Historical Flood Zone DB | Data | Track B | SQLite seed file |
| 8 | Raw Signals Buffer | Data | Track B | Python deque / SQLite |
| 9 | Central Live State DB | Data | Track B | SQLite table |
| 10 | Signal Normalizer | Connector | Track B | Python module |
| 11 | Baseline & Flood Lookup Connector | Connector | Track B | Python module |
| 12 | Early Speed-Anomaly Detector | Decision | Track B | Python rules module |
| 13 | Flood Risk (YELLOW) Evaluator | Decision | Track B | Python rules module |
| 14 | Two-Stage Confidence & Escalation | Decision | Track B | Python rules module |
| 15 | Priority & Action Recommender | Decision | Track B | Python rules module |
| 16 | Historical Flood Updater | Decision | Track B | Python module |
| 17 | Alternate Route / Rerouting | Routing | Track C | OSRM (local) or static graph |
| 18 | Real-Time Sync / Push | Routing | Track B | WebSocket or SSE (FastAPI) |
| 19 | Commuter Interface | UI | Track C | React or plain HTML+JS, Leaflet |
| 20 | Traffic Authority Dashboard | UI | Track D | React or plain HTML+JS, Leaflet |

---

### 1.4 Core Data Schemas / JSON Contracts

#### A. NormalizedEvent (internal — Signal Normalizer output)
```json
{
  "event_id": "uuid-v4",
  "segment_id": "SEG_001",
  "signal_type": "speed_drop | stopped | complaint | cctv_anomaly | rain_threshold | fleet_stop",
  "value": 12.5,
  "unit": "kmh | seconds | mm | confidence | category",
  "source": "telemetry | cctv | complaint | weather",
  "source_weight": 1.0,
  "timestamp": "ISO-8601",
  "meta": {}
}
```

#### B. RoadSegment (static seed)
```json
{
  "segment_id": "SEG_001",
  "name": "Anna Salai - Triplicane Stretch",
  "lat_start": 13.064, "lon_start": 80.270,
  "lat_end": 13.059, "lon_end": 80.274,
  "has_cctv": true,
  "baseline_speed_kmh": { "06": 35, "08": 18, "12": 28, "17": 15, "22": 42 },
  "flood_prone": true,
  "flood_rain_threshold_mm": 15.0,
  "flood_severity": "light_waterlogging"
}
```

#### C. CentralState (single source of truth — per segment)
```json
{
  "segment_id": "SEG_001",
  "state": "GREEN | YELLOW | RED",
  "stage": 1,
  "confidence": 0.72,
  "reason": "cctv_anomaly + speed_drop",
  "disruption_type": "waterlogging | accident | blockage | construction | congestion",
  "affected_count": 8,
  "alt_routes": ["SEG_005 → SEG_012", "SEG_007 → SEG_015"],
  "suggested_action": "monitor | reroute | close | dispatch",
  "priority_score": 14.4,
  "authority_action": null,
  "updated_at": "ISO-8601",
  "valid_until": "ISO-8601"
}
```

#### D. ComplaintPayload (Commuter → Backend)
```json
{
  "segment_id": "SEG_001",
  "category": "waterlogging | accident | blockage | construction",
  "description": "optional free text",
  "photo_url": "optional",
  "reporter_type": "commuter | fleet",
  "timestamp": "ISO-8601"
}
```

#### E. AuthorityAction (Dashboard → Backend)
```json
{
  "segment_id": "SEG_001",
  "action": "close | divert | dispatch | resolve | monitor",
  "officer_id": "AUTH_01",
  "note": "optional",
  "timestamp": "ISO-8601"
}
```

---

### 1.5 API Endpoint Contracts

| Method | Endpoint | Payload | Response | Owner |
|---|---|---|---|---|
| `POST` | `/api/ingest/cctv` | `CCTVEvent` JSON | `{event_id, status}` | Track B |
| `POST` | `/api/ingest/telemetry` | `{segment_id, speed_kmh, stopped_sec, vehicle_type}` | `{event_id, status}` | Track B |
| `POST` | `/api/ingest/complaint` | `ComplaintPayload` | `{complaint_id, status}` | Track B |
| `GET` | `/api/state` | — | `CentralState[]` for all segments | Track B |
| `GET` | `/api/state/{segment_id}` | — | `CentralState` single | Track B |
| `GET` | `/api/segments` | — | `RoadSegment[]` | Track B |
| `GET` | `/api/routes/{segment_id}` | — | `{alt_routes[], delay_minutes}` | Track C |
| `POST` | `/api/authority/action` | `AuthorityAction` | `{status}` | Track B |
| `GET` | `/api/weather/current` | — | `{segment_id, rain_mm}[]` | Track B |
| `POST` | `/api/demo/simulate` | `{type, segment_id, params}` | `{status}` | Track D |
| `WS` | `/ws/state` | — | streaming `CentralState` push | Track B |

---

## 2. Exact Build Order

> [!TIP]
> Build the **walking skeleton first** — a thin vertical slice that proves data flows end-to-end (ingest → decision → state → UI reads). Then expand horizontally.

### Phase 0 — Foundation (Hours 0–2) ⬛ START HERE
**Goal:** Everyone can run the same repo and talk to the same contracts.

| Step | Task | Who |
|---|---|---|
| 0.1 | Create Git repo, push to GitHub/GitLab, branch protection | All |
| 0.2 | Agree on and commit `/contracts/schemas.json` (all schemas above) | Track B lead |
| 0.3 | Create `/seed/segments.json` (5–8 real road segments, lat/lon, baseline speed, flood flags) | Track B |
| 0.4 | Create `/seed/flood_zones.json` (historical flood thresholds) | Track B |
| 0.5 | Agree on `.env.example` (PORT, DB path, Open-Meteo URL, OSRM URL) | All |
| 0.6 | Each teammate clones, runs `pip install -r requirements.txt`, confirms server starts | All |

### Phase 1 — Walking Skeleton (Hours 2–5) 🔧 CORE
**Goal:** One simulated event hits `/api/ingest/telemetry` → decision engine runs → `/api/state` returns YELLOW or RED → UI reads it.

| Step | Task | Who |
|---|---|---|
| 1.1 | FastAPI app scaffold with SQLite init, segment seeding, `/api/state` GET | Track B |
| 1.2 | Signal Normalizer module (converts raw → NormalizedEvent) | Track B |
| 1.3 | Baseline & Flood Lookup Connector | Track B |
| 1.4 | Two-Stage Confidence & Escalation Block (rules engine core) | Track B |
| 1.5 | `/api/ingest/telemetry` and `/api/ingest/complaint` routes | Track B |
| 1.6 | Minimal Commuter UI HTML page that polls `/api/state` and shows segment colors | Track C |
| 1.7 | Verify: `curl POST /api/ingest/telemetry` → `GET /api/state` returns YELLOW | Track B |

### Phase 2 — CCTV Runner + Rainfall (Hours 5–8)
**Goal:** Terminal CCTV model runs on video and injects events; rain fetcher updates state.

| Step | Task | Who |
|---|---|---|
| 2.1 | `cctv_runner.py` — YOLOv8n loads, processes video, prints JSON events | Track A |
| 2.2 | Add HTTP POST to `cctv_runner.py` → `/api/ingest/cctv` | Track A |
| 2.3 | Backend handler for `/api/ingest/cctv` (normalize CCTV event) | Track B |
| 2.4 | Live Rainfall Fetcher (Open-Meteo polling every 60s, cached) | Track B |
| 2.5 | Flood Risk (YELLOW) Evaluator module | Track B |
| 2.6 | Early Speed-Anomaly Detector module | Track B |
| 2.7 | Test: run `cctv_runner.py --video sample.mp4` → segment goes YELLOW then RED | Track A+B |

### Phase 3 — Routing + Real-Time Push (Hours 8–11)
**Goal:** State changes push instantly to both UIs; alternate routes appear.

| Step | Task | Who |
|---|---|---|
| 3.1 | OSRM setup via Docker (`docker run -p 5000:5000 osrm/osrm-backend`) OR static route graph fallback | Track C |
| 3.2 | Alternate Route / Rerouting Block (`/api/routes/{segment_id}`) | Track C |
| 3.3 | WebSocket push endpoint (`/ws/state`) in FastAPI | Track B |
| 3.4 | Commuter UI subscribes to WebSocket, re-renders map on state change | Track C |
| 3.5 | Traffic Authority Dashboard scaffold (priority list, stage badges) | Track D |
| 3.6 | Authority Dashboard WebSocket subscription + action panel | Track D |

### Phase 4 — Full UI + Demo Simulator (Hours 11–16)
**Goal:** Both UIs polished; Demo Simulator lets judges trigger any scenario.

| Step | Task | Who |
|---|---|---|
| 4.1 | Commuter UI: Leaflet map with road overlays, complaint form, RainViewer, alternate route display | Track C |
| 4.2 | Authority Dashboard: sorted disruption list, one-click actions, `POST /api/authority/action` | Track D |
| 4.3 | Demo Event & Rain Simulator UI panel (or curl script set) | Track D |
| 4.4 | Priority & Action Recommender logic | Track B |
| 4.5 | Historical Flood Updater (logs RED flood events back to DB) | Track B |
| 4.6 | Seed 2–3 realistic demo scenarios (JSON payloads in `/demo/scenarios/`) | Track D |

### Phase 5 — Integration, Polish & Hardening (Hours 16–20)
**Goal:** Everything works together on one machine; fallbacks in place.

| Step | Task | Who |
|---|---|---|
| 5.1 | Full integration test on single machine (all tracks merged to `main`) | All |
| 5.2 | Offline fallback: static rain data file if Open-Meteo unreachable | Track B |
| 5.3 | OSRM fallback: pre-computed static alternate routes in JSON if Docker unavailable | Track C |
| 5.4 | WebSocket fallback: 5-second polling if WS fails | Track C+D |
| 5.5 | UI polish pass (colors, labels, mobile-friendly if time allows) | Track C+D |
| 5.6 | Performance: ensure API responds < 200ms on demo machine | Track B |

### Phase 6 — Demo, Rehearsal & Submission (Hours 20–24)
→ See Section 5 (Wind-Down Plan)

---

**End State = Hackathon Complete** when all of these work together:
- [ ] `cctv_runner.py` running on terminal with sample video → events appear in backend
- [ ] Demo Simulator injects rain → segment turns YELLOW → Commuter UI shows alert + alt route
- [ ] Speed drop + complaint → segment escalates to RED → Authority Dashboard shows priority #1
- [ ] Authority clicks "Close Road" → Commuter UI immediately shows strong RED warning
- [ ] All state changes propagate in < 2 seconds (WebSocket or fast poll)

---

## 3. Distributed Team Work Split

> [!IMPORTANT]
> **Teams are 20–25 km apart with no shared local network.** All integration happens via Git + mocked JSON payloads + the shared API contract. Never block waiting for another track — use mock data instead.

### Track Split

| Track | Name | Focus Modules | Member(s) |
|---|---|---|---|
| **A** | CCTV / AI Runner | `cctv_runner.py`, sample video download, CCTV event POST | 1 person |
| **B** | Backend Core | FastAPI app, all ingest APIs, decision engine, SQLite state, WebSocket push, rainfall fetcher | 2 people |
| **C** | Routing + Commuter UI | OSRM/route graph, `/api/routes`, Commuter map UI (Leaflet) | 1–2 people |
| **D** | Authority Dashboard + Demo Sim | Authority Dashboard UI, Demo Simulator panel/scripts, pitch deck | 1 person |

### How Each Track Works Independently

**Track A (CCTV Runner)** — works fully offline:
- Downloads `yolov8n.pt` and a sample video (links in spec doc)
- Runs `cctv_runner.py` and validates JSON output against the CCTV schema
- **Mock backend:** points POST to `httpbin.org/post` or a local `python -m http.server` to verify payload format
- When Track B's `/api/ingest/cctv` is ready, switches the POST target → done

**Track B (Backend Core)** — the integration hub:
- Uses seed JSON files (`/seed/segments.json`, `/seed/flood_zones.json`) from day one
- Builds all APIs behind a mock data layer first (hardcoded Green state) then wires real logic
- Exposes `localhost:8000` for local testing; shares a **ngrok** or similar tunnel URL for cross-laptop integration testing before merge
- All decision logic is unit-testable with plain Python dicts — no UI dependency

**Track C (Routing + Commuter UI)** — UI-first with mocks:
- Starts from a static `mock_state.json` file (5 segments, all GREEN) served by a simple `python -m http.server`
- Builds the full Leaflet map, state colors, alt-route display against mock data
- Switches API base URL to Track B's server when available
- OSRM: runs `docker run osrm/osrm-backend` locally; if Docker unavailable, uses pre-generated static alt-route JSON (committed to repo)

**Track D (Authority Dashboard + Demo Sim)** — built against mock + Track B API:
- Builds the dashboard against `mock_state.json`
- Demo Simulator scripts (`/demo/simulate.sh` or a small UI panel) are standalone curl commands or a minimal HTML form
- Pitch deck runs in parallel (can start slides from spec doc during hours 0–4)

### Git Workflow

```
main (protected)
├── feature/track-A-cctv-runner
├── feature/track-B-backend-core
├── feature/track-C-routing-ui
└── feature/track-D-dashboard-demo
```

**Sync checkpoints:**
| Hour | Merge event |
|---|---|
| H+2 | Track B merges skeleton + contracts to `main`; all tracks pull |
| H+8 | Track A merges `cctv_runner.py` to `main`; Track B pulls + wires ingest |
| H+11 | Track C merges Commuter UI to `main`; Track D pulls |
| H+16 | All tracks merge to `main` → full integration test |
| H+20 | Feature freeze; `main` is demo-ready |

### Cross-Laptop Integration (Before Final Merge)

Since there's no shared LAN:
1. **Track B** runs `ngrok http 8000` → shares `https://xyz.ngrok.io` URL in team chat
2. All other tracks set `API_BASE_URL=https://xyz.ngrok.io` in their `.env`
3. Run one full smoke test via ngrok at H+11 and H+16
4. Final demo runs everything on **one designated laptop** (Track B's machine, since it has the backend)

### Shared `.env.example` (Committed to Repo)
```env
API_BASE_URL=http://localhost:8000
OPEN_METEO_URL=https://api.open-meteo.com/v1/forecast
OSRM_URL=http://localhost:5000
DEMO_SEGMENT_ID=SEG_001
WS_URL=ws://localhost:8000/ws/state
YOLO_MODEL=yolov8n.pt
VIDEO_PATH=./sample_videos/sample_traffic.mp4
```

---

## 4. End-to-End Live Demo Plan

### Demo Setup (Pre-Demo, 10 minutes before)
- [ ] Backend running on demo laptop: `uvicorn main:app --reload`
- [ ] CCTV runner ready but paused: `python cctv_runner.py --video sample.mp4 --segment SEG_002`
- [ ] Both UI tabs open in browser (Commuter UI | Authority Dashboard)
- [ ] Demo Simulator panel open (or curl scripts ready in terminal)
- [ ] Download backup: static screenshots + 2-min recorded walkthrough video (see Section 5)

---

### Act 1 — Normal State (1 min)
**Narrative:** *"On a normal morning, all monitored road segments are GREEN."*

| Action | Expected Result |
|---|---|
| Show Commuter UI map | All segments shown in **GREEN**, no alerts |
| Show Authority Dashboard | Empty disruption list, all segments GREEN |
| Point to road baseline speeds | Show SEG_001 (Anna Salai) baseline: 28 km/h at 12:00 |

---

### Act 2 — Yellow: Rainfall + Flood Risk (2 min)
**Narrative:** *"Heavy rain begins over a historically flood-prone stretch — the system proactively warns before any vehicle reports a problem."*

| Action | Tool | Expected Result |
|---|---|---|
| Inject `rain_mm: 18` for SEG_001 (threshold: 15mm) | Demo Simulator `POST /api/demo/simulate {type:"rain", segment_id:"SEG_001", rain_mm:18}` | SEG_001 turns **YELLOW** on both UIs within 2 seconds |
| Show Commuter UI | — | Yellow road highlight, alert: *"Flood-prone area — likely waterlogging at current rainfall. Alternate route suggested."* + delay estimate |
| Show Authority Dashboard | — | SEG_001 appears in disruption list: Stage 1, reason: `flood_risk`, suggested_action: `monitor` |
| Point to: no vehicle has reported anything yet | — | Explain proactive vs. reactive — this is the system's key advantage |

---

### Act 3 — Red Escalation: Speed Drop + CCTV (3 min)
**Narrative:** *"Two minutes later, vehicles start slowing. The CCTV runner (running on video) confirms anomaly. System escalates to RED."*

| Action | Tool | Expected Result |
|---|---|---|
| Simulate 3 vehicles slowing to 8 km/h (baseline 28) | Demo Simulator `{type:"speed", segment_id:"SEG_001", speed_kmh:8, count:3}` | Early Speed-Anomaly Detector fires, Stage 2 logic checks combined signals |
| **Start CCTV runner on terminal** | `python cctv_runner.py --video sample.mp4 --segment SEG_001` | Terminal prints JSON events; backend receives `anomaly_confidence: 0.6` |
| Inject one commuter complaint | Demo Simulator or Commuter UI complaint button | `{category:"waterlogging", segment_id:"SEG_001"}` |
| Observe state change | — | SEG_001 escalates to **RED**, Stage 2, `confidence: 0.82` |
| Commuter UI | — | Red road, **strong alert**, alternate route highlighted, delay: +12 min |
| Authority Dashboard | — | SEG_001 jumps to priority #1, suggested_action: `close` or `dispatch` |

---

### Act 4 — Authority Action + Commuter Sync (1 min)
**Narrative:** *"The authority officer closes the road with one click — instantly reflected for all commuters."*

| Action | Tool | Expected Result |
|---|---|---|
| Authority clicks "Close Road" for SEG_001 | Authority Dashboard button | `POST /api/authority/action {action:"close", segment_id:"SEG_001"}` |
| Commuter UI | — | Immediate update: "Road officially closed by Traffic Authority. Use alternate route." |
| Show real-time sync (<2s) | — | Both UIs update simultaneously without page refresh |

---

### Act 5 — Recovery (30 sec)
**Narrative:** *"Rain stops, disruption resolves — roads return to GREEN."*

| Action | Tool | Expected Result |
|---|---|---|
| Authority clicks "Resolve" | Authority Dashboard | SEG_001 returns to GREEN on both UIs |
| Point to Historical Flood Updater | — | "This event is logged — next time it rains 18mm on this road, the threshold auto-confirms faster." |

---

### Offline / Fallback Contingency
| Failure | Fallback |
|---|---|
| Open-Meteo API down | Load `./fallback/rain_cache.json` (pre-populated with demo rain values) |
| OSRM not available | Load `./fallback/static_routes.json` (pre-computed alternate routes) |
| WebSocket connection fails | UI falls back to 5-second polling of `/api/state` automatically |
| Internet down entirely | Everything still runs locally (backend + UIs on `localhost`) |
| Live demo crashes | Play pre-recorded 2-min walkthrough video |

---

## 5. 24-Hour Hackathon Wind-Down Plan

```
HOUR  18    19    20    21    22    23    24 (submit)
       │     │     │     │     │     │     │
       ▼     ▼     ▼     ▼     ▼     ▼     ▼
      [FF]  [BF]  [IT]  [DR1] [REC] [DR2] [SUB]
```

| Hour Window | Phase | Activities | Owner |
|---|---|---|---|
| **H+16 → H+18** | 🔀 Integration | All branches merged → `main`; full end-to-end flow tested; fix blocking integration bugs only | All |
| **H+18** | 🔒 Feature Freeze | **NO NEW FEATURES after this point.** Tag `v1.0-demo` in Git. Only bug fixes from here on. | Track B lead |
| **H+18 → H+19** | 🐛 Bug Fix Sprint | Fix top-3 bugs found in integration test; each fix is a small PR to `main` | All |
| **H+19 → H+20** | 🧪 Full Integration Test | Run all 5 demo Acts end-to-end. Verify < 2s state propagation. Check fallbacks work. Document pass/fail. | All |
| **H+20 → H+21** | 🎬 Demo Rehearsal 1 | First dry-run of demo script (all 5 Acts). Time it — target 7–9 minutes. Note stumbles/gaps. | Presenter + Track D |
| **H+21** | 🎥 Backup Recording | Record a clean 2-minute screen capture of the full demo flow (OBS or Loom) as insurance against live failures | Track D |
| **H+21 → H+22** | 🛠 Polish Pass | UI label fixes, color contrast, font sizes; smooth out any clunky transitions; update pitch deck screenshots | Track C + D |
| **H+22 → H+23** | 🎬 Demo Rehearsal 2 | Second dry-run with updated slides. Assign speaking parts. Practice handoff between terminal CCTV demo and UI walkthrough. | Presenter + All |
| **H+23 → H+24** | 📋 Final Submission Checklist | See checklist below | All |

### ✅ Final Submission Checklist

#### Code & Repository
- [ ] `main` branch is clean and runnable with `README.md` instructions
- [ ] `README.md` has: one-command setup, `python cctv_runner.py` usage, demo scenario instructions
- [ ] `.env.example` committed; actual `.env` in `.gitignore`
- [ ] Demo video (`demo_recording.mp4`) uploaded to repo or shared drive link in README
- [ ] No hardcoded API keys; use env vars throughout
- [ ] `requirements.txt` is complete and accurate (`pip freeze > requirements.txt` from clean venv)

#### Demo Readiness
- [ ] Backend starts cleanly on demo machine: `uvicorn main:app --reload`
- [ ] Sample video file present at `./sample_videos/sample_traffic.mp4`
- [ ] `yolov8n.pt` downloaded and accessible (or auto-downloads on first run)
- [ ] All 5 demo Acts rehearsed and timed (7–9 min total)
- [ ] Fallback rain cache file at `./fallback/rain_cache.json`
- [ ] Fallback static routes at `./fallback/static_routes.json`
- [ ] Backup demo recording ready to play if live demo fails

#### Pitch Deck
- [ ] Problem statement clearly stated (4 bottlenecks from spec)
- [ ] Solution architecture diagram (from Section 1.2 above)
- [ ] Two-stage Yellow/Red escalation explained visually
- [ ] "No new cameras" and "pre-trained model" callout prominent
- [ ] Demo screenshots embedded (commuter map + authority dashboard)
- [ ] Team names, roles, and contact info on last slide

#### Submission Form
- [ ] GitHub/GitLab repo URL submitted
- [ ] Pitch deck PDF uploaded
- [ ] Team name and member details confirmed
- [ ] Any required video submission link included

---

## Appendix: Sample Video & Dataset Resources (from Spec)

| Category | Source |
|---|---|
| **Accidents** | [Roboflow — Accident Detection YOLO11](https://universe.roboflow.com/rishabhworkspace/accident-detection-model-yolo11-tujdq) |
| **Accidents Video** | [Kaggle — CCTV Footages](https://www.kaggle.com/datasets/fahaddalwai/cctvfootagevideo/data) |
| **Construction** | [Roboflow — Road Construction](https://universe.roboflow.com/-r931s/road_costruction-uzjjc) |
| **Road Blockages** | [Roboflow — Road Debris](https://universe.roboflow.com/shivam-kumar-fara9/road-debris-iya6s-yomtj) |
| **Waterlogging** | [Kaggle — Roadway Flooding](https://www.kaggle.com/datasets/saurabhshahane/roadway-flooding-image-dataset/data) |
| **Base Traffic (Indian)** | [GitHub — ITD Indian Traffic Dataset](https://github.com/teg-iitr/ITD-Indian-traffic-dataset) |

> [!TIP]
> **For the hackathon demo, the fastest path:** Download any `.mp4` from the Accident or Traffic datasets. `yolov8n.pt` runs COCO-class detection out of the box — vehicles are detected without any fine-tuning. The CCTV runner just counts vehicles and flags stops, so any traffic video works immediately.
