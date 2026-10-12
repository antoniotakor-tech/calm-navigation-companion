// ---------------------------------------------------------------------------
// Weather doodles (2026-10-12): the map critters act out the real weather and
// time of day where you are — shining sun, rain from the clouds, snow, storm
// flashes, wind swirls, a sunset, a moon and stars at night, fog.
// Data: Open-Meteo (free, no key). Only a rounded (~1 km) position is sent.
// Also tells the Auto theme whether it's night (window.CalmTheme.applyAuto).
// Preview any mood with ?weather=rain,windy,night (or snow, storm, fog, clear, dusk…).
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const layer = document.querySelector(".map-doodles");
  if (!layer || !window.WeatherMood) return;
  const REFRESH_MS = 20 * 60 * 1000;

  // ---- extra doodles (built once) -----------------------------------------------
  const svg = (cls, viewBox, body) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("class", "dd " + cls);
    el.setAttribute("viewBox", viewBox);
    el.innerHTML = body;
    layer.appendChild(el);
    return el;
  };
  svg("dd-moon", "0 0 100 100", '<g filter="url(#crayon)"><path d="M62 12a40 40 0 1 0 26 58A34 34 0 0 1 62 12z" fill="#FFF3B0" stroke="#2D2A3E" stroke-width="3.5" stroke-linejoin="round"/><path d="M40 52q6 6 12 0" fill="none" stroke="#2D2A3E" stroke-width="3" stroke-linecap="round"/><path d="M36 42v1M50 40v1" stroke="#2D2A3E" stroke-width="4.5" stroke-linecap="round"/><circle cx="33" cy="52" r="3" fill="#FF8FB8"/></g>');
  for (let i = 0; i < 9; i++) {
    const s = svg("dd-nightstar", "0 0 30 30", '<path filter="url(#crayon)" d="M15 3l3 8 9 1-7 6 2 9-7-5-7 5 2-9-7-6 9-1z" fill="#FFF3B0" stroke="#2D2A3E" stroke-width="2"/>');
    s.style.left = (6 + ((i * 37) % 86)) + "%";
    s.style.top = (14 + ((i * 23) % 48)) + "%";
    s.style.animationDelay = (-i * 0.7) + "s";
  }
  const rain = document.createElement("div");
  rain.className = "dd-rain";
  for (let i = 0; i < 46; i++) {
    const d = document.createElement("i");
    d.style.left = ((i * 53) % 100) + "%";
    d.style.animationDelay = (-(i * 0.137) % 1.1).toFixed(2) + "s";
    d.style.animationDuration = (0.75 + ((i * 7) % 5) * 0.08).toFixed(2) + "s";
    rain.appendChild(d);
  }
  layer.appendChild(rain);
  const snow = document.createElement("div");
  snow.className = "dd-snow";
  for (let i = 0; i < 34; i++) {
    const f = document.createElement("i");
    f.textContent = "✻";
    f.style.left = ((i * 41) % 100) + "%";
    f.style.animationDelay = (-(i * 0.53) % 9).toFixed(2) + "s";
    f.style.fontSize = (10 + (i % 4) * 4) + "px";
    snow.appendChild(f);
  }
  layer.appendChild(snow);
  const flash = document.createElement("div");
  flash.className = "dd-flash";
  layer.appendChild(flash);
  svg("dd-bolt", "0 0 40 70", '<path filter="url(#crayon)" d="M24 2L6 38h14L12 68l24-40H22L30 2z" fill="#FFD84D" stroke="#2D2A3E" stroke-width="3" stroke-linejoin="round"/>');
  for (let i = 0; i < 3; i++) {
    const w = svg("dd-swirl dd-swirl" + i, "0 0 160 60", '<path filter="url(#crayon)" d="M4 40q30-26 60-8t44-6q16-14 10-26-10-8-18 4" fill="none" stroke="#9FB7D9" stroke-width="5" stroke-linecap="round"/>');
    w.style.top = (30 + i * 16) + "%";
  }
  const fog = document.createElement("div");
  fog.className = "dd-fog";
  layer.appendChild(fog);

  // ---- apply a mood ------------------------------------------------------------------
  function apply(m) {
    layer.dataset.time = m.time;
    layer.dataset.sky = m.sky;
    layer.dataset.precip = m.precip;
    layer.dataset.wind = m.wind;
    document.documentElement.dataset.daytime = m.time;
    if (window.CalmTheme) window.CalmTheme.applyAuto(m.night);
  }

  function fromQuery() {
    const q = new URLSearchParams(location.search).get("weather");
    if (!q) return null;
    const parts = q.split(",");
    const has = (w) => parts.includes(w);
    const time = ["night", "dusk", "dawn"].find(has) || "day";
    return {
      time, night: time === "night",
      sky: ["fog", "cloudy", "partly"].find(has) || (["rain", "drizzle", "snow", "storm"].some(has) ? "cloudy" : "clear"),
      precip: ["rain", "drizzle", "snow", "storm"].find(has) || "none",
      wind: ["windy", "breezy"].find(has) || "calm",
    };
  }

  function where() {
    const app = window.CalmApp;
    const f = app && app.lastFix && app.lastFix();
    if (f) return { lat: f[0], lon: f[1] };
    if (app && app.map) { const c = app.map.getCenter(); return { lat: c.lat, lon: c.lng }; }
    return null;
  }

  async function refresh() {
    const forced = fromQuery();
    if (forced) { apply(forced); return; }
    const p = where();
    if (!p) return;
    // ~1 km rounding: enough for weather, not enough to identify where someone is.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}&current=weather_code,wind_speed_10m,is_day,cloud_cover&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
    try {
      const data = await (await fetch(url)).json();
      apply(WeatherMood.fromForecast(data));
      try { localStorage.setItem("calmWeather.last.v1", JSON.stringify({ at: Date.now(), data })); } catch (e) { /* storage off */ }
    } catch (e) {
      // offline: use the last forecast if it's recent, else just the clock
      try {
        const last = JSON.parse(localStorage.getItem("calmWeather.last.v1") || "null");
        if (last && Date.now() - last.at < 6 * 3600 * 1000) { apply(WeatherMood.fromForecast(last.data)); return; }
      } catch (err) { /* ignore */ }
      const h = new Date().getHours();
      apply({ time: h < 7 || h >= 20 ? "night" : "day", night: h < 7 || h >= 20, sky: "partly", precip: "none", wind: "calm" });
    }
  }

  // Start once the map exists (so we know roughly where you are).
  const start = () => { refresh(); setInterval(refresh, REFRESH_MS); };
  if (window.CalmApp) setTimeout(start, 1500); else window.addEventListener("calmapp:ready", () => setTimeout(start, 1500), { once: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
})();
