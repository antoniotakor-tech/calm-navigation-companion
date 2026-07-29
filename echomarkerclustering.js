// ---------------------------------------------------------------------------
// echomarkerclustering.js — pure grid-snap clustering for Calm Echo map
// markers ("cluster markers intelligently ... never clutter"). No external
// clustering library is used (this project loads only Leaflet core, by
// design — see PROJECT conventions), so this is a small, honest,
// dependency-free alternative: nearby echoes are grouped into the same grid
// cell and rendered as one marker showing a count, rather than every echo
// getting its own overlapping pin.
//
// Deliberately NOT true k-means/hierarchical clustering — a fixed grid cell
// sized in real-world metres is simpler, fully deterministic, and cheap
// enough to recompute on every nearby-fetch, which is all "never clutter"
// actually requires here.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EchoMarkerClustering = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const METRES_PER_DEGREE_LAT = 111320;

  function metresPerDegreeLon(lat) {
    return METRES_PER_DEGREE_LAT * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  }

  /**
   * Groups echoes into grid cells of roughly `cellSizeM` metres. Each
   * cluster's position is the average of its members' coordinates (so a
   * cluster marker sits visually centered among what it represents, not
   * pinned to an arbitrary grid corner).
   * @param {Array<{id:string, lat:number, lon:number}>} echoes
   * @param {number} [cellSizeM] default 40 — small enough that two Echoes
   *   left at genuinely different benches/spots still usually get their own
   *   markers, large enough to collapse the common case of several Echoes
   *   left in the same small park corner.
   * @returns {Array<{lat:number, lon:number, count:number, echoes:Array}>}
   */
  function clusterEchoes(echoes, cellSizeM) {
    const cellSize = cellSizeM || 40;
    if (!Array.isArray(echoes) || echoes.length === 0) return [];

    const cells = new Map();
    for (const echo of echoes) {
      const lonSize = metresPerDegreeLon(echo.lat);
      const cellRow = Math.floor((echo.lat * METRES_PER_DEGREE_LAT) / cellSize);
      const cellCol = Math.floor((echo.lon * lonSize) / cellSize);
      const key = `${cellRow}:${cellCol}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(echo);
    }

    const clusters = [];
    cells.forEach((members) => {
      const lat = members.reduce((sum, e) => sum + e.lat, 0) / members.length;
      const lon = members.reduce((sum, e) => sum + e.lon, 0) / members.length;
      clusters.push({ lat, lon, count: members.length, echoes: members });
    });
    return clusters;
  }

  const api = { clusterEchoes };
  return api;
});

if (typeof window !== "undefined" && typeof window.EchoMarkerClustering !== "undefined") {
  window.clusterEchoes = window.EchoMarkerClustering.clusterEchoes;
}
