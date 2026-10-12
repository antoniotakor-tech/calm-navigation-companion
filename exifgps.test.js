const test = require("node:test");
const assert = require("node:assert/strict");
const { readGps } = require("./exifgps.js");

// Builds a minimal JPEG with an EXIF GPS block, like an iPhone camera photo.
function jpegWithGps(lat, lon, little = false) {
  const b = [];
  const u16 = (n) => (little ? b.push(n & 255, n >> 8) : b.push(n >> 8, n & 255));
  const u32 = (n) => (little ? b.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24) : b.push(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255));
  const dms = (x) => { x = Math.abs(x); const d = Math.floor(x), m = Math.floor((x - d) * 60), s = Math.round(((x - d) * 60 - m) * 60 * 1000); return [[d, 1], [m, 1], [s, 1000]]; };
  // TIFF header
  b.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d])); u16(42); u32(8);
  // IFD0: 1 entry (GPS pointer) at 8
  u16(1); u16(0x8825); u16(4); u32(1); u32(26); u32(0);
  // GPS IFD at 26: 4 entries
  const dataStart = 26 + 2 + 4 * 12 + 4;
  u16(4);
  const ref = (tag, ch) => { u16(tag); u16(2); u32(2); b.push(ch.charCodeAt(0), 0, 0, 0); };
  const rat = (tag, off) => { u16(tag); u16(5); u32(3); u32(off); };
  ref(1, lat < 0 ? "S" : "N"); rat(2, dataStart); ref(3, lon < 0 ? "W" : "E"); rat(4, dataStart + 24);
  u32(0);
  for (const [n, d] of [...dms(lat), ...dms(lon)]) { u32(n); u32(d); }
  const tiff = Uint8Array.from(b);
  const app1Len = 2 + 6 + tiff.length;
  const head = [0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0];
  return Uint8Array.from([...head, ...tiff, 0xff, 0xda, 0, 2]).buffer;
}

test("reads where an iPhone-style photo was taken (Amsterdam)", () => {
  const g = readGps(jpegWithGps(52.3731, 4.8922));
  assert.ok(Math.abs(g.lat - 52.3731) < 1e-4 && Math.abs(g.lon - 4.8922) < 1e-4);
});

test("handles little-endian files and south/west coordinates", () => {
  const g = readGps(jpegWithGps(-33.8568, -70.6483, true));
  assert.ok(Math.abs(g.lat + 33.8568) < 1e-4 && Math.abs(g.lon + 70.6483) < 1e-4);
});

test("photos without location, or non-JPEGs, return null", () => {
  assert.equal(readGps(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), null);
  assert.equal(readGps(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer), null);
});
