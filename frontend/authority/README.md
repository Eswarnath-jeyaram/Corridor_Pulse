# Traffic Authority Dashboard (Track D)

Grounded, utilitarian Command & Control Center for Greater Chennai Traffic Police / Traffic Management Authority.

## Directory Structure

```
frontend/authority/
├── index.html            # Main Command Center interface
├── css/
│   └── dashboard.css     # Traffic Police White & Khaki theme + Dark Mode styling
├── js/
│   ├── config.js         # Endpoints, seed metadata (SEG_001–006, FZ_001–003), demo officer
│   ├── api.js            # Dual-mode state client (Mock State & Live WS + Polling fallback)
│   └── dashboard.js      # Controller: Login gate, Priority queue, OSM map & schematic fallback, Action console
├── mock_state.json       # Canonical mock dataset conforming to CentralState[] schema
└── README.md             # Documentation
```

## Aesthetic & Design Details

- **Traffic Police White & Khaki Palette (Default):**
  - Warm off-white canvas (`#F4F1EA`) with clean white card surfaces (`#FFFFFF`).
  - Khaki & sand hairline borders and control accents (`#E6DCC4`, `#D6C7A5`, `#B8A478`).
  - High-contrast dark charcoal/ink typography (`#1B1F24`, `#2A2419`, `#4A4539`).
  - Deep Traffic Police Navy (`#1E3A8A`) for primary action buttons and officer identification.
  - Strict reservation of `RED`, `YELLOW`, and `GREEN` for segment status badges and map polylines only.
- **Calm Dark Mode:**
  - Persisted in `localStorage` via the theme toggle button.
  - Charcoal & slate police operations room styling (`#11141A`, `#171C24`, `#1E2430`) without purple/indigo gradients or glowing tropes.
- **Generous Spacing & Layout:**
  - 64px header bar with comfortable margins, gaps, and padding across all elements (Branding, IST Clock, Status Pill, Mode Switcher, Reset, Theme Toggle, and Officer Profile badge).
  - 490px left queue pane with spacious cards, clear hierarchy, and tabular numbers (`tabular-nums`).
- **Watermark-Free Map Tiles:**
  - Powered by standard OpenStreetMap tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) with no API key or watermark.
  - One-click toggle between live Map View and offline **Road Schematic View** (`#btn-toggle-map-view`).

## How to Run Locally

You can serve this directory with any local static HTTP server:

```bash
# From workspace root:
python -m http.server 8080 --directory frontend/authority
```
Open `http://localhost:8080` in your browser.
