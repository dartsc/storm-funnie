/**
 * SatGuard — Satellite Power Outage Predictor
 * app.js — Main application logic
 */

/* ============================================================
   CONSTANTS & CONFIG
   ============================================================ */
const API = {
  ISS:     'https://api.wheretheiss.at/v1/satellites/25544',
  WEATHER: 'https://api.open-meteo.com/v1/forecast',
  QUAKE:   'https://earthquake.usgs.gov/fdsnws/event/1/query',
};

const REFRESH_INTERVAL = 60; // seconds

const SEISMIC_LOOKBACK_DAYS   = 7;
const SEISMIC_RADIUS_DEGREES  = 5;   // ~555 km
const SEISMIC_SIG_THRESHOLD   = 3.0; // magnitude threshold for "significant"
const SEISMIC_HIGH_MAG_BONUS  = 0.5; // extra contribution for M≥5
const SEISMIC_MED_MAG_BONUS   = 0.3; // extra contribution for M≥4
const SEISMIC_EVENT_DIVISOR   = 3;   // divisor for normalising event count

/* WMO Weather Code groups */
const WMO_THUNDERSTORM = [95, 96, 99];
const WMO_HEAVY_RAIN   = [65, 67, 75, 77, 82, 86];
const WMO_LABELS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Slight showers', 81: 'Moderate showers',
  82: 'Violent showers', 85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

/* Risk factor definitions */
const RISK_FACTORS = [
  {
    id: 'wind_speed',
    label: 'High Wind Speed (>40 mph)',
    weight: 0.20,
    threshold: 40,
    unit: 'mph',
    severity: 'High',
  },
  {
    id: 'wind_gusts',
    label: 'Extreme Wind Gusts (>60 mph)',
    weight: 0.25,
    threshold: 60,
    unit: 'mph',
    severity: 'Very High',
  },
  {
    id: 'heavy_precip',
    label: 'Heavy Precipitation (>10 mm/hr)',
    weight: 0.15,
    threshold: 10,
    unit: 'mm/hr',
    severity: 'Medium',
  },
  {
    id: 'thunderstorm',
    label: 'Thunderstorm / Lightning',
    weight: 0.20,
    threshold: 1,
    unit: 'boolean',
    severity: 'High',
  },
  {
    id: 'seismic',
    label: 'Nearby Seismic Activity (mag >3.0)',
    weight: 0.10,
    threshold: 3.0,
    unit: 'magnitude',
    severity: 'Medium',
  },
  {
    id: 'pressure_drop',
    label: 'Rapid Pressure Drop (>5 hPa/hr)',
    weight: 0.10,
    threshold: 5,
    unit: 'hPa/hr',
    severity: 'Medium',
  },
];

/* ============================================================
   STATE
   ============================================================ */
let state = {
  lat: null,
  lng: null,
  weather: null,
  satellite: null,
  seismic: null,
  riskScore: 0,
  confidence: 0,
  map: null,
  satMarker: null,
  userMarker: null,
  gaugeChart: null,
  weatherChart: null,
  refreshTimer: null,
  countdown: REFRESH_INTERVAL,
};

/* ============================================================
   UTILITIES
   ============================================================ */

/** Kilometres between two lat/lng points (Haversine) */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Convert km/h to mph */
const kmhToMph = (kmh) => kmh * 0.621371;

/** Show / hide elements */
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function showPanel(prefix, which) {
  ['loading', 'error', 'content'].forEach((s) => {
    const el = document.getElementById(`${prefix}-${s}`);
    if (el) el.classList.toggle('hidden', s !== which);
  });
}

function setBadge(id, text, cls) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `status-badge ${cls}`;
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ============================================================
   GEOLOCATION
   ============================================================ */

document.getElementById('btn-detect').addEventListener('click', detectLocation);
document.getElementById('btn-manual').addEventListener('click', () => {
  const lat = parseFloat(document.getElementById('input-lat').value);
  const lng = parseFloat(document.getElementById('input-lng').value);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    alert('Please enter valid coordinates (Lat: -90 to 90, Lng: -180 to 180).');
    return;
  }
  setLocation(lat, lng);
});

function detectLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser. Please enter coordinates manually.');
    return;
  }
  const btn = document.getElementById('btn-detect');
  btn.disabled = true;
  btn.textContent = '⌛ Detecting…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      btn.innerHTML = '<span>📍</span> Auto-Detect Location';
      setLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      btn.disabled = false;
      btn.innerHTML = '<span>📍</span> Auto-Detect Location';
      alert(`Could not get location: ${err.message}\nPlease enter coordinates manually.`);
    },
    { timeout: 10000 }
  );
}

function setLocation(lat, lng) {
  state.lat = lat;
  state.lng = lng;
  document.getElementById('input-lat').value = lat.toFixed(5);
  document.getElementById('input-lng').value = lng.toFixed(5);
  document.getElementById('location-display').textContent =
    `📌 ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  fetchAll();
  startRefreshTimer();
}

/* ============================================================
   AUTO-REFRESH TIMER
   ============================================================ */

function startRefreshTimer() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.countdown = REFRESH_INTERVAL;
  updateCountdown();
  state.refreshTimer = setInterval(() => {
    state.countdown--;
    updateCountdown();
    if (state.countdown <= 0) {
      state.countdown = REFRESH_INTERVAL;
      if (state.lat !== null) fetchAll();
    }
  }, 1000);
}

function updateCountdown() {
  document.getElementById('refresh-countdown').textContent = `${state.countdown}s`;
}

/* ============================================================
   ORCHESTRATOR
   ============================================================ */

async function fetchAll() {
  await Promise.allSettled([
    fetchSatellite(),
    fetchWeather(),
    fetchSeismic(),
  ]);
  calculateRisk();
}

/* ============================================================
   1. SATELLITE TRACKER
   ============================================================ */

async function fetchSatellite() {
  showPanel('sat', 'loading');
  setBadge('sat-status', 'Loading…', '');
  try {
    const res = await fetch(API.ISS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.satellite = data;
    renderSatellite(data);
    showPanel('sat', 'content');
    setBadge('sat-status', 'Live', 'ok');
  } catch (err) {
    showPanel('sat', 'error');
    document.getElementById('sat-error').textContent = `⚠️ Satellite data unavailable: ${err.message}`;
    setBadge('sat-status', 'Error', 'error');
    state.satellite = null;
  }
}

function renderSatellite(data) {
  const satLat = data.latitude;
  const satLng = data.longitude;
  const altKm  = data.altitude;          // km
  const velKmh = data.velocity;          // km/h
  const velMph = kmhToMph(velKmh);

  setVal('sat-name',     data.name || 'ISS (ZARYA)');
  setVal('sat-altitude', `${altKm.toFixed(1)} km`);
  setVal('sat-velocity', `${velMph.toFixed(0)} mph (${velKmh.toFixed(0)} km/h)`);
  setVal('sat-lat',      `${satLat.toFixed(4)}°`);
  setVal('sat-lng',      `${satLng.toFixed(4)}°`);

  const distKm = state.lat !== null
    ? haversineKm(state.lat, state.lng, satLat, satLng)
    : null;
  setVal('sat-distance', distKm !== null ? `${distKm.toFixed(0)} km` : '—');

  initOrUpdateMap(satLat, satLng);
}

function initOrUpdateMap(satLat, satLng) {
  if (!state.map) {
    state.map = L.map('sat-map', {
      center: [satLat, satLng],
      zoom: 3,
      attributionControl: false,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
    }).addTo(state.map);
  }

  /* ISS marker */
  const issIcon = L.divIcon({
    html: '<div style="font-size:1.6rem;line-height:1;filter:drop-shadow(0 0 6px #00e5ff)">🛰️</div>',
    iconSize: [28, 28],
    className: '',
  });
  if (state.satMarker) {
    state.satMarker.setLatLng([satLat, satLng]);
  } else {
    state.satMarker = L.marker([satLat, satLng], { icon: issIcon })
      .addTo(state.map)
      .bindPopup('🛰️ ISS (ZARYA)');
  }

  /* User marker */
  if (state.lat !== null) {
    const userIcon = L.divIcon({
      html: '<div style="font-size:1.4rem;line-height:1">📍</div>',
      iconSize: [24, 24],
      className: '',
    });
    if (state.userMarker) {
      state.userMarker.setLatLng([state.lat, state.lng]);
    } else {
      state.userMarker = L.marker([state.lat, state.lng], { icon: userIcon })
        .addTo(state.map)
        .bindPopup('📍 Your Location');
    }

    /* Fit map to show both markers */
    state.map.fitBounds(
      [[satLat, satLng], [state.lat, state.lng]],
      { padding: [30, 30] }
    );
  } else {
    state.map.setView([satLat, satLng], 3);
  }
}

/* ============================================================
   2. WEATHER PANEL
   ============================================================ */

async function fetchWeather() {
  if (state.lat === null) return;
  showPanel('wx', 'loading');
  setBadge('wx-status', 'Loading…', '');
  try {
    const params = new URLSearchParams({
      latitude:  state.lat,
      longitude: state.lng,
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'wind_speed_10m',
        'wind_gusts_10m',
        'precipitation',
        'cloud_cover',
        'visibility',
        'weather_code',
        'surface_pressure',
      ].join(','),
      hourly: [
        'wind_speed_10m',
        'precipitation',
        'temperature_2m',
        'weather_code',
        'surface_pressure',
      ].join(','),
      wind_speed_unit: 'mph',
      forecast_days: 1,
      timezone: 'auto',
    });
    const res = await fetch(`${API.WEATHER}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.weather = data;
    renderWeather(data);
    showPanel('wx', 'content');
    setBadge('wx-status', 'Live', 'ok');
  } catch (err) {
    showPanel('wx', 'error');
    document.getElementById('wx-error').textContent = `⚠️ Weather data unavailable: ${err.message}`;
    setBadge('wx-status', 'Error', 'error');
    state.weather = null;
  }
}

function renderWeather(data) {
  const c = data.current;
  const tempC  = c.temperature_2m;
  const tempF  = (tempC * 9) / 5 + 32;
  const windMph  = c.wind_speed_10m;       // already mph (requested)
  const gustMph  = c.wind_gusts_10m;
  const precip   = c.precipitation;        // mm
  const cloud    = c.cloud_cover;          // %
  const humidity = c.relative_humidity_2m; // %
  const visM     = c.visibility;           // m
  const visKm    = (visM / 1000).toFixed(1);
  const wCode    = c.weather_code;

  setVal('wx-temp',       `${tempF.toFixed(1)}°F (${tempC.toFixed(1)}°C)`);
  setVal('wx-humidity',   `${humidity}%`);
  setVal('wx-wind',       `${windMph.toFixed(1)} mph`);
  setVal('wx-gusts',      `${gustMph.toFixed(1)} mph`);
  setVal('wx-precip',     `${precip.toFixed(1)} mm/hr`);
  setVal('wx-cloud',      `${cloud}%`);
  setVal('wx-visibility', `${visKm} km`);
  setVal('wx-storm',      WMO_LABELS[wCode] || `Code ${wCode}`);

  renderWeatherChart(data.hourly);
}

function renderWeatherChart(hourly) {
  const labels = hourly.time.slice(0, 24).map((t) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const winds  = hourly.wind_speed_10m.slice(0, 24);
  const precips= hourly.precipitation.slice(0, 24);
  const temps  = hourly.temperature_2m.slice(0, 24).map((t) => (t * 9) / 5 + 32);

  const ctx = document.getElementById('chart-weather').getContext('2d');
  if (state.weatherChart) {
    state.weatherChart.data.labels = labels;
    state.weatherChart.data.datasets[0].data = winds;
    state.weatherChart.data.datasets[1].data = precips;
    state.weatherChart.data.datasets[2].data = temps;
    state.weatherChart.update();
    return;
  }
  state.weatherChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Wind (mph)',
          data: winds,
          borderColor: '#00e5ff',
          backgroundColor: '#00e5ff18',
          tension: 0.4,
          fill: true,
          yAxisID: 'y',
        },
        {
          label: 'Precip (mm)',
          data: precips,
          borderColor: '#2979ff',
          backgroundColor: '#2979ff22',
          tension: 0.4,
          fill: true,
          yAxisID: 'y2',
        },
        {
          label: 'Temp (°F)',
          data: temps,
          borderColor: '#ff9100',
          backgroundColor: 'transparent',
          tension: 0.4,
          fill: false,
          yAxisID: 'y3',
          borderDash: [4, 2],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#7a9fc2', font: { size: 10 } },
        },
      },
      scales: {
        x: { ticks: { color: '#5c85b0', maxTicksLimit: 8 }, grid: { color: '#1a3a6e55' } },
        y:  { position: 'left',  ticks: { color: '#00e5ff', font: { size: 9 } }, grid: { color: '#1a3a6e55' }, title: { display: true, text: 'mph', color: '#00e5ff', font: { size: 9 } } },
        y2: { position: 'right', ticks: { color: '#2979ff', font: { size: 9 } }, grid: { display: false }, title: { display: true, text: 'mm', color: '#2979ff', font: { size: 9 } } },
        y3: { display: false },
      },
    },
  });
}

/* ============================================================
   3. SEISMIC ACTIVITY
   ============================================================ */

async function fetchSeismic() {
  if (state.lat === null) return;
  showPanel('seismic', 'loading');
  setBadge('seismic-status', 'Loading…', '');
  try {
    const endTime   = new Date();
    const startTime = new Date(endTime - SEISMIC_LOOKBACK_DAYS * 24 * 3600 * 1000);

    const params = new URLSearchParams({
      format:       'geojson',
      latitude:     state.lat,
      longitude:    state.lng,
      maxradius:    SEISMIC_RADIUS_DEGREES,
      minmagnitude: 1.0,
      starttime:    startTime.toISOString(),
      endtime:      endTime.toISOString(),
      orderby:      'magnitude',
      limit:        50,
    });

    const res = await fetch(`${API.QUAKE}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.seismic = data;
    renderSeismic(data);
    showPanel('seismic', 'content');
    const count = data.features.length;
    setBadge('seismic-status', count > 0 ? `${count} events` : 'Quiet', count > 0 ? 'warn' : 'ok');
  } catch (err) {
    showPanel('seismic', 'error');
    document.getElementById('seismic-error').textContent = `⚠️ Seismic data unavailable: ${err.message}`;
    setBadge('seismic-status', 'Error', 'error');
    state.seismic = null;
  }
}

function renderSeismic(data) {
  const events = data.features || [];
  const tbody   = document.getElementById('seismic-tbody');
  const noneMsg = document.getElementById('seismic-none');
  const table   = tbody.closest('table');

  tbody.innerHTML = '';

  if (events.length === 0) {
    table.classList.add('hidden');
    noneMsg.classList.remove('hidden');
    document.getElementById('seismic-summary').textContent = 'Search radius: ~555 km | Last 7 days';
    return;
  }

  table.classList.remove('hidden');
  noneMsg.classList.add('hidden');
  document.getElementById('seismic-summary').textContent =
    `${events.length} seismic event(s) found within ~555 km in the last 7 days`;

  events.slice(0, 15).forEach((evt) => {
    const props = evt.properties;
    const mag   = props.mag;
    const depth = evt.geometry.coordinates[2];
    const evtLat= evt.geometry.coordinates[1];
    const evtLng= evt.geometry.coordinates[0];
    const dist  = haversineKm(state.lat, state.lng, evtLat, evtLng).toFixed(0);
    const time  = new Date(props.time).toLocaleString();
    const loc   = props.place || 'Unknown';

    let magClass = 'mag-low';
    if (mag >= 5.0) magClass = 'mag-vhigh';
    else if (mag >= 4.0) magClass = 'mag-high';
    else if (mag >= 3.0) magClass = 'mag-med';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="${magClass}">M${mag.toFixed(1)}</span></td>
      <td>${depth.toFixed(1)}</td>
      <td>${dist}</td>
      <td title="${loc}">${loc.length > 30 ? loc.slice(0, 28) + '…' : loc}</td>
      <td>${time}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ============================================================
   4. POWER OUTAGE RISK PREDICTOR
   ============================================================ */

function calculateRisk() {
  const factors = [];
  let totalWeight = 0;
  let weightedScore = 0;
  let dataPoints = 0;
  let availableDataPoints = 0;

  /* --- Wind Speed --- */
  const factor_wind = RISK_FACTORS.find((f) => f.id === 'wind_speed');
  if (state.weather) {
    availableDataPoints++;
    const windMph = state.weather.current.wind_speed_10m;
    const contrib = Math.min(1, Math.max(0, (windMph - 20) / (factor_wind.threshold - 20)));
    factors.push({ ...factor_wind, currentValue: `${windMph.toFixed(1)} mph`, contrib, active: windMph > factor_wind.threshold });
    weightedScore += factor_wind.weight * contrib;
    totalWeight   += factor_wind.weight;
    dataPoints++;
  } else {
    factors.push({ ...factor_wind, currentValue: 'N/A', contrib: 0, active: false });
  }

  /* --- Wind Gusts --- */
  const factor_gusts = RISK_FACTORS.find((f) => f.id === 'wind_gusts');
  if (state.weather) {
    availableDataPoints++;
    const gustMph = state.weather.current.wind_gusts_10m;
    const contrib = Math.min(1, Math.max(0, (gustMph - 30) / (factor_gusts.threshold - 30)));
    factors.push({ ...factor_gusts, currentValue: `${gustMph.toFixed(1)} mph`, contrib, active: gustMph > factor_gusts.threshold });
    weightedScore += factor_gusts.weight * contrib;
    totalWeight   += factor_gusts.weight;
    dataPoints++;
  } else {
    factors.push({ ...factor_gusts, currentValue: 'N/A', contrib: 0, active: false });
  }

  /* --- Heavy Precipitation --- */
  const factor_precip = RISK_FACTORS.find((f) => f.id === 'heavy_precip');
  if (state.weather) {
    availableDataPoints++;
    const precip = state.weather.current.precipitation;
    const contrib = Math.min(1, precip / 25);
    factors.push({ ...factor_precip, currentValue: `${precip.toFixed(1)} mm/hr`, contrib, active: precip > factor_precip.threshold });
    weightedScore += factor_precip.weight * contrib;
    totalWeight   += factor_precip.weight;
    dataPoints++;
  } else {
    factors.push({ ...factor_precip, currentValue: 'N/A', contrib: 0, active: false });
  }

  /* --- Thunderstorm --- */
  const factor_thunder = RISK_FACTORS.find((f) => f.id === 'thunderstorm');
  if (state.weather) {
    availableDataPoints++;
    const wCode = state.weather.current.weather_code;
    const isThunder = WMO_THUNDERSTORM.includes(wCode);
    /* Also flag severe storm codes in hourly forecast */
    const hourlyThunder = (state.weather.hourly.weather_code || [])
      .slice(0, 6)
      .some((c) => WMO_THUNDERSTORM.includes(c));
    const active = isThunder || hourlyThunder;
    const contrib = active ? 1.0 : (WMO_HEAVY_RAIN.includes(wCode) ? 0.3 : 0);
    factors.push({ ...factor_thunder, currentValue: WMO_LABELS[wCode] || `Code ${wCode}`, contrib, active });
    weightedScore += factor_thunder.weight * contrib;
    totalWeight   += factor_thunder.weight;
    dataPoints++;
  } else {
    factors.push({ ...factor_thunder, currentValue: 'N/A', contrib: 0, active: false });
  }

  /* --- Seismic --- */
  const factor_seismic = RISK_FACTORS.find((f) => f.id === 'seismic');
  if (state.seismic) {
    availableDataPoints++;
    const events = state.seismic.features || [];
    const maxMag = events.length > 0 ? Math.max(...events.map((e) => e.properties.mag)) : 0;
    const sigEvents = events.filter((e) => e.properties.mag >= SEISMIC_SIG_THRESHOLD).length;
    const magBonus = maxMag >= 5 ? SEISMIC_HIGH_MAG_BONUS : maxMag >= 4 ? SEISMIC_MED_MAG_BONUS : 0;
    const contrib = Math.min(1, sigEvents / SEISMIC_EVENT_DIVISOR + magBonus);
    factors.push({
      ...factor_seismic,
      currentValue: sigEvents > 0 ? `${sigEvents} events (max M${maxMag.toFixed(1)})` : 'None (M≥3)',
      contrib,
      active: sigEvents > 0,
    });
    weightedScore += factor_seismic.weight * contrib;
    totalWeight   += factor_seismic.weight;
    dataPoints++;
  } else {
    factors.push({ ...factor_seismic, currentValue: 'N/A', contrib: 0, active: false });
  }

  /* --- Pressure Drop --- */
  const factor_pressure = RISK_FACTORS.find((f) => f.id === 'pressure_drop');
  if (state.weather && state.weather.hourly && state.weather.hourly.surface_pressure) {
    availableDataPoints++;
    const pressures = state.weather.hourly.surface_pressure.slice(0, 6);
    let maxDrop = 0;
    for (let i = 1; i < pressures.length; i++) {
      const drop = pressures[i - 1] - pressures[i];
      if (drop > maxDrop) maxDrop = drop;
    }
    const contrib = Math.min(1, maxDrop / 10);
    factors.push({ ...factor_pressure, currentValue: `${maxDrop.toFixed(1)} hPa/hr`, contrib, active: maxDrop > factor_pressure.threshold });
    weightedScore += factor_pressure.weight * contrib;
    totalWeight   += factor_pressure.weight;
    dataPoints++;
  } else {
    factors.push({ ...factor_pressure, currentValue: 'N/A', contrib: 0, active: false });
  }

  /* --- Compute final score --- */
  const rawScore = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;
  const score    = Math.min(100, Math.round(rawScore));

  /* --- Confidence based on data availability --- */
  const maxFactors = RISK_FACTORS.length;
  const coverage   = dataPoints / maxFactors;
  /* Boost confidence if multiple factors agree */
  const activeCount = factors.filter((f) => f.active).length;
  const overlap     = activeCount >= 3 ? 0.1 : activeCount >= 2 ? 0.05 : 0;
  const conf        = Math.min(99, Math.round((coverage * 0.7 + overlap + 0.1) * 100));

  state.riskScore  = score;
  state.confidence = conf;
  state.riskFactors = factors;

  renderRiskGauge(score, conf);
  renderBreakdown(factors, score, conf);

  showPanel('risk', 'content');
  setBadge('risk-status', riskLabel(score), riskBadgeClass(score));
}

function riskLabel(score) {
  if (score >= 70) return 'HIGH RISK';
  if (score >= 45) return 'ELEVATED';
  if (score >= 20) return 'LOW RISK';
  return 'MINIMAL';
}

function riskBadgeClass(score) {
  if (score >= 70) return 'error';
  if (score >= 45) return 'warn';
  return 'ok';
}

function riskColor(score) {
  if (score >= 70) return '#ff1744';
  if (score >= 45) return '#ff9100';
  if (score >= 20) return '#ffea00';
  return '#00e676';
}

/* ============================================================
   GAUGE CHART (Doughnut half)
   ============================================================ */

function renderRiskGauge(score, conf) {
  const color = riskColor(score);
  setVal('risk-score-val', score);
  setVal('risk-conf-val',  `${conf}%`);

  const remaining = 100 - score;
  const ctx = document.getElementById('chart-gauge').getContext('2d');

  if (state.gaugeChart) {
    state.gaugeChart.data.datasets[0].data = [score, remaining];
    state.gaugeChart.data.datasets[0].backgroundColor = [color, '#1a3a6e'];
    state.gaugeChart.update();
    return;
  }

  state.gaugeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [
        {
          data: [score, remaining],
          backgroundColor: [color, '#1a3a6e'],
          borderColor:     ['transparent', 'transparent'],
          borderWidth:     0,
          circumference:   180,
          rotation:        -90,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend:  { display: false },
        tooltip: { enabled: false },
      },
      animation: { duration: 600 },
    },
  });
}

/* ============================================================
   BREAKDOWN TABLE & SUMMARY
   ============================================================ */

function renderBreakdown(factors, score, conf) {
  const tbody = document.getElementById('breakdown-tbody');
  tbody.innerHTML = '';

  factors.forEach((f) => {
    const pct   = Math.round(f.contrib * f.weight * 100);
    const barW  = Math.round(f.contrib * 100);
    const barColor = f.active ? riskColor(f.contrib * 100) : '#1a3a6e';
    const statusLabel = f.active
      ? '<span class="status-active">⚠️ Active</span>'
      : f.contrib > 0
        ? '<span class="status-elevated">⬆️ Elevated</span>'
        : '<span class="status-normal">✅ Normal</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${f.label}</td>
      <td>${f.severity}</td>
      <td>${f.currentValue}</td>
      <td>
        <span class="contrib-bar" style="width:${Math.max(barW, 4)}px;background:${barColor}"></span>
        ${pct}%
      </td>
      <td>${statusLabel}</td>
    `;
    tbody.appendChild(tr);
  });

  /* Human-readable summary */
  const activeFactors = factors.filter((f) => f.active).map((f) => f.label);
  const elevatedFactors = factors.filter((f) => !f.active && f.contrib > 0.1).map((f) => f.label);

  let summary = '';
  const label = riskLabel(score).toLowerCase();

  if (score === 0 || factors.every((f) => f.currentValue === 'N/A')) {
    summary = '📍 Set your location to begin real-time analysis.';
  } else if (score >= 70) {
    summary = `🔴 <strong>High risk of power outage</strong> detected — ${conf}% confidence. ` +
      (activeFactors.length
        ? `Key drivers: ${activeFactors.slice(0, 3).join(', ')}.`
        : 'Multiple adverse conditions detected.');
  } else if (score >= 45) {
    summary = `🟠 <strong>Elevated outage risk</strong> in your area — ${conf}% confidence. ` +
      (activeFactors.length
        ? `Contributing factors: ${activeFactors.join(', ')}.`
        : elevatedFactors.length
          ? `Watch out for: ${elevatedFactors.join(', ')}.`
          : 'Weather conditions are worsening.');
  } else if (score >= 20) {
    summary = `🟡 <strong>Low outage risk</strong> at this time — ${conf}% confidence. ` +
      'Conditions are mostly favourable but monitor for changes.';
  } else {
    summary = `🟢 <strong>Minimal outage risk</strong> — ${conf}% confidence. ` +
      'All monitored factors are within normal ranges.';
  }

  document.getElementById('risk-summary-text').innerHTML = summary;

  /* Show breakdown panel */
  hide('breakdown-placeholder');
  show('breakdown-content');
}

/* ============================================================
   INIT
   ============================================================ */

(function init() {
  /* Show breakdown placeholder until location is set */
  show('breakdown-placeholder');
  hide('breakdown-content');

  /* Pre-fill ISS position without location requirement */
  fetchSatellite();
})();
