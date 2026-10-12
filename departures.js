// ---------------------------------------------------------------------------
// Live departure boards (2026-10-12): the stops around you and their next
// trains / metros / trams / buses / ferries, with live delays where the
// operator shares them (via /api/departures → Transitous). Refreshes every
// 30 s while open. Times are shown as "in 4 min" — calmer than a clock.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const overlay = $("depOverlay");
  if (!overlay) return;
  const MODE_ICON = { SUBWAY: "metro", METRO: "metro", TRAM: "tram", BUS: "bus", COACH: "bus", FERRY: "ferry", RAIL: "train", REGIONAL_RAIL: "train", REGIONAL_FAST_RAIL: "train", HIGHSPEED_RAIL: "train", LONG_DISTANCE: "train", NIGHT_RAIL: "train", SUBURBAN: "train" };
  let timer = null, here = null;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function inMin(iso) {
    const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
    if (m <= 0) return "now";
    if (m < 60) return `${m} min`;
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function render(data) {
    const box = $("depBoards");
    box.innerHTML = "";
    if (!data.stops || !data.stops.length) {
      $("depStatus").textContent = "No departures found within about 500 m right now.";
      return;
    }
    $("depStatus").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes by itself`;
    data.stops.forEach((s) => {
      const card = el("section", "dep-stop");
      const head = el("div", "dep-stop-head");
      head.append(el("h3", "dep-stop-name", s.name), el("span", "cm-meta", `${s.distanceM} m`));
      card.appendChild(head);
      const list = el("ul", "dep-list");
      s.departures.forEach((d) => {
        const li = el("li", "dep-row" + (d.cancelled ? " is-cancelled" : ""));
        const line = el("span", "dep-line");
        line.innerHTML = CalmIcons.html(MODE_ICON[d.mode] || "bus");
        if (d.route) {
          const chip = el("b", "line-chip", d.route);
          if (d.color) { chip.style.background = "#" + d.color; chip.style.color = d.textColor ? "#" + d.textColor : "#fff"; }
          line.appendChild(chip);
        }
        const to = el("span", "dep-to", d.headsign || "");
        const when = el("span", "dep-when");
        when.appendChild(el("b", null, d.cancelled ? "cancelled" : inMin(d.time)));
        if (!d.cancelled && d.realTime) {
          const dl = d.delayMin || 0;
          when.appendChild(el("small", dl > 0 ? "late" : "ok", dl > 0 ? `+${dl} min` : "live"));
        }
        if (d.track) when.appendChild(el("small", "track", `pl. ${d.track}`));
        li.append(line, to, when);
        list.appendChild(li);
      });
      card.appendChild(list);
      box.appendChild(card);
    });
  }

  async function load() {
    if (!here) return;
    try {
      const base = (window.CalmApp && CalmApp.apiBaseUrl) || "";
      const res = await fetch(`${base}/api/departures?lat=${here.lat.toFixed(5)}&lon=${here.lon.toFixed(5)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      render(data);
    } catch (e) {
      $("depStatus").textContent = navigator.onLine === false ? "You're offline." : "Live departures are unavailable right now — try again in a moment.";
    }
  }

  function open() {
    const app = window.CalmApp;
    here = (app && app.userPoint && app.userPoint()) || null;
    if (!here && app && app.map) { const c = app.map.getCenter(); here = { lat: c.lat, lon: c.lng }; }
    $("depBoards").innerHTML = "";
    $("depStatus").textContent = "Finding stops near you…";
    overlay.classList.add("open");
    load();
    clearInterval(timer);
    timer = setInterval(load, 30000);
  }
  function close() { overlay.classList.remove("open"); clearInterval(timer); }

  $("depOpenBtn").addEventListener("click", open);
  $("depClose").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("open")) close(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearInterval(timer); else if (overlay.classList.contains("open")) { load(); timer = setInterval(load, 30000); } });
})();
