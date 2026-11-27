# 🚦 TrafficSense
### Software-Only Traffic & Road Disruption Management System
**Problem Statement #3 | 24-Hour Hackathon**

---

> **Phase 0 — Foundation** · Contracts, seed data, and environment setup are ready.
> Phase 1 (walking skeleton) starts once every teammate has confirmed their environment.

---

## What This System Does

TrafficSense detects road disruptions (waterlogging, accidents, blockages, construction) using:
- **Existing CCTV feeds** — simulated by running `cctv_runner.py` on pre-recorded sample video with a lightweight pre-trained `yolov8n.pt` model (no training, no camera hardware needed)
- **Commuter / fleet speed & stop telemetry** — GPS pings from phones/fleet vehicles
- **Commuter complaints** — quick in-app category reports
- **Live rainfall + historical flood-zone risk** — Open-Meteo API + a seeded flood history database

Signals flow through a **two-stage decision engine** (Yellow = likely/flood-risk, Red = confirmed) into a shared state that powers:
- 🗺 **Commuter Interface** — map alerts, alternate routes, complaint button
- 🖥 **Traffic Authority Dashboard** — priority-ranked disruptions, one-click close/divert/dispatch

---

## Repository Structure

```
trafficsense/
├── contracts/
│   └── schemas.json          ← Canonical JSON schemas for ALL payloads (Phase 0 ✅)
├── seed/
│   ├── segments.json         ← 6 road segments with CCTV flags & baseline speeds (Phase 0 ✅)
│   └── flood_zones.json      ← Historical flood data for flood-prone segments (Phase 0 ✅)
├── fallback/
│   ├── rain_cache.json       ← Offline rain data (created in Phase 2)
│   └── static_routes.json    ← Pre-computed alternate routes (created in Phase 3)
├── sample_videos/            ← Download sample traffic video here (see below — NOT in Git)
├── backend/                  ← FastAPI app (Track B — Phase 1+)
├── cctv_runner.py            ← Terminal YOLOv8n CCTV analyser (Track A — Phase 2)
├── frontend/
│   ├── commuter/             ← Commuter map UI (Track C — Phase 3+)
│   └── authority/            ← Authority dashboard (Track D — Phase 3+)
├── demo/
│   └── scenarios/            ← Pre-built demo scenario payloads (Phase 4)
├── .env.example              ← Environment template (copy to .env) (Phase 0 ✅)
├── .gitignore                ← (Phase 0 ✅)
├── requirements.txt          ← Python dependencies (Phase 1)
└── README.md                 ← This file
```

---

## Team Tracks & Git Branches

| Track | Branch | Focus | Members |
|---|---|---|---|
| **A** | `feature/track-A-cctv-runner` | `cctv_runner.py` — YOLOv8n terminal video analyser | 1 person |
| **B** | `feature/track-B-backend-core` | FastAPI, decision engine, SQLite, WebSocket push | 2 people |
| **C** | `feature/track-C-routing-ui` | OSRM routing, Commuter map UI (Leaflet) | 1–2 people |
| **D** | `feature/track-D-dashboard-demo` | Authority dashboard, Demo Simulator, pitch deck | 1 person |

> **Rule:** Every track builds against the JSON contracts in `/contracts/schemas.json`.
> If your module's API isn't ready yet, use mock data — **never block on another track.**

### Integration Checkpoints

| Hour | Event |
|---|---|
| H+2 | Track B merges skeleton + all ingest APIs → `main`; all tracks pull |
| H+8 | Track A merges `cctv_runner.py` → `main`; Track B wires CCTV ingest |
| H+11 | Track C merges Commuter UI → `main`; cross-laptop smoke test via ngrok |
| H+16 | All tracks merge → full integration test on one machine |
| H+20 | 🔒 **Feature freeze** — tag `v1.0-demo` |

---

## Phase 0 Setup — Every Teammate Does This

### 1. Clone the repo and create your track branch

```bash
git clone https://github.com/<your-org>/trafficsense.git
cd trafficsense
git checkout -b feature/track-X-your-name    # replace X with A/B/C/D
```

### 2. Create a Python virtual environment

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Copy the environment file

```bash
cp .env.example .env
# Edit .env — set API_BASE_URL, DB_PATH, VIDEO_PATH for your machine
```

### 4. Download the sample traffic video (Track A & B)

Download **any traffic `.mp4`** from one of these free sources and save it to `./sample_videos/sample_traffic.mp4`:

| Source | Link | Best For |
|---|---|---|
| Kaggle — CCTV Footages | https://www.kaggle.com/datasets/fahaddalwai/cctvfootagevideo/data | General traffic |
| ITD Indian Traffic Dataset | https://github.com/teg-iitr/ITD-Indian-traffic-dataset | Indian road context |
| Kaggle — Road Accidents | https://www.kaggle.com/datasets/suryaprabhakaran2005/road-accidents-from-cctv-footages-dataset | Accident detection |

> **Note:** `sample_videos/` is in `.gitignore` — the video is NOT committed to the repo. Each teammate downloads it locally.

### 5. Verify the contract schemas load

```bash
python -c "import json; s=json.load(open('contracts/schemas.json')); print('Schemas OK:', list(s['definitions'].keys()))"
```

Expected output:
```
Schemas OK: ['NormalizedEvent', 'RoadSegment', 'CentralState', 'ComplaintPayload', 'AuthorityAction', 'CCTVEvent', 'TelemetryPing', 'SimulatorEvent', 'RainfallReading']
```

---

## Phase 1 Prerequisites (Track B — Backend Core)

Before Phase 1 code is generated, confirm:
- [ ] Python 3.10+ available (`python --version`)
- [ ] Virtual env created and activated
- [ ] `.env` configured for your machine
- [ ] `contracts/schemas.json` loads without error (step 5 above)
- [ ] `seed/segments.json` and `seed/flood_zones.json` readable

Install Phase 1 dependencies (requirements.txt created in Phase 1):
```bash
pip install fastapi uvicorn[standard] sqlalchemy aiofiles python-dotenv httpx
```

---

## Cross-Laptop Integration (No Shared LAN)

Since teammates are 20–25 km apart:

1. **Track B** exposes the backend via [ngrok](https://ngrok.com/):
   ```bash
   ngrok http 8000
   # → copy the https://xyz.ngrok.io URL to team chat
   ```
2. All other tracks set in their `.env`:
   ```
   API_BASE_URL=https://xyz.ngrok.io
   WS_URL=wss://xyz.ngrok.io/ws/state
   ```
3. Run cross-laptop smoke tests at **H+11** and **H+16**
4. Final demo runs everything on **one designated machine** (Track B's laptop)

---

## Running the CCTV Analyser (Track A — Phase 2 onwards)

```bash
# Install dependencies
pip install ultralytics opencv-python

# Run on a sample video — events are POSTed to the backend ingest endpoint
python cctv_runner.py --video ./sample_videos/sample_traffic.mp4 --segment SEG_001

# Or output to a JSONL file for offline testing
python cctv_runner.py --video ./sample_videos/sample_traffic.mp4 --segment SEG_001 --output events.jsonl
```

The CCTV runner emits events matching the `CCTVEvent` schema in `contracts/schemas.json`.

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Vision model | `yolov8n.pt` (pre-trained COCO) | < 6 MB, CPU-only, no training needed, detects cars/trucks/buses/motorcycles out-of-the-box |
| Backend | FastAPI + SQLite | Lightweight, fast to build, single-file DB for hackathon portability |
| Real-time push | WebSocket (`/ws/state`) | Instant < 2s state sync; 5-second polling fallback if WS fails |
| Routing | OSRM (local Docker) | Free, offline-capable; static JSON fallback if Docker unavailable |
| Weather | Open-Meteo (free, no key) | No API key friction; 60s cache prevents rate-limiting |
| State management | SQLite `central_state` table | Single source of truth; both UIs read from same DB |
| Two-stage alerts | YELLOW = flood-risk/early, RED = confirmed | Avoids false positives; proactive warning before vehicles report |

---

## Data Schemas Quick Reference

All schemas are in [`/contracts/schemas.json`](./contracts/schemas.json).

| Schema | Used By | Key Fields |
|---|---|---|
| `NormalizedEvent` | Signal Normalizer → Decision Engine | `segment_id`, `signal_type`, `value`, `source_weight` |
| `RoadSegment` | Seed → SQLite | `has_cctv`, `baseline_speed_kmh`, `flood_prone`, `flood_rain_threshold_mm` |
| `CentralState` | Decision Engine → Both UIs | `state` (GREEN/YELLOW/RED), `stage` (1/2), `confidence`, `suggested_action` |
| `CCTVEvent` | `cctv_runner.py` → `/api/ingest/cctv` | `vehicle_count`, `stopped_count`, `anomaly_confidence` |
| `TelemetryPing` | App/fleet → `/api/ingest/telemetry` | `speed_kmh`, `stopped_duration_sec`, `vehicle_type` |
| `ComplaintPayload` | Commuter UI → `/api/ingest/complaint` | `category`, `segment_id`, `reporter_type` |
| `AuthorityAction` | Authority Dashboard → `/api/authority/action` | `action` (close/divert/dispatch/resolve/monitor) |
| `SimulatorEvent` | Demo Simulator → `/api/demo/simulate` | `type`, `segment_id`, `params` |

---

## Demo Scenario Summary (Phase 4)

The live demo follows **5 Acts** (~8 minutes):
1. **Normal** — All segments GREEN
2. **Yellow** — Rain injected on SEG_001 (flood-prone) → proactive YELLOW before any vehicle reports
3. **Red** — Speed drop + `cctv_runner.py` running on terminal + complaint → escalates to RED
4. **Authority Action** — Officer closes road → Commuter UI immediately reflects RED/closed
5. **Recovery** — Authority resolves → returns to GREEN; flood event logged to history

---

## Contact / Team Structure

> Fill in before the demo:

| Track | Name | Contact |
|---|---|---|
| A — CCTV Runner | | |
| B — Backend Core | | |
| C — Routing + Commuter UI | | |
| D — Authority Dashboard + Demo | | |

---

*Blueprint approved. Phase 0 complete. Awaiting Phase 1 go-ahead.*
