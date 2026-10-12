// ---------------------------------------------------------------------------
// exifgps.js (2026-10-12) — reads where a JPEG photo was taken from its EXIF
// GPS tags, so a community post can be pinned at the photo's exact spot
// without typing an address. Read-only and on the device: the photo is
// re-encoded before upload (community.js), which strips EXIF, so the
// location is only ever sent as the post's own lat/lon.
//
// Supports JPEG (what iOS/Android hand a web page for image/* inputs), both
// byte orders, rational degrees/minutes/seconds and N/S/E/W refs. Returns
// null for anything else (PNG, no GPS, "Location" switched off when sharing).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ExifGps = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** @param {ArrayBuffer} buffer @returns {{lat:number, lon:number}|null} */
  function readGps(buffer) {
    const v = new DataView(buffer);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) return null;
      const marker = v.getUint8(p + 1);
      const size = v.getUint16(p + 2);
      if (marker === 0xe1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10); // "Exif"
      if (marker === 0xda) return null; // image data started: no EXIF
      p += 2 + size;
    }
    return null;
  }

  function parseTiff(v, t) {
    const little = v.getUint16(t) === 0x4949;
    const u16 = (o) => v.getUint16(t + o, little);
    const u32 = (o) => v.getUint32(t + o, little);
    if (u16(2) !== 42) return null;
    const ifd0 = u32(4);
    let gpsOffset = null;
    for (let i = 0, n = u16(ifd0); i < n; i++) {
      const e = ifd0 + 2 + i * 12;
      if (u16(e) === 0x8825) gpsOffset = u32(e + 8);
    }
    if (gpsOffset == null) return null;
    const tags = {};
    for (let i = 0, n = u16(gpsOffset); i < n; i++) {
      const e = gpsOffset + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (type === 2) tags[tag] = String.fromCharCode(v.getUint8(t + e + 8)); // ASCII ref, fits inline
      else if (type === 5 && count === 3) {
        const off = u32(e + 8);
        const r = (k) => { const d = u32(off + k * 8 + 4); return d ? u32(off + k * 8) / d : 0; };
        tags[tag] = r(0) + r(1) / 60 + r(2) / 3600;
      }
    }
    if (typeof tags[2] !== "number" || typeof tags[4] !== "number") return null;
    const lat = tags[2] * (tags[1] === "S" ? -1 : 1);
    const lon = tags[4] * (tags[3] === "W" ? -1 : 1);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || (lat === 0 && lon === 0)) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  }

  return { readGps };
});
