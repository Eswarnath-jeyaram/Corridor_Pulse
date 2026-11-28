#!/usr/bin/env bash
# =============================================================================
# TrafficSense — Demo Event & Rain Simulator (Bash / Curl)
# Track D | Aligned with Master Blueprint Section 4 & Section 1.5
# =============================================================================

API_BASE="${API_BASE_URL:-http://localhost:8000}"
SEGMENT="${DEMO_SEGMENT:-SEG_001}"

echo "TrafficSense Demo Simulator"
echo "Target API: $API_BASE | Segment: $SEGMENT"
echo "----------------------------------------"

case "$1" in
  act1)
    echo "Triggering Act 1: Normal State (Reset to GREEN)..."
    curl -X POST "$API_BASE/api/demo/simulate" \
      -H "Content-Type: application/json" \
      -d '{"type": "reset", "segment_id": "ALL"}'
    ;;
  act2)
    echo "Triggering Act 2: Yellow Rainfall (18mm) on $SEGMENT..."
    curl -X POST "$API_BASE/api/demo/simulate" \
      -H "Content-Type: application/json" \
      -d "{\"type\": \"rain\", \"segment_id\": \"$SEGMENT\", \"params\": {\"rain_mm\": 18.0}}"
    ;;
  act3)
    echo "Triggering Act 3: Red Escalation (Speed drop + CCTV anomaly)..."
    curl -X POST "$API_BASE/api/demo/simulate" \
      -H "Content-Type: application/json" \
      -d "{\"type\": \"speed\", \"segment_id\": \"$SEGMENT\", \"params\": {\"speed_kmh\": 8, \"count\": 3}}"
    curl -X POST "$API_BASE/api/demo/simulate" \
      -H "Content-Type: application/json" \
      -d "{\"type\": \"cctv_anomaly\", \"segment_id\": \"$SEGMENT\", \"params\": {\"anomaly_confidence\": 0.65}}"
    ;;
  act4)
    echo "Triggering Act 4: Authority Action (Close Road)..."
    curl -X POST "$API_BASE/api/authority/action" \
      -H "Content-Type: application/json" \
      -d "{\"segment_id\": \"$SEGMENT\", \"action\": \"close\", \"officer_id\": \"AUTH_01\", \"note\": \"Underpass submerged. Official closure initiated.\"}"
    ;;
  act5)
    echo "Triggering Act 5: Recovery (Resolve to GREEN)..."
    curl -X POST "$API_BASE/api/authority/action" \
      -H "Content-Type: application/json" \
      -d "{\"segment_id\": \"$SEGMENT\", \"action\": \"resolve\", \"officer_id\": \"AUTH_01\", \"note\": \"Water pumped out, underpass reopened.\"}"
    ;;
  reset)
    echo "Resetting all corridors to GREEN..."
    curl -X POST "$API_BASE/api/demo/simulate" \
      -H "Content-Type: application/json" \
      -d '{"type": "reset", "segment_id": "ALL"}'
    ;;
  *)
    echo "Usage: ./demo/simulate.sh {act1|act2|act3|act4|act5|reset}"
    exit 1
    ;;
esac
echo ""
