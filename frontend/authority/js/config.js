/**
 * TrafficSense — Traffic Authority Dashboard Configuration
 * Track D | Phase 0 - Phase 4 Foundation
 */

const CONFIG = {
  // Network Endpoints (matches .env.example)
  API_BASE_URL: "http://localhost:8000",
  WS_URL: "ws://localhost:8000/ws/state",
  POLL_INTERVAL_MS: 5000,
  MOCK_DATA_PATH: "./mock_state.json",

  // LocalStorage Keys
  STORAGE_KEYS: {
    OFFICER: "trafficsense_auth_officer",
    THEME: "trafficsense_ui_theme",
    MODE: "trafficsense_data_mode", // 'mock' or 'live'
    MOCK_STATE: "trafficsense_active_mock_state",
    AUDIT_LOG: "trafficsense_audit_log"
  },

  // Seed Segments Metadata (Chennai Road Network from seed/segments.json)
  SEGMENTS_METADATA: {
    "SEG_001": {
      name: "Anna Salai — Triplicane Underpass",
      road_type: "underpass",
      speed_limit_kmh: 40,
      lat_start: 13.0632,
      lon_start: 80.2707,
      lat_end: 13.0589,
      lon_end: 80.2741,
      has_cctv: true,
      flood_prone: true,
      flood_rain_threshold_mm: 14.0,
      flood_severe_threshold_mm: 25.0,
      notes: "Low-lying underpass; historically floods within 20 min of heavy rain."
    },
    "SEG_002": {
      name: "Mount Road — Gemini Flyover Approach",
      road_type: "arterial",
      speed_limit_kmh: 50,
      lat_start: 13.0604,
      lon_start: 80.2560,
      lat_end: 13.0642,
      lon_end: 80.2521,
      has_cctv: true,
      flood_prone: false,
      flood_rain_threshold_mm: null,
      flood_severe_threshold_mm: null,
      notes: "High-volume arterial corridor with CCTV on approach and exit."
    },
    "SEG_003": {
      name: "Poonamallee High Road — Kilpauk Stretch",
      road_type: "collector",
      speed_limit_kmh: 40,
      lat_start: 13.0837,
      lon_start: 80.2367,
      lat_end: 13.0792,
      lon_end: 80.2412,
      has_cctv: false,
      flood_prone: true,
      flood_rain_threshold_mm: 18.0,
      flood_severe_threshold_mm: 30.0,
      notes: "No CCTV — relies on telemetry and complaints. Road dips near Kilpauk Medical College."
    },
    "SEG_004": {
      name: "Sardar Patel Road — Adyar Signal Junction",
      road_type: "arterial",
      speed_limit_kmh: 50,
      lat_start: 13.0067,
      lon_start: 80.2574,
      lat_end: 13.0105,
      lon_end: 80.2541,
      has_cctv: false,
      flood_prone: false,
      flood_rain_threshold_mm: null,
      flood_severe_threshold_mm: null,
      notes: "High accident rate junction. Fleet telemetry is primary detection source."
    },
    "SEG_005": {
      name: "Velachery Main Road — Taramani Bridge",
      road_type: "bridge",
      speed_limit_kmh: 40,
      lat_start: 12.9810,
      lon_start: 80.2192,
      lat_end: 12.9775,
      lon_end: 80.2234,
      has_cctv: true,
      flood_prone: true,
      flood_rain_threshold_mm: 20.0,
      flood_severe_threshold_mm: 35.0,
      notes: "Bridge approach floods when Buckingham Canal overflows."
    },
    "SEG_006": {
      name: "GST Road — Chromepet Flyover",
      road_type: "arterial",
      speed_limit_kmh: 60,
      lat_start: 12.9516,
      lon_start: 80.1437,
      lat_end: 12.9572,
      lon_end: 80.1388,
      has_cctv: false,
      flood_prone: false,
      flood_rain_threshold_mm: null,
      flood_severe_threshold_mm: null,
      notes: "High speed arterial, primary diversion corridor for southern traffic."
    }
  },

  // Historical Flood Zones (from seed/flood_zones.json)
  FLOOD_ZONES: [
    {
      flood_zone_id: "FZ_001",
      segment_id: "SEG_001",
      name: "Anna Salai — Triplicane Underpass",
      rain_threshold_mm: 14.0,
      severe_threshold_mm: 25.0,
      typical_severity: "moderate_waterlogging",
      typical_onset_minutes: 20,
      drainage_quality: "poor",
      recommended_alternate: "SEG_006"
    },
    {
      flood_zone_id: "FZ_002",
      segment_id: "SEG_003",
      name: "Poonamallee High Road — Kilpauk Stretch",
      rain_threshold_mm: 18.0,
      severe_threshold_mm: 30.0,
      typical_severity: "light_waterlogging",
      typical_onset_minutes: 35,
      drainage_quality: "fair",
      recommended_alternate: "SEG_002"
    },
    {
      flood_zone_id: "FZ_003",
      segment_id: "SEG_005",
      name: "Velachery Main Road — Taramani Bridge",
      rain_threshold_mm: 20.0,
      severe_threshold_mm: 35.0,
      typical_severity: "moderate_waterlogging",
      typical_onset_minutes: 45,
      drainage_quality: "poor",
      recommended_alternate: "SEG_004"
    }
  ],

  // Demo Acts (Blueprint Section 4)
  ACTS_METADATA: [
    {
      act: 1,
      name: "Act 1: Normal State (All Corridors Clear)",
      narrative: "On a normal morning, all monitored Chennai road corridors are GREEN.",
      target_segment: "ALL",
      target_state: "GREEN",
      scenario_file: "01_normal_all_green.json"
    },
    {
      act: 2,
      name: "Act 2: Rainfall + Proactive Flood Alert (YELLOW)",
      narrative: "Rain begins over flood-prone Triplicane underpass (18mm). System proactively issues YELLOW warning before vehicle speeds drop.",
      target_segment: "SEG_001",
      target_state: "YELLOW",
      scenario_file: "02_act2_rainfall_flood_risk_yellow.json"
    },
    {
      act: 3,
      name: "Act 3: Speed Drop + CCTV Anomaly (RED)",
      narrative: "Vehicles slow to 8 km/h. CCTV vision model confirms anomaly. System escalates SEG_001 to RED (Stage 2 Confirmed).",
      target_segment: "SEG_001",
      target_state: "RED",
      scenario_file: "03_act3_speed_drop_cctv_red.json"
    },
    {
      act: 4,
      name: "Act 4: One-Click Authority Closure",
      narrative: "Traffic Authority officer officially closes the underpass. Diversion routes pushed instantly to commuters.",
      target_segment: "SEG_001",
      target_state: "RED",
      scenario_file: "04_act4_authority_closure.json"
    },
    {
      act: 5,
      name: "Act 5: Drainage Cleared & De-escalation (GREEN)",
      narrative: "Rain ceases, pumps clear water. Officer hits Resolve to restore corridor to GREEN.",
      target_segment: "SEG_001",
      target_state: "GREEN",
      scenario_file: "05_act5_recovery_reset.json"
    }
  ],

  // Demo Officer Credentials Helper
  DEMO_OFFICER: {
    officer_id: "AUTH_01",
    name: "Insp. R. Senthil Nathan",
    role: "Senior Traffic Controller",
    zone: "Central Corridor (Anna Salai / Triplicane)",
    badge_no: "TN-TP-4092",
    login_time: new Date().toISOString()
  }
};

window.CONFIG = CONFIG;
