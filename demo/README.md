# Demo Scenarios (Track D)

This directory contains pre-seeded demo scenario payloads aligned with the 5 Acts in the Master Blueprint (Section 4).

## Scenario Files

- `scenarios/01_normal_all_green.json` — **Act 1: Normal State** (All 6 segments GREEN, no disruptions).
- `scenarios/02_act2_rainfall_flood_risk_yellow.json` — **Act 2: Yellow Rainfall + Flood Risk** (Inject 18mm rain on `SEG_001`, early warning).
- `scenarios/03_act3_speed_drop_cctv_red.json` — **Act 3: Red Escalation: Speed Drop + CCTV** (Slowdown + CCTV anomaly + complaint escalates `SEG_001` to RED Stage 2).
- `scenarios/04_act4_authority_closure.json` — **Act 4: Authority Action: Road Closure** (One-click road closure executed via `/api/authority/action`).
- `scenarios/05_act5_recovery_reset.json` — **Act 5: Recovery** (De-escalation and resolution back to GREEN).

Each scenario provides both the request payloads for the simulator / authority action and the full expected `CentralState[]` snapshot.
