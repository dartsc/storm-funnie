# ⚡ SatGuard — Satellite Power Outage Predictor

A fully functional, single-page web application that combines real-time satellite telemetry, satellite-based weather data, and seismic activity to predict the likelihood of a power outage at your location.

---

## 🚀 Quick Start

No build step required. Just open `index.html` in any modern browser:

```bash
# Option 1: double-click index.html in your file explorer

# Option 2: serve locally (recommended to avoid CORS issues)
npx serve .
# or
python3 -m http.server 8080
```

Then visit `http://localhost:8080` (or `http://localhost:3000` for `serve`).

> **Note:** The browser will ask for your location permission. You can also enter coordinates manually.

---

## 🛰️ Features

| Panel | Description |
|---|---|
| **Satellite Tracker** | Live ISS position, altitude, velocity, distance from your location, and a Leaflet.js map |
| **Satellite Weather** | Real-time weather via Open-Meteo: temperature, humidity, wind speed & gusts, precipitation, cloud cover, visibility, storm code, and a 24-hour forecast chart |
| **Seismic Activity** | USGS earthquake data within ~555 km of your location over the past 7 days |
| **Power Outage Risk Gauge** | Colour-coded 0–100% risk score with confidence percentage |
| **Risk Factor Breakdown** | Tabular breakdown of every contributing factor with a human-readable summary |

### Risk Model

The outage risk score is a weighted combination of:

| Factor | Weight |
|---|---|
| Wind speed > 40 mph | 20% |
| Wind gusts > 60 mph | 25% |
| Heavy precipitation > 10 mm/hr | 15% |
| Thunderstorm / lightning (WMO code) | 20% |
| Nearby seismic activity (M ≥ 3.0) | 10% |
| Rapid pressure drop (> 5 hPa/hr) | 10% |

The **confidence percentage** is derived from data availability (how many APIs responded) and factor overlap (multiple active factors increase confidence).

---

## 📡 APIs Used

| API | Purpose | Key Required? |
|---|---|---|
| [WhereTheISS](https://api.wheretheiss.at/) | Real-time ISS position | No |
| [Open-Meteo](https://open-meteo.com/) | Weather, wind, precipitation | No |
| [USGS Earthquake API](https://earthquake.usgs.gov/fdsnws/event/1/) | Seismic activity | No |
| Browser Geolocation API | User's coordinates | No |

---

## 🧰 Tech Stack

- **Pure HTML / CSS / JavaScript** — no build tools, no npm
- **[Leaflet.js](https://leafletjs.com/)** (v1.9.4) — satellite position map
- **[Chart.js](https://www.chartjs.org/)** (v4.4.2) — risk gauge + weather forecast chart
- Dark space-themed UI with CSS custom properties, neon glows, and responsive grid layout

---

## 📁 File Structure

```
/
├── index.html        # App shell & UI layout
├── css/
│   └── style.css     # Dark space-themed styles
├── js/
│   └── app.js        # All API calls, risk model, chart rendering
└── README.md
```

---

## 🔄 Auto-Refresh

All data panels refresh automatically every **60 seconds** once a location is set. A countdown timer in the top-right corner shows time until the next refresh.

---

## ⚠️ Disclaimer

SatGuard is for informational and demonstration purposes only. Do not use it as the sole basis for any critical infrastructure or emergency decisions.
