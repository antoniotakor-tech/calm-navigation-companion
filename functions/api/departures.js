// Cloudflare Pages Function — live departure boards near a point, anywhere
// Transitous covers (most of Europe), 2026-10-12.
//
// GET /api/departures?lat=..&lon=..   -> nearest stops with their next departures
// { stops: [{ name, stopId, distanceM, modes, departures: [{ mode, route, headsign,
//   time, scheduled, delayMin, realTime, cancelled, track, color, textColor, agency }] }] }
import { delayMinutes } from "./transit.js";

const BASE = "https://api.transitous.org/api";
const UA = { "user-agent": "CalmNavigationCompanion/1.0 (https://calm-navigation-companion.pages.dev)" };
const CORS = { "access-control-allow-origin": "*" };
const json = (d, status = 200, cache = "public, max-age=20") => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": cache, ...CORS } });

async function get(url, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { headers: UA, signal: c.signal }); return r.ok ? r.json() : null; }
  catch (e) { return null; } finally { clearTimeout(t); }
}
function distM(a, b) {
  const R = 6371000, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Groups platforms of the same station (same name) and picks the nearest few. Exported for tests. */
export function pickStops(stops, here, max = 4) {
  const byName = new Map();
  for (const s of stops || []) {
    if (!s || !s.name || !s.stopId) continue;
    const d = distM(here, s);
    const prev = byName.get(s.name);
    if (!prev) byName.set(s.name, { name: s.name, ids: [s.stopId], distanceM: Math.round(d), modes: new Set(s.modes || []) });
    else { prev.ids.push(s.stopId); prev.distanceM = Math.min(prev.distanceM, Math.round(d)); (s.modes || []).forEach((m) => prev.modes.add(m)); }
  }
  return [...byName.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, max).map((s) => ({ ...s, modes: [...s.modes] }));
}
export function normalizeDeparture(st) {
  const p = (st && st.place) || {};
  return {
    mode: st.mode || null,
    route: typeof st.routeShortName === "string" ? st.routeShortName.slice(0, 12) : null,
    headsign: typeof st.headsign === "string" ? st.headsign.slice(0, 60) : null,
    time: p.departure || null,
    scheduled: p.scheduledDeparture || null,
    delayMin: delayMinutes(p.departure, p.scheduledDeparture),
    realTime: st.realTime === true,
    cancelled: st.cancelled === true || p.cancelled === true,
    track: typeof p.track === "string" ? p.track.slice(0, 8) : null,
    color: /^[0-9a-fA-F]{6}$/.test(st.routeColor || "") ? st.routeColor : null,
    textColor: /^[0-9a-fA-F]{6}$/.test(st.routeTextColor || "") ? st.routeTextColor : null,
    agency: typeof st.agencyName === "string" ? st.agencyName.slice(0, 40) : null,
  };
}

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return json({ error: "lat and lon are required." }, 400, "no-store");
  const d = 0.0045; // ~500 m box
  const stops = await get(`${BASE}/v1/map/stops?min=${(lat - d).toFixed(5)},${(lon - d * 1.5).toFixed(5)}&max=${(lat + d).toFixed(5)},${(lon + d * 1.5).toFixed(5)}`);
  if (!stops) return json({ error: "Live departures are unavailable right now." }, 502, "no-store");
  const picked = pickStops(stops, { lat, lon }, 4);
  const boards = await Promise.all(picked.map(async (s) => {
    const lists = await Promise.all(s.ids.slice(0, 4).map((id) => get(`${BASE}/v5/stoptimes?stopId=${encodeURIComponent(id)}&n=6`)));
    const deps = lists.flatMap((l) => (l && l.stopTimes) || []).map(normalizeDeparture)
      .filter((x) => x.time).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const seen = new Set();
    const unique = deps.filter((x) => { const k = x.route + "|" + x.headsign + "|" + x.time; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    return { name: s.name, stopId: s.ids[0], distanceM: s.distanceM, modes: s.modes, departures: unique };
  }));
  return json({ stops: boards.filter((b) => b.departures.length) });
}
