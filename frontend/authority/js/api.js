/**
 * TrafficSense — Traffic Authority API & State Client
 * Track D | Phase 0 - Phase 4 Foundation
 * Supports seamless switching between Local Mock Mode and Live Backend
 */

class StateService {
  constructor() {
    this.mode = localStorage.getItem(CONFIG.STORAGE_KEYS.MODE) || 'mock'; // 'mock' | 'live'
    this.status = 'initializing'; // 'mock' | 'connected' | 'polling' | 'disconnected' | 'error'
    this.state = [];
    this.subscribers = [];
    this.statusSubscribers = [];
    this.ws = null;
    this.pollTimer = null;
    this.apiBaseUrl = CONFIG.API_BASE_URL;
    this.wsUrl = CONFIG.WS_URL;
  }

  init() {
    this.setMode(this.mode);
  }

  setMode(newMode) {
    this.mode = newMode;
    localStorage.setItem(CONFIG.STORAGE_KEYS.MODE, newMode);

    if (this.mode === 'mock') {
      this.disconnectLive();
      this.updateStatus('mock');
      this.loadMockState();
    } else {
      this.connectLive();
    }
  }

  updateStatus(status, detail = '') {
    this.status = status;
    this.statusDetail = detail;
    this.notifyStatusSubscribers({ status, detail, mode: this.mode });
  }

  onStateChange(callback) {
    this.subscribers.push(callback);
    if (this.state.length > 0) {
      callback(this.state);
    }
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  onStatusChange(callback) {
    this.statusSubscribers.push(callback);
    callback({ status: this.status, detail: this.statusDetail || '', mode: this.mode });
    return () => {
      this.statusSubscribers = this.statusSubscribers.filter(cb => cb !== callback);
    };
  }

  notifySubscribers() {
    for (const cb of this.subscribers) {
      try {
        cb(this.state);
      } catch (err) {
        console.error('[StateService] Subscriber error:', err);
      }
    }
  }

  notifyStatusSubscribers(statusPayload) {
    for (const cb of this.statusSubscribers) {
      try {
        cb(statusPayload);
      } catch (err) {
        console.error('[StateService] Status subscriber error:', err);
      }
    }
  }

  // ==========================================
  // Mock State Handling
  // ==========================================

  async loadMockState(forceReset = false) {
    try {
      if (!forceReset) {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEYS.MOCK_STATE);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.state = parsed;
            this.updateStatus('mock', 'Loaded from local session cache');
            this.notifySubscribers();
            return;
          }
        }
      }

      // Fetch fresh mock_state.json
      const response = await fetch(CONFIG.MOCK_DATA_PATH + '?t=' + Date.now());
      if (!response.ok) {
        throw new Error(`Failed to load ${CONFIG.MOCK_DATA_PATH}: ${response.statusText}`);
      }
      const data = await response.json();
      this.state = data;
      localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_STATE, JSON.stringify(data));
      this.updateStatus('mock', 'Loaded from mock_state.json');
      this.notifySubscribers();
    } catch (err) {
      console.warn('[StateService] Falling back to hardcoded default state:', err);
      this.state = this.getHardcodedFallbackState();
      this.updateStatus('mock', 'Loaded fallback memory state');
      this.notifySubscribers();
    }
  }

  resetMockState() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.MOCK_STATE);
    return this.loadMockState(true);
  }

  // ==========================================
  // Live Backend (WebSocket + Polling Fallback)
  // ==========================================

  connectLive() {
    this.disconnectLive();
    this.updateStatus('connecting', `Connecting to WebSocket: ${this.wsUrl}`);

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.updateStatus('connected', 'Live WebSocket connection active');
        // Initial fetch via GET /api/state to ensure sync
        this.fetchLiveState();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (Array.isArray(msg)) {
            this.state = msg;
            this.notifySubscribers();
          } else if (msg && msg.segment_id) {
            // Single segment update
            this.updateSingleSegmentState(msg);
          }
        } catch (e) {
          console.warn('[StateService] WS message parse error:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[StateService] WS error, activating polling fallback:', err);
        this.startPollingFallback('WebSocket error');
      };

      this.ws.onclose = () => {
        if (this.mode === 'live') {
          console.warn('[StateService] WS closed, falling back to HTTP polling');
          this.startPollingFallback('WebSocket disconnected');
        }
      };
    } catch (err) {
      console.warn('[StateService] WS init failed, falling back to HTTP polling:', err);
      this.startPollingFallback('WS initialization failed');
    }
  }

  startPollingFallback(reason = '') {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }

    this.updateStatus('polling', `HTTP 5s Polling active (${reason})`);
    this.fetchLiveState();

    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.mode === 'live') {
          this.fetchLiveState();
        }
      }, CONFIG.POLL_INTERVAL_MS);
    }
  }

  async fetchLiveState() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/state`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      if (Array.isArray(data)) {
        this.state = data;
        this.notifySubscribers();
      }
    } catch (err) {
      console.warn('[StateService] Live GET /api/state failed:', err.message);
      this.updateStatus('polling', `Backend unreachable (${err.message})`);
    }
  }

  disconnectLive() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  updateSingleSegmentState(updatedSegment) {
    const idx = this.state.findIndex(s => s.segment_id === updatedSegment.segment_id);
    if (idx !== -1) {
      this.state[idx] = { ...this.state[idx], ...updatedSegment };
    } else {
      this.state.push(updatedSegment);
    }
    if (this.mode === 'mock') {
      localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_STATE, JSON.stringify(this.state));
    }
    this.notifySubscribers();
  }

  // ==========================================
  // Authority Action Execution
  // ==========================================

  async submitAuthorityAction(actionPayload) {
    // Validates contract: { segment_id, action, officer_id, note, timestamp }
    if (!actionPayload.segment_id || !actionPayload.action || !actionPayload.officer_id) {
      throw new Error('Missing required fields in AuthorityAction payload (segment_id, action, officer_id)');
    }

    const payload = {
      segment_id: actionPayload.segment_id,
      action: actionPayload.action,
      officer_id: actionPayload.officer_id,
      note: actionPayload.note || null,
      timestamp: actionPayload.timestamp || new Date().toISOString()
    };

    if (this.mode === 'mock') {
      // Perform local simulation of the Authority Action
      const updatedItem = this.applyMockAuthorityAction(payload);
      return { status: 'applied', state: updatedItem, mode: 'mock' };
    } else {
      // Live HTTP POST /api/authority/action
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/authority/action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        // If backend returned updated state, refresh immediately
        if (result.state) {
          this.updateSingleSegmentState(result.state);
        } else {
          this.fetchLiveState();
        }
        return { status: 'applied', state: result.state || null, mode: 'live' };
      } catch (err) {
        console.error('[StateService] Failed to send live AuthorityAction:', err);
        throw err;
      }
    }
  }

  applyMockAuthorityAction(payload) {
    const idx = this.state.findIndex(s => s.segment_id === payload.segment_id);
    if (idx === -1) {
      throw new Error(`Segment ${payload.segment_id} not found in state`);
    }

    const current = { ...this.state[idx] };
    const nowIso = payload.timestamp || new Date().toISOString();

    current.authority_action = payload.action;
    current.authority_officer_id = payload.officer_id;
    current.updated_at = nowIso;

    switch (payload.action) {
      case 'close':
        current.state = 'RED';
        current.stage = 2;
        current.confidence = Math.max(current.confidence || 0.5, 0.95);
        current.reason = current.reason ? `${current.reason},authority_action` : 'authority_action';
        current.suggested_action = 'reroute';
        current.priority_score = (current.priority_score && current.priority_score > 0)
          ? Math.round((current.priority_score * 1.25) * 10) / 10
          : 50.0;
        break;

      case 'divert':
        current.suggested_action = 'reroute';
        if (current.state === 'GREEN') {
          current.state = 'YELLOW';
          current.stage = 1;
        }
        break;

      case 'dispatch':
        current.suggested_action = 'dispatch';
        break;

      case 'monitor':
        current.suggested_action = 'monitor';
        break;

      case 'resolve':
        current.state = 'GREEN';
        current.stage = 0;
        current.confidence = 0.05;
        current.reason = 'resolved_by_authority';
        current.disruption_type = null;
        current.affected_count = 0;
        current.suggested_action = null;
        current.priority_score = 0.0;
        break;
    }

    this.state[idx] = current;
    localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_STATE, JSON.stringify(this.state));
    this.notifySubscribers();
    return current;
  }

  getHardcodedFallbackState() {
    return [
      {
        "segment_id": "SEG_001",
        "state": "RED",
        "stage": 2,
        "confidence": 0.88,
        "reason": "rain_threshold_crossed,cctv_anomaly,speed_drop",
        "disruption_type": "waterlogging",
        "affected_count": 24,
        "alt_routes": ["Via Mount Road — Gemini Flyover Approach (SEG_002) (+9 min)"],
        "alt_route_details": [{ "via_segments": ["SEG_002"], "extra_minutes": 9.0, "distance_km": 4.1 }],
        "suggested_action": "close",
        "priority_score": 42.2,
        "authority_action": null,
        "authority_officer_id": null,
        "updated_at": new Date().toISOString(),
        "valid_until": null
      },
      {
        "segment_id": "SEG_002",
        "state": "GREEN",
        "stage": 0,
        "confidence": 0.05,
        "reason": "normal_flow",
        "disruption_type": null,
        "affected_count": 0,
        "alt_routes": [],
        "alt_route_details": [],
        "suggested_action": null,
        "priority_score": 0.0,
        "authority_action": null,
        "authority_officer_id": null,
        "updated_at": new Date().toISOString(),
        "valid_until": null
      },
      {
        "segment_id": "SEG_003",
        "state": "YELLOW",
        "stage": 1,
        "confidence": 0.45,
        "reason": "rain_threshold_crossed,flood_risk",
        "disruption_type": "flood_risk",
        "affected_count": 7,
        "alt_routes": ["Via Mount Road — Gemini Flyover Approach (SEG_002) (+6 min)"],
        "alt_route_details": [{ "via_segments": ["SEG_002"], "extra_minutes": 6.0, "distance_km": 2.8 }],
        "suggested_action": "monitor",
        "priority_score": 15.8,
        "authority_action": null,
        "authority_officer_id": null,
        "updated_at": new Date().toISOString(),
        "valid_until": null
      },
      {
        "segment_id": "SEG_004",
        "state": "YELLOW",
        "stage": 1,
        "confidence": 0.52,
        "reason": "fleet_stop,complaint",
        "disruption_type": "accident",
        "affected_count": 12,
        "alt_routes": ["Via Velachery Main Road — Taramani Bridge (SEG_005) (+5 min)"],
        "alt_route_details": [{ "via_segments": ["SEG_005"], "extra_minutes": 5.0, "distance_km": 2.2 }],
        "suggested_action": "dispatch",
        "priority_score": 18.7,
        "authority_action": null,
        "authority_officer_id": null,
        "updated_at": new Date().toISOString(),
        "valid_until": null
      },
      {
        "segment_id": "SEG_005",
        "state": "GREEN",
        "stage": 0,
        "confidence": 0.08,
        "reason": "normal_flow",
        "disruption_type": null,
        "affected_count": 0,
        "alt_routes": [],
        "alt_route_details": [],
        "suggested_action": null,
        "priority_score": 0.0,
        "authority_action": null,
        "authority_officer_id": null,
        "updated_at": new Date().toISOString(),
        "valid_until": null
      },
      {
        "segment_id": "SEG_006",
        "state": "GREEN",
        "stage": 0,
        "confidence": 0.02,
        "reason": "normal_flow",
        "disruption_type": null,
        "affected_count": 0,
        "alt_routes": [],
        "alt_route_details": [],
        "suggested_action": null,
        "priority_score": 0.0,
        "authority_action": null,
        "authority_officer_id": null,
        "updated_at": new Date().toISOString(),
        "valid_until": null
      }
    ];
  }
}

window.StateService = StateService;
window.stateService = new StateService();
