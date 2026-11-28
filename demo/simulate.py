#!/usr/bin/env python3
"""
TrafficSense — Demo Event & Rain Simulator CLI
Track D | Master Blueprint Section 4 & Section 1.5

Can run in two modes:
  1. Live Backend Mode: Sends HTTP POST to http://localhost:8000/api/demo/simulate
  2. Local File Mode: Directly updates mock_state.json for offline testing

Usage:
  python demo/simulate.py --act 1              # Load Act 1 (All GREEN)
  python demo/simulate.py --act 2              # Load Act 2 (Rainfall 18mm -> YELLOW)
  python demo/simulate.py --act 3              # Load Act 3 (Speed 8km/h + CCTV 0.65 -> RED)
  python demo/simulate.py --act 4              # Load Act 4 (Authority Closure)
  python demo/simulate.py --act 5              # Load Act 5 (Recovery / Reset)
  python demo/simulate.py --rain 18.0 --segment SEG_001
  python demo/simulate.py --speed 8.0 --segment SEG_001
  python demo/simulate.py --cctv 0.65 --segment SEG_001
  python demo/simulate.py --reset
"""

import sys
import json
import argparse
import urllib.request
import urllib.error
from pathlib import Path

DEFAULT_API_BASE = "http://localhost:8000"
ROOT_DIR = Path(__file__).resolve().parent.parent
MOCK_STATE_PATH = ROOT_DIR / "mock_state.json"
SCENARIOS_DIR = ROOT_DIR / "demo" / "scenarios"

def send_live_event(api_base, payload):
    url = f"{api_base}/api/demo/simulate"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode("utf-8")
            print(f"[LIVE BACKEND] Sent to {url} -> HTTP {resp.status}: {body}")
            return True
    except urllib.error.URLError as e:
        print(f"[LIVE BACKEND ERROR] Could not connect to {url}: {e}")
        return False

def apply_local_scenario(act_num):
    scenario_files = {
        1: "01_normal_all_green.json",
        2: "02_act2_rainfall_flood_risk_yellow.json",
        3: "03_act3_speed_drop_cctv_red.json",
        4: "04_act4_authority_closure.json",
        5: "05_act5_recovery_reset.json",
    }
    fname = scenario_files.get(act_num)
    if not fname:
        print(f"Unknown Act: {act_num}")
        return False

    scen_path = SCENARIOS_DIR / fname
    if not scen_path.exists():
        print(f"Scenario file not found: {scen_path}")
        return False

    with open(scen_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    expected = data.get("expected_state")
    if expected:
        with open(MOCK_STATE_PATH, "w", encoding="utf-8") as mf:
            json.dump(expected, mf, indent=2)
        print(f"[LOCAL MOCK] Updated {MOCK_STATE_PATH} with Act {act_num}: {data.get('name')}")
        return True
    return False

def main():
    parser = argparse.ArgumentParser(description="TrafficSense Demo Simulator CLI")
    parser.add_argument("--act", type=int, choices=[1, 2, 3, 4, 5], help="Trigger Master Blueprint Act (1-5)")
    parser.add_argument("--rain", type=float, help="Inject rainfall mm/hr")
    parser.add_argument("--speed", type=float, help="Inject speed drop km/h")
    parser.add_argument("--cctv", type=float, help="Inject CCTV anomaly confidence (0.0 to 1.0)")
    parser.add_argument("--complaint", type=str, choices=["waterlogging", "accident", "blockage", "construction"], help="Fire commuter complaint")
    parser.add_argument("--reset", action="store_true", help="Reset all segments to GREEN")
    parser.add_argument("--segment", type=str, default="SEG_001", help="Target road segment ID (default: SEG_001)")
    parser.add_argument("--api-base", type=str, default=DEFAULT_API_BASE, help="Backend API Base URL (default: http://localhost:8000)")
    parser.add_argument("--mock-only", action="store_true", help="Only modify local mock_state.json without contacting backend")
    args = parser.parse_args()

    if args.act:
        print(f"--- Triggering Act {args.act} ---")
        if not args.mock_only:
            # Try live backend if available
            if args.act in (1, 5):
                # SIM-1: Reset all corridors
                payload = {"type": "reset", "segment_id": "ALL"}
                send_live_event(args.api_base, payload)
            elif args.act == 2:
                payload = {"type": "rain", "segment_id": args.segment, "params": {"rain_mm": 18.0}}
                send_live_event(args.api_base, payload)
            elif args.act == 3:
                # SIM-2: Multi-signal sequence for args.segment to cleanly escalate to RED in live mode
                events = [
                    {"type": "rain", "segment_id": args.segment, "params": {"rain_mm": 18.0}},
                    {"type": "speed", "segment_id": args.segment, "params": {"speed_kmh": 8.0, "count": 3}},
                    {"type": "cctv_anomaly", "segment_id": args.segment, "params": {"anomaly_confidence": 0.65}},
                    {"type": "complaint", "segment_id": args.segment, "params": {"category": "waterlogging"}},
                ]
                for p in events:
                    send_live_event(args.api_base, p)
            elif args.act == 4:
                payload = {"type": "authority_close", "segment_id": args.segment}
                send_live_event(args.api_base, payload)
        apply_local_scenario(args.act)
        return

    if args.reset:
        payload = {"type": "reset", "segment_id": "ALL"}
        if not args.mock_only:
            send_live_event(args.api_base, payload)
        apply_local_scenario(1)
        return

    if args.rain is not None:
        payload = {"type": "rain", "segment_id": args.segment, "params": {"rain_mm": args.rain}}
        if not args.mock_only:
            send_live_event(args.api_base, payload)
        print(f"Injected rain {args.rain} mm/hr for {args.segment}")

    if args.speed is not None:
        payload = {"type": "speed", "segment_id": args.segment, "params": {"speed_kmh": args.speed, "count": 3}}
        if not args.mock_only:
            send_live_event(args.api_base, payload)
        print(f"Injected speed {args.speed} km/h for {args.segment}")

    if args.cctv is not None:
        payload = {"type": "cctv_anomaly", "segment_id": args.segment, "params": {"anomaly_confidence": args.cctv}}
        if not args.mock_only:
            send_live_event(args.api_base, payload)
        print(f"Injected CCTV anomaly confidence {args.cctv} for {args.segment}")

    if args.complaint is not None:
        payload = {"type": "complaint", "segment_id": args.segment, "params": {"category": args.complaint}}
        if not args.mock_only:
            send_live_event(args.api_base, payload)
        print(f"Injected complaint '{args.complaint}' for {args.segment}")

if __name__ == "__main__":
    main()
