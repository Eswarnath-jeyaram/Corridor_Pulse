# Demo Scenarios & Simulator (Track D)

This directory contains pre-seeded demo scenario payloads and simulation scripts aligned with the 5 Acts in the Master Blueprint (Section 4).

## Scenario Payloads (`demo/scenarios/`)

- `01_normal_all_green.json` — **Act 1: Normal State** (All 6 corridors GREEN, Stage 0, no disruptions).
- `02_act2_rainfall_flood_risk_yellow.json` — **Act 2: Yellow Rainfall + Flood Risk** (18mm rain injected into `SEG_001`, raising proactive Stage 1 warning).
- `03_act3_speed_drop_cctv_red.json` — **Act 3: Red Escalation: Speed Drop + CCTV** (Slowdown to 8 km/h + CCTV anomaly 0.65 + complaint, escalating `SEG_001` to RED Stage 2).
- `04_act4_authority_closure.json` — **Act 4: Authority Action: Road Closure** (One-click road closure executed via `/api/authority/action`).
- `05_act5_recovery_reset.json` — **Act 5: Recovery** (De-escalation and resolution back to GREEN Stage 0).

## Simulation Tools

### 1. In-Browser UI Simulator
Located inside the Traffic Authority Dashboard (`frontend/authority/`):
- Click **"⚡ Demo Simulator"** in the top header or switch to the **⚡ Demo Event & Rain Simulator** tab in the command console.
- Features one-click buttons for Acts 1–5, a global Reset button, a CCTV Vision Anomaly generator with slider & presets, rainfall injection with threshold presets, speed drop simulation, and commuter complaints.
- Operates instantaneously in **Local Mock mode** (updating UI state) AND dispatches live payloads in **Live Backend mode** (`POST /api/demo/simulate`).

### 2. Python CLI Simulator (`demo/simulate.py`)
```bash
# Trigger blueprint acts:
python demo/simulate.py --act 1
python demo/simulate.py --act 2
python demo/simulate.py --act 3

# Inject custom events:
python demo/simulate.py --rain 18.0 --segment SEG_001
python demo/simulate.py --speed 8.0 --segment SEG_001
python demo/simulate.py --cctv 0.65 --segment SEG_001
python demo/simulate.py --reset
```

### 3. Bash / cURL Script (`demo/simulate.sh`)
```bash
./demo/simulate.sh act1
./demo/simulate.sh act2
./demo/simulate.sh act3
./demo/simulate.sh act4
./demo/simulate.sh act5
./demo/simulate.sh reset
```
