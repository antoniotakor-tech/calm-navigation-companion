// ---------------------------------------------------------------------------
// weathermood.js (2026-10-12) — turns an Open-Meteo forecast into the "mood"
// the map doodles act out: time of day, sky, precipitation and wind.
// Pure (no DOM/network) so it runs under `node --test`.
// WMO weather codes: https://open-meteo.com/en/docs (weather_code table).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WeatherMood = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function skyFor(code, cloud) {
    if (code === 45 || code === 48) return "fog";
    if (code === 0) return "clear";
    if (code === 1 || code === 2) return "partly";
    if (code === 3) return "cloudy";
    // precipitation codes: judge the sky by cloud cover, rain is always cloudy-ish
    return cloud != null && cloud < 50 ? "partly" : "cloudy";
  }
  function precipFor(code) {
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code >= 51 && code <= 57) return "drizzle";
    return "none";
  }
  function windFor(kmh) {
    if (!(kmh >= 0)) return "calm";
    if (kmh >= 30) return "windy";
    if (kmh >= 15) return "breezy";
    return "calm";
  }
  /** now, sunrise, sunset: ms timestamps; isDay: 0/1 from the API (wins when present). */
  function timeFor(now, sunrise, sunset, isDay) {
    if (sunrise && sunset) {
      if (now < sunrise - 30 * 60000 || now > sunset + 30 * 60000) return "night";
      if (now < sunrise + 60 * 60000) return "dawn";
      if (now > sunset - 75 * 60000) return "dusk";
      return "day";
    }
    if (isDay === 0) return "night";
    const h = new Date(now).getHours();
    return h < 7 || h >= 20 ? "night" : h < 8 ? "dawn" : h >= 19 ? "dusk" : "day";
  }

  /**
   * data: Open-Meteo JSON with current {weather_code, wind_speed_10m, is_day,
   * cloud_cover} and daily {sunrise[], sunset[]} (ISO local times + utc_offset_seconds).
   */
  function fromForecast(data, now) {
    now = now || Date.now();
    const c = (data && data.current) || {};
    const off = (data && data.utc_offset_seconds) || 0;
    const parse = (iso) => (iso ? Date.parse(iso + "Z") - off * 1000 : null); // local ISO -> UTC ms
    const sunrise = data && data.daily && parse(data.daily.sunrise && data.daily.sunrise[0]);
    const sunset = data && data.daily && parse(data.daily.sunset && data.daily.sunset[0]);
    const code = Number(c.weather_code);
    return {
      time: timeFor(now, sunrise, sunset, c.is_day),
      sky: skyFor(code, c.cloud_cover),
      precip: precipFor(code),
      wind: windFor(Number(c.wind_speed_10m)),
      night: timeFor(now, sunrise, sunset, c.is_day) === "night",
    };
  }

  return { fromForecast, skyFor, precipFor, windFor, timeFor };
});
