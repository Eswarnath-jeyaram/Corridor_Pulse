# Track A — Hardware-Free Terminal CCTV Runner
### `cctv_runner.py` | TrafficSense Hackathon

---

## What This Does

Runs pre-trained **YOLO11n** (or YOLOv8n as fallback) on a pre-recorded `.mp4`
traffic video to simulate an existing-CCTV feed — **no camera, no GPU, no training required**.

For every configurable time window it emits a `CCTVEvent` JSON payload (matching
`/contracts/schemas.json`) with:

| Field | Meaning |
|---|---|
| `vehicle_count` | Total unique vehicles tracked in the window |
| `stopped_count` | Vehicles whose centroid barely moved (stopped ≥ N frames) |
| `slow_count` | Vehicles moving, but slower than normal flow |
| `anomaly_confidence` | `(stopped + 0.5×slow) / total` — fed into the decision engine |
| `dominant_class` / `raw_classes` | Vehicle type breakdown from YOLO COCO detections |

The runner can:
- **Print payloads to terminal** (`--dry-run`) — no server needed
- **Show a live OpenCV window** (`--show`) — coloured boxes, IDs, status banner
- **Loop the video** (`--loop`) — seamless playback for pitch demos
- **POST to Track B backend** — when it's ready, just remove `--dry-run`

---

## Setup

> Run all commands from the `track_a_cctv/` directory.

### 1. Create and activate a virtual environment

```bash
# Windows (from repo root — reuse the existing venv)
.venv\Scripts\activate

# Or create a fresh one inside track_a_cctv
cd track_a_cctv
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate   # macOS/Linux
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

> On first run, `ultralytics` will automatically download `yolo11n.pt` (~6 MB).
> If your laptop blocks outbound downloads, manually place `yolo11n.pt` or `yolov8n.pt`
> in the `track_a_cctv/` directory and pass `--model yolo11n.pt`.

### 3. Confirm sample videos exist

```
Avishkaar/
└── sample_videos/
    ├── jam_stopped.mp4      ← heavy congestion / stopped vehicles
    └── normal_traffic.mp4   ← flowing traffic (GREEN state baseline)
```

---

## Test Commands (Run Right Now — No Server Needed)

### ✅ Basic dry-run (prints JSON events, no window)
```bash
python cctv_runner.py \
  --video ../sample_videos/jam_stopped.mp4 \
  --segment SEG_001 \
  --dry-run
```

### ✅ Full demo mode — preview window + terminal output + loop
```bash
python cctv_runner.py \
  --video ../sample_videos/jam_stopped.mp4 \
  --segment SEG_001 \
  --dry-run \
  --show \
  --loop
```
> Press **Q** in the OpenCV window to quit.

### ✅ Test with normal-traffic video (should show GREEN / low confidence)
```bash
python cctv_runner.py \
  --video ../sample_videos/normal_traffic.mp4 \
  --segment SEG_002 \
  --dry-run \
  --show
```

### ✅ Save events to a JSONL file for offline review
```bash
python cctv_runner.py \
  --video ../sample_videos/jam_stopped.mp4 \
  --segment SEG_001 \
  --dry-run \
  --output events.jsonl
```
Then inspect: `cat events.jsonl` (or `type events.jsonl` on Windows).

### ✅ Faster event emission (every 2 s — snappier demo trigger)
```bash
python cctv_runner.py \
  --video ../sample_videos/jam_stopped.mp4 \
  --segment SEG_001 \
  --dry-run \
  --show \
  --loop \
  --interval 2.0
```

### ✅ Test the CCTV-segment validation warning
```bash
# SEG_003 has has_cctv=false — runner prints a clear warning
python cctv_runner.py \
  --video ../sample_videos/jam_stopped.mp4 \
  --segment SEG_003 \
  --dry-run
```

---

## Connecting to Track B Backend (Phase 1 onwards)

Once Track B's FastAPI server is running, drop `--dry-run` and point at the server:

```bash
# Track B running on the same machine
python cctv_runner.py \
  --video ../sample_videos/jam_stopped.mp4 \
  --segment SEG_001 \
  --api-url http://localhost:8000 \
  --show \
  --loop

# Track B on a different laptop (via ngrok)
python cctv_runner.py \
  --video ../sample_videos/jam_stopped.mp4 \
  --segment SEG_001 \
  --api-url https://abc123.ngrok.io \
  --show \
  --loop
```

The runner will:
1. `POST /api/ingest/cctv` with the `CCTVEvent` payload
2. Log `✅ posted` on success, or `❌ failed` with a warning (keeps running either way)

---

## All CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--video` | *required* | Path to `.mp4` traffic video |
| `--segment` | *required* | Road segment ID (e.g. `SEG_001`) |
| `--model` | `yolo11n.pt` | YOLO model file; fallback to `yolov8n.pt` automatically |
| `--api-url` | from `.env` | Track B base URL, e.g. `http://localhost:8000` |
| `--interval` | `3.0` | Seconds between event emissions |
| `--dry-run` | off | Print payloads to terminal only — do NOT POST |
| `--show` | off | Open OpenCV preview window with tracked boxes + status banner |
| `--loop` | off | Seamlessly loop video (ideal for live demo) |
| `--output` | none | Append events as JSONL to this file |
| `--stop-px` | `6` | Centroid displacement (px) threshold below which = "stopped" |
| `--slow-px` | `20` | Centroid displacement (px) threshold below which = "slow" |

---

## What the OpenCV Window Shows

```
┌──────────────────────────────────────────────────────────────────────┐
│ [SEG_001]  ● STOPPED / BLOCKAGE  │  Vehicles:8  Stopped:4  Slow:2   │
│ Conf:0.625  │  FPS:4.8                                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────┐  RED box = stopped vehicle                             │
│   │ ID:3    │  ID:3 car [STOPPED]                                    │
│   │ car     │                                                        │
│   └─────────┘                                                        │
│                                                                      │
│   ┌─────────┐  ORANGE box = slow vehicle                             │
│   │ ID:7    │  ID:7 bus [SLOW]                                       │
│   └─────────┘                                                        │
│                                                                      │
│   ┌─────────┐  GREEN box = normal moving vehicle                     │
│   │ ID:12   │  ID:12 car                                             │
│   └─────────┘                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Expected Terminal Output (dry-run)

```
[OK]  Segment 'SEG_001' (Anna Salai — Triplicane Underpass) — has_cctv=true ✓
[INFO] Loading model: yolo11n.pt  (downloads ~6 MB on first run) ...
[INFO] Model loaded ✓  classes available: 80
[INFO] Video: ../sample_videos/jam_stopped.mp4
       1200 frames @ 25.0 fps  |  sampling every 5 frames (~5 fps effective)
       Segment: SEG_001  |  Interval: 3.0s  |  Dry-run: True  |  Loop: True
────────────────────────────────────────────────────────────

🟡 [2026-11-27T15:30:03Z]  Segment: SEG_001  State: SLOWDOWN
   Vehicles: 7  |  Stopped: 2  |  Slow: 3  |  Confidence: 0.357
   Classes: {'car': 5, 'bus': 1, 'motorcycle': 1}

   📄 Payload (dry-run — not sent to server):
   {
       "source": "cctv",
       "segment_id": "SEG_001",
       "timestamp": "2026-11-27T15:30:03Z",
       ...
   }

🔴 [2026-11-27T15:30:06Z]  Segment: SEG_001  State: STOPPED / BLOCKAGE
   Vehicles: 8  |  Stopped: 4  |  Slow: 2  |  Confidence: 0.625
   ...
```

---

## Segments with `has_cctv: true` (valid targets)

| Segment ID | Road Name | Road Type |
|---|---|---|
| `SEG_001` | Anna Salai — Triplicane Underpass | underpass |
| `SEG_002` | Mount Road — Gemini Flyover Approach | arterial |
| `SEG_005` | Velachery Main Road — Taramani Bridge | bridge |

Passing any other segment ID (`SEG_003`, `SEG_004`, `SEG_006`) will print a warning
but still run — useful for testing but not realistic for the demo.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ModuleNotFoundError: ultralytics` | Run `pip install -r requirements.txt` in your venv |
| `Cannot open video: ...` | Check the path — use `../sample_videos/jam_stopped.mp4` from `track_a_cctv/` |
| `yolo11n.pt` download fails | Download manually from [ultralytics releases](https://github.com/ultralytics/assets/releases) and place in `track_a_cctv/`. Or use `--model yolov8n.pt` |
| No bounding boxes appear | Video may have very few frames or low resolution — try `--conf 0.2` (add to code or lower `CONF_THRESHOLD`) |
| `[WARN] Cannot reach backend` | Normal in `--dry-run` mode — the warning only appears when NOT using `--dry-run` |
| OpenCV window not closing | Press **Q** inside the window, or `Ctrl+C` in terminal |

---

*Track A — cctv_runner.py | TrafficSense Hackathon | Phase 0 complete*
