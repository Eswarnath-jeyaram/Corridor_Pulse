/**
 * TrafficSense — Traffic Authority API & State Client
 * Track D | Phase 0 - Phase 4 Foundation
 * Supports seamless switching between Local Mock Mode and Live Backend
 * Step 3: Full Demo Event & Rain Simulator Ingest + Act Loader
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
          if (msg && msg.type === "snapshot" && Array.isArray(msg.segments)) {
            // D-1: Live WebSocket snapshot containing full segments array
            this.state = msg.segments;
            this.notifySubscribers();
          } else if (Array.isArray(msg)) {
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
      const updatedItem = this.applyMockAuthorityAction(payload);
      return { status: 'applied', state: updatedItem, mode: 'mock' };
    } else {
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
        current.reason = current.reason && current.reason !== 'normal_flow' ? `${current.reason},authority_action` : 'authority_action';
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

  // ==========================================
  // Step 3: Demo Event & Rain Simulator Ingest
  // ==========================================

  async injectSimulatorEvent(eventPayload) {
    // Validates SimulatorEvent contract: { type, segment_id, params }
    if (!eventPayload.type) {
      throw new Error('SimulatorEvent requires "type"');
    }

    const payload = {
      type: eventPayload.type,
      segment_id: eventPayload.segment_id || 'ALL',
      params: eventPayload.params || {}
    };

    if (this.mode === 'mock') {
      const updated = this.applyMockSimulatorEvent(payload);
      return { status: 'injected', state: updated, mode: 'mock' };
    } else {
      // Live HTTP POST /api/demo/simulate
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/demo/simulate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const result = await response.json();
        // Refresh live state
        await this.fetchLiveState();
        return { status: 'injected', result, mode: 'live' };
      } catch (err) {
        console.error('[StateService] Failed to send live SimulatorEvent:', err);
        throw err;
      }
    }
  }

  applyMockSimulatorEvent(payload) {
    const { type, segment_id, params } = payload;
    const nowIso = new Date().toISOString();

    if (type === 'reset') {
      if (segment_id === 'ALL' || !segment_id) {
        this.state = this.state.map(seg => ({
          ...seg,
          state: 'GREEN',
          stage: 0,
          confidence: 0.04,
          reason: 'normal_flow',
          disruption_type: null,
          affected_count: 0,
          suggested_action: null,
          priority_score: 0.0,
          authority_action: null,
          authority_officer_id: null,
          updated_at: nowIso
        }));
      } else {
        const idx = this.state.findIndex(s => s.segment_id === segment_id);
        if (idx !== -1) {
          this.state[idx] = {
            ...this.state[idx],
            state: 'GREEN',
            stage: 0,
            confidence: 0.04,
            reason: 'normal_flow',
            disruption_type: null,
            affected_count: 0,
            suggested_action: null,
            priority_score: 0.0,
            authority_action: null,
            authority_officer_id: null,
            updated_at: nowIso
          };
        }
      }
      localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_STATE, JSON.stringify(this.state));
      this.notifySubscribers();
      return this.state;
    }

    const idx = this.state.findIndex(s => s.segment_id === segment_id);
    if (idx === -1) {
      throw new Error(`Segment ${segment_id} not found`);
    }

    const current = { ...this.state[idx] };
    const meta = CONFIG.SEGMENTS_METADATA[segment_id] || {};

    switch (type) {
      case 'cctv_anomaly': {
        const conf = typeof params.anomaly_confidence === 'number' ? params.anomaly_confidence : 0.65;
        const anomType = params.anomaly_type || 'waterlogging';
        const vehCount = params.vehicle_count || 18;

        if (conf >= 0.50) {
          current.state = 'RED';
          current.stage = 2;
          current.confidence = conf;
          current.disruption_type = anomType;
          current.reason = current.reason && current.reason !== 'normal_flow' ? `${current.reason},cctv_anomaly` : 'cctv_anomaly';
          current.suggested_action = (anomType === 'waterlogging' || anomType === 'accident') ? 'close' : 'reroute';
          current.affected_count = Math.max(current.affected_count || 0, vehCount);
          current.priority_score = Math.round(conf * current.affected_count * 2.2 * 10) / 10;
        } else if (conf >= 0.35) {
          current.state = 'YELLOW';
          current.stage = 1;
          current.confidence = conf;
          current.disruption_type = anomType;
          current.reason = current.reason && current.reason !== 'normal_flow' ? `${current.reason},cctv_anomaly` : 'cctv_anomaly';
          current.suggested_action = 'monitor';
          current.affected_count = Math.max(current.affected_count || 0, Math.round(vehCount * 0.6));
          current.priority_score = Math.round(conf * current.affected_count * 1.3 * 10) / 10;
        }
        current.updated_at = nowIso;
        break;
      }

      case 'rain': {
        const rainMm = typeof params.rain_mm === 'number' ? params.rain_mm : 18.0;
        const thresh = meta.flood_rain_threshold_mm || 14.0;
        const severe = meta.flood_severe_threshold_mm || 25.0;

        if (meta.flood_prone && rainMm >= thresh) {
          if (current.state === 'GREEN') {
            current.state = 'YELLOW';
            current.stage = 1;
            current.confidence = Math.min(0.48, Math.round((rainMm / 35.0) * 50) / 100);
            current.disruption_type = 'flood_risk';
            current.reason = 'rain_threshold_crossed,flood_risk';
            current.suggested_action = 'monitor';
            current.affected_count = 6;
            current.priority_score = 12.8;
          } else if (rainMm >= severe) {
            current.confidence = Math.min(0.85, (current.confidence || 0.45) + 0.3);
            if (current.reason && (current.reason.includes('speed_drop') || current.reason.includes('cctv_anomaly'))) {
              current.state = 'RED';
              current.stage = 2;
              current.suggested_action = 'close';
              current.priority_score = Math.round((current.confidence * 25 * 2.0) * 10) / 10;
            }
          }
        }
        current.updated_at = nowIso;
        break;
      }

      case 'speed': {
        const speedKmh = typeof params.speed_kmh === 'number' ? params.speed_kmh : 8;
        const count = params.count || 3;

        if (speedKmh <= 15) {
          if (current.state === 'YELLOW' || (current.reason && (current.reason.includes('flood_risk') || current.reason.includes('cctv_anomaly')))) {
            current.state = 'RED';
            current.stage = 2;
            current.confidence = Math.max(current.confidence || 0.5, 0.85);
            current.reason = current.reason && current.reason !== 'normal_flow' ? `${current.reason},speed_drop` : 'speed_drop';
            current.affected_count = (current.affected_count || 0) + (count * 6);
            current.suggested_action = 'close';
            current.priority_score = Math.round((current.confidence * current.affected_count * 1.8) * 10) / 10;
          } else {
            current.state = 'YELLOW';
            current.stage = 1;
            current.confidence = 0.40;
            current.disruption_type = current.disruption_type || 'congestion';
            current.reason = current.reason && current.reason !== 'normal_flow' ? `${current.reason},speed_drop` : 'speed_drop';
            current.affected_count = (current.affected_count || 0) + (count * 3);
            current.suggested_action = 'monitor';
            current.priority_score = 14.2;
          }
        }
        current.updated_at = nowIso;
        break;
      }

      case 'complaint': {
        const cat = params.category || 'waterlogging';
        current.disruption_type = cat;
        current.reason = current.reason && current.reason !== 'normal_flow' ? `${current.reason},complaint` : 'complaint';

        if (current.state === 'YELLOW' && (current.reason.includes('speed_drop') || current.reason.includes('cctv_anomaly'))) {
          current.state = 'RED';
          current.stage = 2;
          current.confidence = Math.min(0.92, (current.confidence || 0.5) + 0.22);
          current.suggested_action = 'dispatch';
        } else if (current.state === 'GREEN') {
          current.state = 'YELLOW';
          current.stage = 1;
          current.confidence = 0.35;
          current.suggested_action = 'monitor';
        }
        current.affected_count = (current.affected_count || 0) + 5;
        current.priority_score = Math.round(((current.confidence || 0.4) * current.affected_count * 1.6) * 10) / 10;
        current.updated_at = nowIso;
        break;
      }
    }

    this.state[idx] = current;
    localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_STATE, JSON.stringify(this.state));
    this.notifySubscribers();
    return this.state;
  }

  // ==========================================
  // Demo Act Loader (Acts 1 to 5)
  // ==========================================

  async loadActScenario(actNumber) {
    const actMeta = CONFIG.ACTS_METADATA.find(a => a.act === actNumber);
    if (!actMeta) throw new Error(`Unknown Act: ${actNumber}`);

    if (this.mode === 'mock') {
      try {
        // Try fetching scenario JSON file
        const res = await fetch(`../../demo/scenarios/${actMeta.scenario_file}?t=` + Date.now());
        if (res.ok) {
          const scenarioData = await res.json();
          if (scenarioData.expected_state && Array.isArray(scenarioData.expected_state)) {
            this.state = scenarioData.expected_state;
            localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_STATE, JSON.stringify(this.state));
            this.notifySubscribers();
            return { act: actNumber, name: actMeta.name, source: 'file' };
          }
        }
      } catch (e) {
        console.warn(`[StateService] Direct fetch of ${actMeta.scenario_file} failed, using synthetic act builder:`, e);
      }

      // Synthetic Act Generator Fallback
      this.applySyntheticAct(actNumber);
      return { act: actNumber, name: actMeta.name, source: 'synthetic' };
    } else {
      // Live Mode: trigger actual API simulate call for the act
      if (actNumber === 1 || actNumber === 5) {
        await this.injectSimulatorEvent({ type: 'reset', segment_id: 'ALL' });
      } else if (actNumber === 2) {
        await this.injectSimulatorEvent({ type: 'rain', segment_id: 'SEG_001', params: { rain_mm: 18.0 } });
      } else if (actNumber === 3) {
        await this.injectSimulatorEvent({ type: 'speed', segment_id: 'SEG_001', params: { speed_kmh: 8.0, count: 3 } });
        await this.injectSimulatorEvent({ type: 'cctv_anomaly', segment_id: 'SEG_001', params: { anomaly_confidence: 0.65 } });
      } else if (actNumber === 4) {
        await this.submitAuthorityAction({
          segment_id: 'SEG_001',
          action: 'close',
          officer_id: CONFIG.DEMO_OFFICER.officer_id,
          note: 'Triplicane underpass officially closed. Diversion issued.'
        });
      }
      return { act: actNumber, name: actMeta.name, source: 'live_api' };
    }
  }

  applySyntheticAct(actNumber) {
    const nowIso = new Date().toISOString();
    if (actNumber === 1 || actNumber === 5) {
      this.state = this.state.map(s => ({
        ...s,
        state: 'GREEN',
        stage: 0,
        confidence: 0.04,
        reason: 'normal_flow',
        disruption_type: null,
        affected_count: 0,
        suggested_action: null,
        priority_score: 0.0,
        authority_action: actNumber === 5 ? 'resolve' : null,
        authority_officer_id: actNumber === 5 ? CONFIG.DEMO_OFFICER.officer_id : null,
        updated_at: nowIso
      }));
    } else if (actNumber === 2) {
      this.applyMockSimulatorEvent({ type: 'reset', segment_id: 'ALL' });
      this.applyMockSimulatorEvent({ type: 'rain', segment_id: 'SEG_001', params: { rain_mm: 18.0 } });
    } else if (actNumber === 3) {
      this.applyMockSimulatorEvent({ type: 'rain', segment_id: 'SEG_001', params: { rain_mm: 18.0 } });
      this.applyMockSimulatorEvent({ type: 'speed', segment_id: 'SEG_001', params: { speed_kmh: 8.0, count: 3 } });
      this.applyMockSimulatorEvent({ type: 'cctv_anomaly', segment_id: 'SEG_001', params: { anomaly_confidence: 0.65, anomaly_type: 'waterlogging' } });
      this.applyMockSimulatorEvent({ type: 'complaint', segment_id: 'SEG_001', params: { category: 'waterlogging' } });
    } else if (actNumber === 4) {
      this.applyMockAuthorityAction({
        segment_id: 'SEG_001',
        action: 'close',
        officer_id: CONFIG.DEMO_OFFICER.officer_id,
        note: 'Triplicane underpass submerged. Official closure initiated, traffic diverted to Gemini Flyover.',
        timestamp: nowIso
      });
    }
    localStorage.setItem(CONFIG.STORAGE_KEYS.MOCK_STATE, JSON.stringify(this.state));
    this.notifySubscribers();
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
