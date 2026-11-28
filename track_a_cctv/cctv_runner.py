"""
TrafficSense — Track A: Hardware-Free Terminal CCTV / HIA Runner
================================================================
Uses pre-trained YOLO (yolo11n.pt / yolov8n.pt) with per-object tracking
to analyse pre-recorded traffic video and emit CCTVEvent JSON payloads that
conform to /contracts/schemas.json.

Runs fully standalone — no Track B server required when --dry-run is used.

Usage examples
--------------
  # Dry-run with live OpenCV preview (no server needed):
  python cctv_runner.py --video ../sample_videos/jam_stopped.mp4 --segment SEG_001 --dry-run --show

  # Loop the video endlessly for a live demo:
  python cctv_runner.py --video ../sample_videos/jam_stopped.mp4 --segment SEG_001 --dry-run --show --loop

  # Stream events to Track B backend:
  python cctv_runner.py --video ../sample_videos/jam_stopped.mp4 --segment SEG_001 --api-url http://localhost:8000

  # Save events to a JSONL file instead:
  python cctv_runner.py --video ../sample_videos/jam_stopped.mp4 --segment SEG_001 --dry-run --output events.jsonl
"""

import argparse
import collections
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
import requests
from dotenv import load_dotenv
from ultralytics import YOLO

# ---------------------------------------------------------------------------
# Config & constants
# ---------------------------------------------------------------------------

# COCO class indices that represent road vehicles (yolov8n / yolo11n COCO80)
VEHICLE_CLASS_IDS = {
    2:  "car",
    3:  "motorcycle",
    5:  "bus",
    7:  "truck",
}

# Pixel displacement (L2 distance of centroid) below which a vehicle is
# considered "not moving" within a single inter-frame sample.
STOP_PIXEL_THRESHOLD = 6          # pixels — tune with --stop-px

# If a tracked vehicle's centroid moves very little but more than stopped,
# it is counted as "slow".
SLOW_PIXEL_THRESHOLD = 20         # pixels — tune with --slow-px

# How many consecutive slow/stop observations (at FRAME_SKIP rate) make a
# vehicle count as "stopped" for the event window.
STOP_CONSEC_FRAMES = 8            # ~1–2 s at 5-fps sample rate

# Confidence threshold for YOLO detections to be accepted.
CONF_THRESHOLD = 0.35

# Max width (px) for the OpenCV preview window.
# Frames wider than this are scaled down (aspect-ratio preserved) so the full
# road scene fits on a standard 1366×768 or 1920×1080 laptop screen.
MAX_DISPLAY_WIDTH = 960

# Window title — plain ASCII only (no em-dashes or unicode that break on Windows)
WINDOW_TITLE = "TrafficSense - Track A CCTV Runner"

# YOLO model fallback order
DEFAULT_MODEL_PRIMARY   = "yolo11n.pt"
DEFAULT_MODEL_SECONDARY = "yolov8n.pt"

# API endpoint suffix
API_PATH = "/api/ingest/cctv"

# Segments file (relative from this script's directory, then try repo root)
SEGMENTS_CANDIDATES = [
    Path(__file__).parent.parent / "seed" / "segments.json",
    Path(__file__).parent / "seed" / "segments.json",
    Path("seed") / "segments.json",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_segments() -> dict:
    """Load segments.json and return a dict keyed by segment_id."""
    for candidate in SEGMENTS_CANDIDATES:
        if candidate.exists():
            with open(candidate, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {seg["segment_id"]: seg for seg in data}
    print("[WARN] segments.json not found in expected locations — skipping CCTV validation.")
    return {}


def validate_segment(segment_id: str, segments: dict) -> bool:
    """Warn if segment does not exist or has has_cctv=false. Returns True if OK."""
    if not segments:
        return True          # no seed data available — allow and continue
    if segment_id not in segments:
        print(f"[WARN] Segment '{segment_id}' not found in segments.json. "
              f"Available: {list(segments.keys())}")
        return False
    seg = segments[segment_id]
    if not seg.get("has_cctv", False):
        print(
            f"\n{'='*60}\n"
            f"[WARN] Segment '{segment_id}' ({seg.get('name','')}) has has_cctv=false.\n"
            f"       The CCTV runner should only be assigned to segments with existing\n"
            f"       camera feeds. Non-CCTV roads use telemetry + complaints.\n"
            f"       Continuing anyway — but this will not reflect realistic behaviour.\n"
            f"{'='*60}\n"
        )
        return False
    print(f"[OK]  Segment '{segment_id}' ({seg.get('name','')}) — has_cctv=true ✓")
    return True


def get_centroid(box) -> tuple[float, float]:
    """Return (cx, cy) from an ultralytics bounding box tensor."""
    x1, y1, x2, y2 = box.xyxy[0].tolist()
    return (x1 + x2) / 2.0, (y1 + y2) / 2.0


def build_event_payload(
    segment_id: str,
    frame_start: int,
    frame_end: int,
    vehicle_count: int,
    stopped_count: int,
    slow_count: int,
    class_counts: dict,
    model_name: str,
) -> dict:
    """
    Build a CCTVEvent dict that strictly matches the CCTVEvent schema
    in /contracts/schemas.json.
    """
    total = max(vehicle_count, 1)
    anomaly_confidence = min(
        (stopped_count + 0.5 * slow_count) / total, 1.0
    )

    # Dominant class
    if class_counts:
        dominant = max(class_counts, key=class_counts.get)
        # Collapse to enum values expected by schema
        if class_counts[dominant] > 1 and len(class_counts) > 1:
            dominant = "mixed"
    else:
        dominant = "unknown"

    return {
        "source":              "cctv",
        "segment_id":          segment_id,
        "timestamp":           datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "frame_range":         [frame_start, frame_end],
        "vehicle_count":       vehicle_count,
        "stopped_count":       stopped_count,
        "slow_count":          slow_count,
        "anomaly_confidence":  round(anomaly_confidence, 4),
        "dominant_class":      dominant,
        "raw_classes":         {k: v for k, v in class_counts.items() if k in ("car", "truck", "bus", "motorcycle")},
        "model":               model_name,
    }


def derive_event_state(payload: dict) -> str:
    """Human-readable event state label (not part of schema — for terminal display only)."""
    ac = payload["anomaly_confidence"]
    if ac >= 0.50:
        return "stopped_blockage"
    if ac >= 0.25:
        return "slowdown"
    return "normal"


def post_event(url: str, payload: dict, timeout: int = 5) -> bool:
    """POST payload to backend. Returns True on success. Logs errors without crashing."""
    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        resp.raise_for_status()
        return True
    except requests.exceptions.ConnectionError:
        print(f"[WARN] Cannot reach backend at {url} — is Track B running? "
              f"Use --dry-run to test without the server.")
    except requests.exceptions.Timeout:
        print(f"[WARN] POST to {url} timed out after {timeout}s — continuing.")
    except requests.exceptions.HTTPError as e:
        print(f"[WARN] Backend returned error: {e} — continuing.")
    except Exception as e:
        print(f"[WARN] Unexpected POST error: {e} — continuing.")
    return False


def resize_for_display(frame):
    """
    Scale frame down so its width <= MAX_DISPLAY_WIDTH, preserving aspect ratio.
    Returns the original frame unchanged if it already fits.
    """
    h, w = frame.shape[:2]
    if w <= MAX_DISPLAY_WIDTH:
        return frame
    scale = MAX_DISPLAY_WIDTH / w
    new_w = MAX_DISPLAY_WIDTH
    new_h = int(h * scale)
    return cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)


def draw_overlay(
    frame,
    tracks: dict,
    stop_track_ids: set,
    slow_track_ids: set,
    fps_display: float,
    event_state: str,
    anomaly_confidence: float,
    vehicle_count: int,
    stopped_count: int,
    slow_count: int,
    segment_id: str,
):
    """
    Draw bounding boxes, vehicle IDs, and a status banner on the frame.
    Stopped vehicles highlighted in red, slow in orange, normal in green.
    """
    h, w = frame.shape[:2]

    # --- Draw tracked vehicles ---
    for track_id, info in tracks.items():
        x1, y1, x2, y2 = info["box"]
        label = info["label"]
        cx, cy = info["centroid"]

        if track_id in stop_track_ids:
            colour = (0, 0, 220)      # RED — stopped
            tag = "STOPPED"
        elif track_id in slow_track_ids:
            colour = (0, 140, 255)    # ORANGE — slow
            tag = "SLOW"
        else:
            colour = (30, 200, 30)    # GREEN — moving
            tag = ""

        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), colour, 2)
        cv2.circle(frame, (int(cx), int(cy)), 4, colour, -1)

        text = f"ID:{track_id} {label}"
        if tag:
            text += f" [{tag}]"
        cv2.putText(frame, text, (int(x1), max(int(y1) - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.48, colour, 1, cv2.LINE_AA)

    # --- Status banner (top bar) ---
    state_colours = {
        "normal":           (30, 180, 30),
        "slowdown":         (0, 165, 255),
        "stopped_blockage": (0, 0, 220),
    }
    banner_col = state_colours.get(event_state, (80, 80, 80))

    cv2.rectangle(frame, (0, 0), (w, 44), (20, 20, 20), -1)
    cv2.rectangle(frame, (0, 0), (w, 44), banner_col, 2)

    # ASCII-only state tags — no unicode bullets or em-dashes (render as ? in OpenCV)
    state_text = {
        "normal":           "[NORMAL]",
        "slowdown":         "[SLOWDOWN]",
        "stopped_blockage": "[BLOCKAGE]",
    }.get(event_state, f"[{event_state.upper()}]")

    summary = (
        f"[{segment_id}]  {state_text}  |  "
        f"Vehicles:{vehicle_count}  Stopped:{stopped_count}  Slow:{slow_count}  |  "
        f"Conf:{anomaly_confidence:.2f}  |  FPS:{fps_display:.1f}"
    )
    cv2.putText(frame, summary, (8, 29),
                cv2.FONT_HERSHEY_SIMPLEX, 0.52, (240, 240, 240), 1, cv2.LINE_AA)

    return frame


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

def run(args):
    load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", override=False)

    # --- Resolve API URL ---
    api_base = args.api_url or os.getenv("API_BASE_URL", "http://localhost:8000")
    api_url  = api_base.rstrip("/") + API_PATH

    # --- Validate segment ---
    segments = load_segments()
    validate_segment(args.segment, segments)   # warns but does not exit

    # --- Load YOLO model ---
    model_name = args.model
    try:
        print(f"[INFO] Loading model: {model_name}  (downloads ~6 MB on first run) ...")
        model = YOLO(model_name)
        print(f"[INFO] Model loaded ✓  classes available: {len(model.names)}")
    except Exception as e:
        # Fallback to secondary model
        fallback = DEFAULT_MODEL_SECONDARY if model_name == DEFAULT_MODEL_PRIMARY else DEFAULT_MODEL_PRIMARY
        print(f"[WARN] Failed to load '{model_name}': {e}")
        print(f"[INFO] Falling back to '{fallback}' ...")
        model = YOLO(fallback)
        model_name = fallback
        print(f"[INFO] Fallback model loaded ✓")

    # --- Open video ---
    video_path = str(args.video)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open video: {video_path}")
        sys.exit(1)

    total_frames  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    native_fps    = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frame_skip    = max(1, int(native_fps / 5))   # sample ~5 frames/sec
    print(
        f"[INFO] Video: {video_path}\n"
        f"       {total_frames} frames @ {native_fps:.1f} fps  |  "
        f"sampling every {frame_skip} frames (~5 fps effective)\n"
        f"       Segment: {args.segment}  |  Interval: {args.interval}s  |  "
        f"Dry-run: {args.dry_run}  |  Loop: {args.loop}"
    )

    # --- Output file (optional) ---
    out_file = None
    if args.output:
        out_file = open(args.output, "a", encoding="utf-8")
        print(f"[INFO] Appending JSONL events to: {args.output}")

    # --- Tracking state ---
    # centroid_history[track_id] = deque of (cx, cy) — last N positions
    centroid_history: dict[int, collections.deque] = collections.defaultdict(
        lambda: collections.deque(maxlen=STOP_CONSEC_FRAMES + 2)
    )
    # Per track: class name
    track_labels: dict[int, str] = {}

    # Window state for event emission
    window_start_frame  = 0
    window_vehicle_ids: set  = set()
    window_stopped_ids: set  = set()
    window_slow_ids:    set  = set()
    window_class_counts: dict = collections.defaultdict(int)

    last_emit_time = time.time()
    frame_index    = 0
    fps_timer      = time.time()
    fps_display    = 0.0
    fps_frames     = 0

    # State carried to overlay between emissions
    current_payload    = None
    current_state      = "normal"
    current_stop_ids:  set = set()
    current_slow_ids:  set = set()
    current_track_draw: dict = {}

    print(f"\n[INFO] Starting analysis... (press Q in preview window to quit)\n{'─'*60}")

    while True:
        ret, frame = cap.read()

        if not ret:
            if args.loop:
                # Seamless loop
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                frame_index = 0
                window_start_frame = 0
                centroid_history.clear()
                track_labels.clear()
                window_vehicle_ids.clear()
                window_stopped_ids.clear()
                window_slow_ids.clear()
                window_class_counts.clear()
                last_emit_time = time.time()
                continue
            else:
                print("[INFO] End of video.")
                break

        frame_index += 1

        # Only process every Nth frame to keep CPU usage low
        if frame_index % frame_skip != 0:
            # Still show overlay if --show
            if args.show and current_payload is not None:
                disp = draw_overlay(
                    frame.copy(),
                    current_track_draw,
                    current_stop_ids,
                    current_slow_ids,
                    fps_display,
                    current_state,
                    current_payload["anomaly_confidence"],
                    current_payload["vehicle_count"],
                    current_payload["stopped_count"],
                    current_payload["slow_count"],
                    args.segment,
                )
                cv2.imshow(WINDOW_TITLE, resize_for_display(disp))
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            continue

        # --- Run YOLO tracking on this frame ---
        results = model.track(
            frame,
            persist=True,
            conf=CONF_THRESHOLD,
            classes=list(VEHICLE_CLASS_IDS.keys()),
            verbose=False,
        )

        # --- Parse detections ---
        frame_vehicle_ids:  set  = set()
        frame_stopped_ids:  set  = set()
        frame_slow_ids:     set  = set()
        this_frame_tracks:  dict = {}

        if results and results[0].boxes is not None:
            boxes = results[0].boxes
            for box in boxes:
                # Skip detections without a track ID (tracker not yet assigned)
                if box.id is None:
                    continue
                track_id  = int(box.id.item())
                class_id  = int(box.cls.item())
                class_name = VEHICLE_CLASS_IDS.get(class_id, "vehicle")
                track_labels[track_id] = class_name

                cx, cy = get_centroid(box)
                centroid_history[track_id].append((cx, cy))

                x1, y1, x2, y2 = box.xyxy[0].tolist()
                this_frame_tracks[track_id] = {
                    "box":     (x1, y1, x2, y2),
                    "centroid": (cx, cy),
                    "label":   class_name,
                }

                frame_vehicle_ids.add(track_id)
                window_class_counts[class_name] += 1

                # Classify movement using centroid history
                history = centroid_history[track_id]
                if len(history) >= 2:
                    # Average displacement over the last few positions
                    displacements = [
                        ((history[i][0] - history[i-1][0])**2 +
                         (history[i][1] - history[i-1][1])**2) ** 0.5
                        for i in range(1, len(history))
                    ]
                    avg_disp = sum(displacements) / len(displacements)
                    if avg_disp <= args.stop_px:
                        frame_stopped_ids.add(track_id)
                    elif avg_disp <= args.slow_px:
                        frame_slow_ids.add(track_id)

        # Accumulate into window
        window_vehicle_ids.update(frame_vehicle_ids)
        window_stopped_ids.update(frame_stopped_ids)
        window_slow_ids.update(frame_slow_ids - frame_stopped_ids)
        current_track_draw = this_frame_tracks
        current_stop_ids   = frame_stopped_ids
        current_slow_ids   = frame_slow_ids - frame_stopped_ids

        # FPS calculation
        fps_frames += 1
        elapsed_fps = time.time() - fps_timer
        if elapsed_fps >= 1.0:
            fps_display = fps_frames / elapsed_fps
            fps_frames  = 0
            fps_timer   = time.time()

        # --- Emit event every --interval seconds ---
        now = time.time()
        if (now - last_emit_time) >= args.interval:
            payload = build_event_payload(
                segment_id    = args.segment,
                frame_start   = window_start_frame,
                frame_end     = frame_index,
                vehicle_count = len(window_vehicle_ids),
                stopped_count = len(window_stopped_ids),
                slow_count    = len(window_slow_ids),
                class_counts  = dict(window_class_counts),
                model_name    = model_name,
            )
            event_state    = derive_event_state(payload)
            current_payload = payload
            current_state   = event_state

            # Terminal output — ASCII state tags (emojis work in most terminals but
            # degrade gracefully if the console doesn't support them)
            state_icon = {
                "normal":           "[GRN]",
                "slowdown":         "[YEL]",
                "stopped_blockage": "[RED]",
            }.get(event_state, "[---]")
            print(
                f"\n{state_icon} [{payload['timestamp']}]  Segment: {args.segment}  "
                f"State: {event_state.upper()}\n"
                f"   Vehicles: {payload['vehicle_count']}  |  "
                f"Stopped: {payload['stopped_count']}  |  "
                f"Slow: {payload['slow_count']}  |  "
                f"Confidence: {payload['anomaly_confidence']:.3f}\n"
                f"   Classes: {payload['raw_classes']}"
            )

            if args.dry_run:
                print(f"\n   [DRY-RUN] Payload (not sent to server):\n"
                      f"   {json.dumps(payload, indent=4)}")
            else:
                ok = post_event(api_url, payload)
                status = "[OK] posted" if ok else "[FAIL] see warning above"
                print(f"   [POST] {api_url}  ->  {status}")

            if out_file:
                out_file.write(json.dumps(payload) + "\n")
                out_file.flush()

            # Reset window
            window_start_frame = frame_index
            window_vehicle_ids.clear()
            window_stopped_ids.clear()
            window_slow_ids.clear()
            window_class_counts.clear()
            last_emit_time = now

        # --- Draw overlay and show ---
        if args.show:
            disp_payload = current_payload or {
                "vehicle_count": 0, "stopped_count": 0,
                "slow_count": 0, "anomaly_confidence": 0.0,
            }
            disp = draw_overlay(
                frame.copy(),
                current_track_draw,
                current_stop_ids,
                current_slow_ids,
                fps_display,
                current_state,
                disp_payload["anomaly_confidence"],
                disp_payload["vehicle_count"],
                disp_payload["stopped_count"],
                disp_payload["slow_count"],
                args.segment,
            )
            cv2.imshow(WINDOW_TITLE, resize_for_display(disp))
            if cv2.waitKey(1) & 0xFF == ord("q"):
                print("\n[INFO] User quit (Q pressed).")
                break

    # --- Cleanup ---
    cap.release()
    if out_file:
        out_file.close()
    if args.show:
        cv2.destroyAllWindows()
    print("\n[INFO] CCTV runner finished.")


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(
        description="TrafficSense Track A — Hardware-Free CCTV Runner (yolo11n / yolov8n)",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument(
        "--video", required=True, type=Path,
        help="Path to .mp4 traffic video (e.g. ../sample_videos/jam_stopped.mp4)"
    )
    p.add_argument(
        "--segment", required=True,
        help="Road segment ID, e.g. SEG_001 (must have has_cctv=true in segments.json)"
    )
    p.add_argument(
        "--model", default=DEFAULT_MODEL_PRIMARY,
        help=f"YOLO model file. Default: {DEFAULT_MODEL_PRIMARY}  Fallback: {DEFAULT_MODEL_SECONDARY}"
    )
    p.add_argument(
        "--api-url", default=None,
        help="Base URL of Track B backend, e.g. http://localhost:8000\n"
             "(overrides API_BASE_URL in .env)"
    )
    p.add_argument(
        "--interval", type=float, default=3.0,
        help="Seconds between event emissions (default: 3.0 — use 2.0 for snappier demo)"
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Print JSON payloads to terminal only. Do NOT POST to backend."
    )
    p.add_argument(
        "--show", action="store_true",
        help="Open OpenCV preview window with bounding boxes, IDs, and status banner."
    )
    p.add_argument(
        "--loop", action="store_true",
        help="Loop the video seamlessly (great for live pitch demo)."
    )
    p.add_argument(
        "--output", default=None, type=Path,
        help="Append emitted events as JSONL to this file (useful for offline testing)."
    )
    p.add_argument(
        "--stop-px", type=float, default=STOP_PIXEL_THRESHOLD,
        help=f"Max avg centroid displacement (px) to classify as STOPPED. Default: {STOP_PIXEL_THRESHOLD}"
    )
    p.add_argument(
        "--slow-px", type=float, default=SLOW_PIXEL_THRESHOLD,
        help=f"Max avg centroid displacement (px) to classify as SLOW. Default: {SLOW_PIXEL_THRESHOLD}"
    )
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(args)
