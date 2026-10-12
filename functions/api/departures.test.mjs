import test from "node:test";
import assert from "node:assert/strict";
import { pickStops, normalizeDeparture } from "./departures.js";
import { delayMinutes } from "./transit.js";

test("delays are live minus timetable, in minutes", () => {
  assert.equal(delayMinutes("2026-10-12T22:07:00Z", "2026-10-12T22:05:00Z"), 2);
  assert.equal(delayMinutes("2026-10-12T22:05:00Z", "2026-10-12T22:05:00Z"), 0);
  assert.equal(delayMinutes(null, "2026-10-12T22:05:00Z"), null);
});

test("platforms of one station are grouped and the nearest stations come first", () => {
  const here = { lat: 48.858, lon: 2.347 };
  const stops = [
    { name: "Châtelet", stopId: "a", lat: 48.8585, lon: 2.3475, modes: ["SUBWAY"] },
    { name: "Châtelet", stopId: "b", lat: 48.8587, lon: 2.3478, modes: ["RAIL"] },
    { name: "Far away", stopId: "c", lat: 48.866, lon: 2.36, modes: ["BUS"] },
  ];
  const out = pickStops(stops, here);
  assert.equal(out[0].name, "Châtelet");
  assert.deepEqual(out[0].ids, ["a", "b"]);
  assert.deepEqual(out[0].modes.sort(), ["RAIL", "SUBWAY"]);
  assert.equal(out[1].name, "Far away");
});

test("a departure keeps live info and drops bad colours", () => {
  const d = normalizeDeparture({ mode: "SUBWAY", routeShortName: "14", headsign: "Orly", realTime: true, routeColor: "662483", place: { departure: "2026-10-12T22:05:00Z", scheduledDeparture: "2026-10-12T22:00:00Z", track: "2" } });
  assert.equal(d.delayMin, 5);
  assert.equal(d.realTime, true);
  assert.equal(d.color, "662483");
  assert.equal(normalizeDeparture({ routeColor: "javascript:", place: {} }).color, null);
});
