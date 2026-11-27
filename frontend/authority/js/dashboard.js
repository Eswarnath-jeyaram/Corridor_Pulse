/**
 * TrafficSense — Traffic Authority Dashboard Controller
 * Track D | Phase 0 - Phase 4 Foundation
 * Features: White & Khaki Traffic Police Theme, OpenStreetMap tiles, Offline Schematic Fallback
 */

class DashboardController {
  constructor() {
    this.officer = null;
    this.selectedSegmentId = 'SEG_001';
    this.currentFilter = 'all'; // 'all' | 'RED' | 'YELLOW' | 'GREEN'
    this.map = null;
    this.segmentPolylines = {};
    this.segmentMarkers = {};
    this.floodZoneLayers = [];
    this.cctvLayers = [];
    this.layersVisible = {
      flood: true,
      cctv: true,
      routes: true
    };
    this.auditLogs = [];
  }

  init() {
    this.initTheme();
    this.initAuth();
    this.initClock();
    this.initAuditLog();
    this.initEvents();

    // Initialize State Service
    window.stateService.onStateChange((state) => this.handleStateUpdate(state));
    window.stateService.onStatusChange((status) => this.handleStatusUpdate(status));
    window.stateService.init();

    // Initialize Map with OpenStreetMap and offline resilience
    this.initMap();
  }

  // ==========================================
  // Authentication & Login Gate
  // ==========================================

  initAuth() {
    const stored = localStorage.getItem(CONFIG.STORAGE_KEYS.OFFICER);
    if (stored) {
      try {
        this.officer = JSON.parse(stored);
        this.renderOfficerBadge();
        this.hideLoginModal();
      } catch (e) {
        this.showLoginModal();
      }
    } else {
      this.showLoginModal();
    }
  }

  showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.remove('hidden');
  }

  hideLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.classList.add('hidden');
  }

  quickFillDemoOfficer() {
    document.getElementById('login-officer-id').value = CONFIG.DEMO_OFFICER.officer_id;
    document.getElementById('login-officer-name').value = CONFIG.DEMO_OFFICER.name;
    document.getElementById('login-zone').value = "central";
    this.handleLoginSubmit();
  }

  handleLoginSubmit(event) {
    if (event) event.preventDefault();
    const officerId = document.getElementById('login-officer-id').value.trim() || CONFIG.DEMO_OFFICER.officer_id;
    const name = document.getElementById('login-officer-name').value.trim() || CONFIG.DEMO_OFFICER.name;
    const zone = document.getElementById('login-zone').value || "central";

    this.officer = {
      officer_id: officerId,
      name: name,
      zone: zone,
      login_time: new Date().toISOString()
    };

    localStorage.setItem(CONFIG.STORAGE_KEYS.OFFICER, JSON.stringify(this.officer));
    this.renderOfficerBadge();
    this.hideLoginModal();
    this.showToast(`Officer signed in: ${officerId}`, 'success');
  }

  handleSignOut() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.OFFICER);
    this.officer = null;
    this.showLoginModal();
    this.showToast('Officer signed out', 'warning');
  }

  renderOfficerBadge() {
    const badgeEl = document.getElementById('officer-badge-container');
    if (!badgeEl) return;
    if (this.officer) {
      badgeEl.innerHTML = `
        <div class="officer-badge">
          <span class="officer-id">${this.escapeHtml(this.officer.officer_id)}</span>
          <span class="officer-name">${this.escapeHtml(this.officer.name)}</span>
          <button id="btn-sign-out" class="btn-icon" title="Sign Out" style="margin-left: 6px; padding: 3px 8px; font-size: 11px;">Sign Out</button>
        </div>
      `;
      document.getElementById('btn-sign-out')?.addEventListener('click', () => this.handleSignOut());
    } else {
      badgeEl.innerHTML = `
        <button id="btn-open-login" class="btn btn-primary" style="padding: 6px 14px;">Officer Login</button>
      `;
      document.getElementById('btn-open-login')?.addEventListener('click', () => this.showLoginModal());
    }
  }

  // ==========================================
  // Theme Switching (White & Khaki vs Dark Mode)
  // ==========================================

  initTheme() {
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.THEME) || 'khaki';
    document.documentElement.setAttribute('data-theme', saved);
    this.updateThemeButton(saved);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'khaki';
    const next = current === 'dark' ? 'khaki' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(CONFIG.STORAGE_KEYS.THEME, next);
    this.updateThemeButton(next);
  }

  updateThemeButton(theme) {
    const btn = document.getElementById('btn-toggle-theme');
    if (btn) {
      btn.innerHTML = theme === 'dark' ? '☀️ Khaki Theme' : '🌙 Dark Mode';
    }
  }

  // ==========================================
  // Clock
  // ==========================================

  initClock() {
    const clockEl = document.getElementById('sys-clock');
    const update = () => {
      const now = new Date();
      const istStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
      if (clockEl) {
        clockEl.textContent = `IST ${istStr} | ${now.toISOString().slice(0, 10)}`;
      }
    };
    update();
    setInterval(update, 1000);
  }

  // ==========================================
  // Audit Log
  // ==========================================

  initAuditLog() {
    try {
      const stored = localStorage.getItem(CONFIG.STORAGE_KEYS.AUDIT_LOG);
      if (stored) this.auditLogs = JSON.parse(stored);
    } catch (e) {
      this.auditLogs = [];
    }
  }

  recordAuditAction(actionPayload, status = 'applied') {
    const entry = {
      timestamp: new Date().toISOString(),
      officer_id: actionPayload.officer_id,
      segment_id: actionPayload.segment_id,
      action: actionPayload.action,
      note: actionPayload.note || '—',
      status: status
    };
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 50) this.auditLogs.pop();
    localStorage.setItem(CONFIG.STORAGE_KEYS.AUDIT_LOG, JSON.stringify(this.auditLogs));
    this.renderAuditLog();
  }

  renderAuditLog() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;
    if (this.auditLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No authority actions logged in this session.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.auditLogs.map(log => `
      <tr>
        <td class="tabular">${new Date(log.timestamp).toLocaleTimeString()}</td>
        <td class="tabular"><strong>${this.escapeHtml(log.segment_id)}</strong></td>
        <td><span class="badge" style="background: var(--bg-surface-elevated); border: 1px solid var(--border-strong); text-transform: uppercase;">${this.escapeHtml(log.action)}</span></td>
        <td class="tabular">${this.escapeHtml(log.officer_id)}</td>
        <td>${this.escapeHtml(log.note)}</td>
      </tr>
    `).join('');
  }

  // ==========================================
  // State Updates & Queue Rendering
  // ==========================================

  handleStateUpdate(stateArray) {
    this.renderQueue(stateArray);
    this.updateInspector(stateArray);
    this.updateMapLayers(stateArray);
  }

  handleStatusUpdate({ status, detail, mode }) {
    const pill = document.getElementById('connection-status-pill');
    const dot = document.getElementById('connection-status-dot');
    const text = document.getElementById('connection-status-text');
    const modeSelect = document.getElementById('data-mode-select');

    if (modeSelect) modeSelect.value = mode;

    if (dot) {
      dot.className = `status-dot ${status}`;
    }

    if (text) {
      if (mode === 'mock') {
        text.textContent = 'MOCK MODE';
        pill.title = 'Running locally on mock_state.json';
      } else if (status === 'connected') {
        text.textContent = 'LIVE WS CONNECTED';
        pill.title = detail;
      } else if (status === 'polling') {
        text.textContent = 'LIVE POLLING (5s)';
        pill.title = detail;
      } else {
        text.textContent = status.toUpperCase();
        pill.title = detail;
      }
    }
  }

  renderQueue(stateArray) {
    const listEl = document.getElementById('queue-list');
    const countEl = document.getElementById('queue-count');
    if (!listEl) return;

    // Sort by priority_score descending (highest urgency first)
    const sorted = [...stateArray].sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

    // Filter
    const filtered = sorted.filter(item => {
      if (this.currentFilter === 'all') return true;
      return item.state === this.currentFilter;
    });

    if (countEl) {
      countEl.textContent = `${filtered.length} / ${sorted.length}`;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No corridors match current filter (${this.currentFilter}).
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(item => {
      const meta = CONFIG.SEGMENTS_METADATA[item.segment_id] || {};
      const isSelected = item.segment_id === this.selectedSegmentId;
      const stateClass = `state-${item.state.toLowerCase()}`;
      const stateBadgeClass = `badge-state-${item.state.toLowerCase()}`;
      const stageText = item.stage === 2 ? 'Stage 2 (Confirmed)' : item.stage === 1 ? 'Stage 1 (Alert)' : 'Stage 0 (Clear)';
      const confPct = Math.round((item.confidence || 0) * 100);

      return `
        <div class="queue-item ${stateClass} ${isSelected ? 'selected' : ''}" data-segment-id="${item.segment_id}">
          <div class="item-top">
            <div>
              <span class="item-segment-id">${item.segment_id}</span>
              <div class="item-road-name">${this.escapeHtml(meta.name || item.segment_id)}</div>
            </div>
            <div class="badge-group">
              <span class="badge ${stateBadgeClass}">${item.state}</span>
              <span class="badge badge-stage">${stageText}</span>
            </div>
          </div>

          <div class="item-metrics-grid">
            <div class="metric-col">
              <span class="metric-label">Priority</span>
              <span class="metric-val tabular">${(item.priority_score || 0).toFixed(1)}</span>
            </div>
            <div class="metric-col">
              <span class="metric-label">Confidence</span>
              <span class="metric-val tabular">${confPct}%</span>
            </div>
            <div class="metric-col">
              <span class="metric-label">Affected</span>
              <span class="metric-val tabular">${item.affected_count || 0} veh</span>
            </div>
          </div>

          <div class="item-reason">
            <span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 600;">Signals:</span>
            <span class="reason-tag">${this.escapeHtml(item.reason || 'none')}</span>
            ${item.disruption_type ? `<span class="reason-tag" style="color: var(--status-red-text); border-color: var(--status-red-border);">${this.escapeHtml(item.disruption_type)}</span>` : ''}
          </div>

          <div class="item-footer">
            <span>
              ${item.suggested_action ? `Action: <span class="suggested-action-tag">${item.suggested_action}</span>` : 'Normal monitoring'}
            </span>
            <span class="tabular">${new Date(item.updated_at).toLocaleTimeString()}</span>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to cards
    listEl.querySelectorAll('.queue-item').forEach(card => {
      card.addEventListener('click', () => {
        const segId = card.getAttribute('data-segment-id');
        this.selectSegment(segId);
      });
    });
  }

  selectSegment(segmentId) {
    this.selectedSegmentId = segmentId;

    // Update queue selection styles
    document.querySelectorAll('.queue-item').forEach(el => {
      if (el.getAttribute('data-segment-id') === segmentId) {
        el.classList.add('selected');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        el.classList.remove('selected');
      }
    });

    this.updateInspector(window.stateService.state);
    this.highlightSegmentOnMap(segmentId);
  }

  updateInspector(stateArray) {
    const item = stateArray.find(s => s.segment_id === this.selectedSegmentId) || stateArray[0];
    if (!item) return;

    const meta = CONFIG.SEGMENTS_METADATA[item.segment_id] || {};
    const floodMeta = CONFIG.FLOOD_ZONES.find(f => f.segment_id === item.segment_id);

    // Header info
    document.getElementById('insp-segment-id').textContent = item.segment_id;
    document.getElementById('insp-road-name').textContent = meta.name || item.segment_id;
    document.getElementById('insp-status-badge').className = `badge badge-state-${item.state.toLowerCase()}`;
    document.getElementById('insp-status-badge').textContent = item.state;

    // Table fields
    document.getElementById('insp-road-type').textContent = meta.road_type ? meta.road_type.toUpperCase() : 'ARTERIAL';
    document.getElementById('insp-speed-limit').textContent = `${meta.speed_limit_kmh || 50} km/h`;
    document.getElementById('insp-priority-score').textContent = (item.priority_score || 0).toFixed(1);
    document.getElementById('insp-confidence').textContent = `${Math.round((item.confidence || 0) * 100)}% (Stage ${item.stage})`;
    document.getElementById('insp-disruption-type').textContent = item.disruption_type || 'None';
    document.getElementById('insp-reason').textContent = item.reason || 'normal_flow';
    document.getElementById('insp-affected-count').textContent = `${item.affected_count || 0} vehicles in window`;
    document.getElementById('insp-cctv-status').textContent = meta.has_cctv ? 'Camera Active (YOLOv8n Ingest)' : 'No CCTV (Telemetry only)';
    document.getElementById('insp-flood-prone').textContent = meta.flood_prone 
      ? `Yes (Threshold: ${meta.flood_rain_threshold_mm} mm/hr)` 
      : 'No';

    // Authority action history
    const authStatusEl = document.getElementById('insp-authority-action');
    if (item.authority_action) {
      authStatusEl.innerHTML = `<strong style="color: var(--action-navy-text);">${item.authority_action.toUpperCase()}</strong> by ${this.escapeHtml(item.authority_officer_id || 'Officer')} at ${new Date(item.updated_at).toLocaleTimeString()}`;
    } else {
      authStatusEl.textContent = 'None taken';
    }

    // Alternate routes
    const altRoutesEl = document.getElementById('insp-alt-routes');
    if (item.alt_routes && item.alt_routes.length > 0) {
      altRoutesEl.innerHTML = item.alt_routes.map(r => `<div style="margin-bottom: 3px;">• ${this.escapeHtml(r)}</div>`).join('');
    } else {
      altRoutesEl.textContent = 'Direct route clear / No diversion advised';
    }
  }

  // ==========================================
  // Leaflet Map (OpenStreetMap) & Schematic Fallback
  // ==========================================

  initMap() {
    const mapEl = document.getElementById('map');
    const fallbackEl = document.getElementById('map-fallback');
    if (!mapEl) return;

    if (typeof L === 'undefined') {
      console.warn('[DashboardController] Leaflet not available, activating SVG schematic fallback');
      this.activateFallbackMap();
      return;
    }

    try {
      // Chennai Center
      this.map = L.map('map', {
        center: [13.045, 80.235],
        zoom: 12,
        zoomControl: true,
        attributionControl: false
      });

      // Standard OpenStreetMap tiles (No API key required, no watermark)
      const osmTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
        timeout: 6000
      });

      osmTileLayer.on('tileerror', (e) => {
        console.warn('[DashboardController] OSM tile load error, ensuring fallback is available:', e);
      });

      osmTileLayer.addTo(this.map);

      // Render initial segments & flood zones
      this.createMapLayers();
    } catch (err) {
      console.warn('[DashboardController] Map initialization failed, switching to SVG schematic:', err);
      this.activateFallbackMap();
    }
  }

  createMapLayers() {
    if (!this.map) return;

    // Segment Polylines
    Object.entries(CONFIG.SEGMENTS_METADATA).forEach(([segId, seg]) => {
      const latlngs = [
        [seg.lat_start, seg.lon_start],
        [seg.lat_end, seg.lon_end]
      ];

      const polyline = L.polyline(latlngs, {
        color: '#15803d',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round'
      }).addTo(this.map);

      polyline.on('click', () => {
        this.selectSegment(segId);
      });

      polyline.bindTooltip(`<strong>${segId}</strong>: ${seg.name}`, { sticky: true });
      this.segmentPolylines[segId] = polyline;

      // Start Marker
      const startMarker = L.circleMarker([seg.lat_start, seg.lon_start], {
        radius: 4,
        color: '#ffffff',
        weight: 1.5,
        fillColor: '#1e3a8a',
        fillOpacity: 1
      }).addTo(this.map);
      this.segmentMarkers[segId] = startMarker;
    });

    // Flood Hazard Zones
    CONFIG.FLOOD_ZONES.forEach(fz => {
      const seg = CONFIG.SEGMENTS_METADATA[fz.segment_id];
      if (seg) {
        const circle = L.circle([seg.lat_start, seg.lon_start], {
          radius: 450,
          color: '#1e3a8a',
          weight: 1.5,
          dashArray: '4, 4',
          fillColor: '#1e3a8a',
          fillOpacity: 0.12
        }).addTo(this.map);

        circle.bindTooltip(`🌊 Flood Hazard ${fz.flood_zone_id}: ${fz.name} (Threshold: ${fz.rain_threshold_mm} mm/hr)`);
        this.floodZoneLayers.push(circle);
      }
    });

    // Update with current live status
    this.updateMapLayers(window.stateService.state);
  }

  updateMapLayers(stateArray) {
    if (!this.map) {
      this.renderFallbackSchematic(stateArray);
      return;
    }

    stateArray.forEach(item => {
      const poly = this.segmentPolylines[item.segment_id];
      if (!poly) return;

      let color = '#15803d'; // GREEN
      let weight = 6;

      if (item.state === 'RED') {
        color = '#c92a2a';
        weight = 9;
      } else if (item.state === 'YELLOW') {
        color = '#d97706';
        weight = 8;
      }

      if (item.segment_id === this.selectedSegmentId) {
        weight += 3;
      }

      poly.setStyle({ color, weight });
    });
  }

  highlightSegmentOnMap(segmentId) {
    if (!this.map) {
      this.renderFallbackSchematic(window.stateService.state);
      return;
    }

    const poly = this.segmentPolylines[segmentId];
    if (poly) {
      const bounds = poly.getBounds();
      this.map.fitBounds(bounds, { maxZoom: 14, padding: [40, 40] });
    }
    this.updateMapLayers(window.stateService.state);
  }

  toggleMapView() {
    const mapEl = document.getElementById('map');
    const fallbackEl = document.getElementById('map-fallback');
    const btn = document.getElementById('btn-toggle-map-view');
    if (!mapEl || !fallbackEl) return;

    if (fallbackEl.classList.contains('active')) {
      fallbackEl.classList.remove('active');
      mapEl.style.display = 'block';
      if (this.map) {
        this.map.invalidateSize();
      }
      if (btn) btn.innerHTML = '📐 View Schematic View';
    } else {
      mapEl.style.display = 'none';
      fallbackEl.classList.add('active');
      this.renderFallbackSchematic(window.stateService.state);
      if (btn) btn.innerHTML = '🗺 View Map View';
    }
  }

  activateFallbackMap() {
    const mapEl = document.getElementById('map');
    const fallbackEl = document.getElementById('map-fallback');
    const btn = document.getElementById('btn-toggle-map-view');
    if (mapEl) mapEl.style.display = 'none';
    if (fallbackEl) {
      fallbackEl.classList.add('active');
      this.renderFallbackSchematic(window.stateService.state);
    }
    if (btn) btn.innerHTML = '🗺 View Map View';
  }

  renderFallbackSchematic(stateArray) {
    const fallbackEl = document.getElementById('map-fallback');
    if (!fallbackEl) return;

    const items = stateArray || window.stateService.state || [];
    fallbackEl.innerHTML = `
      <div style="margin-bottom: 14px; font-weight: 700; font-size: 13px; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px;">
        <span>CHENNAI ROAD CORRIDOR SCHEMATIC (OFFLINE OVERVIEW)</span>
        <span class="count-pill tabular">6 Monitored Corridors</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px;">
        ${items.map(s => {
          const meta = CONFIG.SEGMENTS_METADATA[s.segment_id] || {};
          const isSelected = s.segment_id === this.selectedSegmentId;
          const colorClass = s.state.toLowerCase();
          return `
            <div class="queue-item state-${colorClass} ${isSelected ? 'selected' : ''}" style="cursor: pointer;" onclick="window.dashboard.selectSegment('${s.segment_id}')">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span class="tabular" style="font-weight: 700; font-size: 13px;">${s.segment_id}</span>
                <span class="badge badge-state-${colorClass}">${s.state}</span>
              </div>
              <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${this.escapeHtml(meta.name || s.segment_id)}</div>
              <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">
                Type: <strong>${meta.road_type ? meta.road_type.toUpperCase() : 'ARTERIAL'}</strong> | Limit: ${meta.speed_limit_kmh} km/h<br/>
                GPS: ${meta.lat_start}, ${meta.lon_start} → ${meta.lat_end}, ${meta.lon_end}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ==========================================
  // Action Handlers
  // ==========================================

  async triggerAuthorityAction(actionType) {
    if (!this.officer) {
      this.showToast('Please sign in with Officer credentials before executing actions', 'danger');
      this.showLoginModal();
      return;
    }

    const segmentId = this.selectedSegmentId;
    const note = document.getElementById('action-note-input').value.trim();

    const payload = {
      segment_id: segmentId,
      action: actionType,
      officer_id: this.officer.officer_id,
      note: note || `Manual ${actionType.toUpperCase()} action taken from Authority Dashboard`,
      timestamp: new Date().toISOString()
    };

    try {
      const result = await window.stateService.submitAuthorityAction(payload);
      this.recordAuditAction(payload, result.status);
      this.showToast(`Action [${actionType.toUpperCase()}] applied to ${segmentId}`, 'success');
      document.getElementById('action-note-input').value = '';
    } catch (err) {
      this.showToast(`Failed to execute action: ${err.message}`, 'danger');
    }
  }

  // ==========================================
  // Event Bindings
  // ==========================================

  initEvents() {
    // Theme toggle
    document.getElementById('btn-toggle-theme')?.addEventListener('click', () => this.toggleTheme());

    // Map view toggle (Map vs Schematic)
    document.getElementById('btn-toggle-map-view')?.addEventListener('click', () => this.toggleMapView());

    // Mode select
    document.getElementById('data-mode-select')?.addEventListener('change', (e) => {
      const mode = e.target.value;
      window.stateService.setMode(mode);
      this.showToast(`Data mode switched to ${mode.toUpperCase()}`, 'warning');
    });

    // Reset Mock button
    document.getElementById('btn-reset-mock')?.addEventListener('click', async () => {
      if (confirm('Reset mock state to initial baseline?')) {
        await window.stateService.resetMockState();
        this.showToast('Mock state reset to baseline', 'success');
      }
    });

    // Queue filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentFilter = tab.getAttribute('data-filter');
        this.renderQueue(window.stateService.state);
      });
    });

    // Console tabs (Inspector vs Audit Log vs Flood Zones)
    document.querySelectorAll('.console-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.console-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
        tab.classList.add('active');
        const targetId = tab.getAttribute('data-target');
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.style.display = 'block';
        if (targetId === 'tab-audit-log') this.renderAuditLog();
      });
    });

    // Action Buttons
    document.getElementById('btn-action-close')?.addEventListener('click', () => this.triggerAuthorityAction('close'));
    document.getElementById('btn-action-divert')?.addEventListener('click', () => this.triggerAuthorityAction('divert'));
    document.getElementById('btn-action-dispatch')?.addEventListener('click', () => this.triggerAuthorityAction('dispatch'));
    document.getElementById('btn-action-monitor')?.addEventListener('click', () => this.triggerAuthorityAction('monitor'));
    document.getElementById('btn-action-resolve')?.addEventListener('click', () => this.triggerAuthorityAction('resolve'));

    // Login modal
    document.getElementById('login-form')?.addEventListener('submit', (e) => this.handleLoginSubmit(e));
    document.getElementById('btn-quick-fill-login')?.addEventListener('click', () => this.quickFillDemoOfficer());

    // Layer checkboxes
    document.getElementById('toggle-flood-layer')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      this.floodZoneLayers.forEach(l => checked ? l.addTo(this.map) : this.map.removeLayer(l));
    });
  }

  // ==========================================
  // Utilities
  // ==========================================

  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 3500);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Instantiate and expose globally
window.dashboard = new DashboardController();
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard.init();
});
