const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("./weathermood.js");

const day = (h, m = 0) => Date.UTC(2026, 9, 12, h, m); // UTC
const fc = (code, wind, isDay, extra) => ({
  utc_offset_seconds: 7200,
  current: { weather_code: code, wind_speed_10m: wind, is_day: isDay, cloud_cover: 80, ...extra },
  daily: { sunrise: ["2026-10-12T08:00"], sunset: ["2026-10-12T18:45"] }, // local (UTC+2)
});

test("weather codes map to sky and precipitation", () => {
  assert.equal(W.precipFor(61), "rain");
  assert.equal(W.precipFor(53), "drizzle");
  assert.equal(W.precipFor(73), "snow");
  assert.equal(W.precipFor(95), "storm");
  assert.equal(W.precipFor(0), "none");
  assert.equal(W.skyFor(0), "clear");
  assert.equal(W.skyFor(45), "fog");
  assert.equal(W.skyFor(3), "cloudy");
});

test("wind strength", () => {
  assert.equal(W.windFor(5), "calm");
  assert.equal(W.windFor(20), "breezy");
  assert.equal(W.windFor(42), "windy");
});

test("time of day follows the local sunrise and sunset", () => {
  // sunrise 06:00 UTC, sunset 16:45 UTC
  assert.equal(W.fromForecast(fc(0, 3, 1), day(12)).time, "day");
  assert.equal(W.fromForecast(fc(0, 3, 1), day(16)).time, "dusk");
  assert.equal(W.fromForecast(fc(0, 3, 0), day(21)).time, "night");
  assert.equal(W.fromForecast(fc(0, 3, 1), day(6, 30)).time, "dawn");
  assert.equal(W.fromForecast(fc(0, 3, 0), day(21)).night, true);
});

test("a rainy, windy afternoon", () => {
  const m = W.fromForecast(fc(63, 35, 1), day(13));
  assert.deepEqual([m.sky, m.precip, m.wind, m.time], ["cloudy", "rain", "windy", "day"]);
});
