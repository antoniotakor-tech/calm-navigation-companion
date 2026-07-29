// ---------------------------------------------------------------------------
// Pure navigation state/geometry logic — no DOM, no Leaflet, no fetch.
// Loaded as a global (window.NavLogic) in the browser via <script>, and as a
// CommonJS module in Node for unit tests (navlogic.test.js). Kept dependency-
// free on purpose so the same file runs in both places unmodified.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.NavLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NavState = {
    IDLE: "idle",
    REQUESTING_LOCATION: "requesting_location",
    CALCULATING_ROUTE: "calculating_route",
    ROUTE_READY: "route_ready",
    NAVIGATING: "navigating",
    OFF_ROUTE: "off_route",
    RECALCULATING: "recalculating",
    ARRIVED: "arrived",
    ERROR: "error",
  };

  // Every threshold here is a named guess tuned for on-foot/bike GPS in a
  // dense city, not a measured constant — documented so it can be revisited.
  const THRESHOLDS = {
    // Consumer GPS on foot commonly reports 5-15m of error. 18m keeps us from
    // "arriving" at a maneuver a beat before the person actually reaches it.
    ARRIVE_STEP_M: 18,
    // Slightly looser than a step arrival: destination points come from
    // geocoding, not a hand-placed pin, so they can sit a few meters off the
    // real building entrance.
    ARRIVE_DEST_M: 20,
    // Meters from the route's own point cloud before a fix counts as
    // "off route". Set well above typical urban GPS error (~10-20m) so a
    // single noisy reading doesn't read as a real deviation.
    OFF_ROUTE_M: 35,
    // Require this many CONSECUTIVE off-route fixes before triggering a
    // reroute. This is the actual "don't reroute from one bad reading" rule —
    // at a ~2s fix interval this is a few seconds of sustained drift.
    OFF_ROUTE_STREAK_NEEDED: 3,
    // Below this speed, a bearing derived from two consecutive GPS fixes is
    // noise (standing still with GPS jitter looks like "movement" otherwise),
    // so movement-derived heading is only trusted above this pace.
    HEADING_MIN_SPEED_MPS: 0.6,
    // Distance bands for voice guidance ("in 200m, turn left" vs "turn left").
    VOICE_FAR_M: 220,
    VOICE_NEAR_M: 30,
  };

  const TRAVEL_MODES = {
    walk: { ghProfile: "foot", label: "Walk", speedMps: 1.3 },
    bike: { ghProfile: "bike", label: "Bike", speedMps: 4.2 },
  };

  function toRad(d) { return (d * Math.PI) / 180; }
  function toDeg(r) { return (r * 180) / Math.PI; }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Initial bearing from point 1 to point 2, degrees, 0-360, 0 = north.
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // ---- Camera / user-marker intelligence (pure math; app.js does the
  // actual DOM/Leaflet tweening on top of these) ----------------------------

  // Linear interpolation between two fixes, t in 0..1 (clamped). Consecutive
  // GPS fixes on foot/bike are only ever a few metres to a few tens of
  // metres apart, where straight-line and great-circle interpolation are
  // indistinguishable — this is what lets the on-screen marker glide
  // smoothly between fixes instead of teleporting from one to the next.
  function lerpLatLon(lat1, lon1, lat2, lon2, t) {
    const clamped = Math.max(0, Math.min(1, t));
    return { lat: lat1 + (lat2 - lat1) * clamped, lon: lon1 + (lon2 - lon1) * clamped };
  }

  // Exponential smoothing over a circular quantity (compass heading),
  // handling the 0/360 wraparound correctly by smoothing the shortest
  // signed delta rather than the raw values — smoothing 355° toward 5°
  // naively would otherwise swing the marker the long way around through
  // 180°. `factor` (0..1) is how much of the NEW reading to blend in; a
  // smaller factor means calmer, more heavily-filtered rotation (less
  // jitter from noisy compass/movement-derived bearings) at the cost of
  // slower response to a genuine turn.
  function smoothHeading(prevHeadingDeg, newHeadingDeg, factor) {
    if (newHeadingDeg == null) return prevHeadingDeg == null ? null : prevHeadingDeg;
    if (prevHeadingDeg == null) return newHeadingDeg;
    const f = Math.max(0, Math.min(1, factor == null ? 0.35 : factor));
    let delta = newHeadingDeg - prevHeadingDeg;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return (prevHeadingDeg + delta * f + 360) % 360;
  }

  // Standard "destination point given start, bearing, distance" spherical
  // formula — used for the camera's walking/cycling look-ahead (biasing the
  // map center a little ahead of the user's real position, in the direction
  // of travel, so more of what's coming up is visible instead of the user
  // dot sitting dead-center).
  function destinationPoint(lat, lon, headingDeg, distanceM) {
    const R = 6371000;
    const delta = distanceM / R;
    const theta = toRad(headingDeg);
    const phi1 = toRad(lat);
    const lambda1 = toRad(lon);
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
    const lambda2 = lambda1 + Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );
    return { lat: toDeg(phi2), lon: ((toDeg(lambda2) + 540) % 360) - 180 };
  }

  // Nearest distance from (lat,lon) to any vertex of the route's coordinate
  // array. An approximation of true point-to-segment distance, but at the
  // point density GraphHopper returns for a walking/biking route this is
  // accurate to within a couple of meters — well inside OFF_ROUTE_M's margin.
  function nearestRouteDistanceM(lat, lon, coordinates) {
    let min = Infinity;
    for (let i = 0; i < coordinates.length; i++) {
      const d = haversineM(lat, lon, coordinates[i][1], coordinates[i][0]);
      if (d < min) min = d;
    }
    return min;
  }

  // Same walk, but also returns which point index was closest — this is
  // what lets the audio layer answer "what kind of street is the user on
  // right now" via roadClassAt() below, instead of only a route-wide summary.
  function nearestRouteIndex(lat, lon, coordinates) {
    let min = Infinity, idx = 0;
    for (let i = 0; i < coordinates.length; i++) {
      const d = haversineM(lat, lon, coordinates[i][1], coordinates[i][0]);
      if (d < min) { min = d; idx = i; }
    }
    return { index: idx, distanceM: min };
  }

  // route.roadClassSegments is [[fromIdx, toIdx, value], ...] in the same
  // index space as route.coordinates (see routing.js). Returns the road
  // class string covering `index`, or "unknown" if the route has none.
  function roadClassAt(route, index) {
    const segs = route && route.roadClassSegments;
    if (!segs || !segs.length) return "unknown";
    for (let i = 0; i < segs.length; i++) {
      if (index >= segs[i][0] && index <= segs[i][1]) return String(segs[i][2] || "other").toLowerCase();
    }
    return "unknown";
  }

  // Where a step "ends", as a lat/lon — GraphHopper's instruction.interval
  // indexes into the same points array as the route geometry.
  function stepTargetLatLon(route, step) {
    const idx = step && step.interval ? step.interval[1] : null;
    const coords = route.coordinates;
    if (idx == null || !coords[idx]) {
      const last = coords[coords.length - 1];
      return { lat: last[1], lon: last[0] };
    }
    return { lat: coords[idx][1], lon: coords[idx][0] };
  }

  function createNavState(route) {
    return {
      route,
      stepIdx: 0,
      offRouteStreak: 0,
      state: NavState.NAVIGATING,
      lastFix: null,
      heading: null,
    };
  }

  // Swap in a freshly-fetched route after a reroute, without losing the
  // navState identity the rest of the app is holding a reference to.
  function resetForNewRoute(navState, route) {
    navState.route = route;
    navState.stepIdx = 0;
    navState.offRouteStreak = 0;
    navState.state = NavState.NAVIGATING;
    return navState;
  }

  // The core per-fix update. Mutates and returns navState (simpler call sites
  // than threading immutable copies through a UI layer), but touches nothing
  // outside the object it's given — no DOM, no globals, no I/O. That's what
  // makes it unit-testable without a browser.
  function processFix(navState, fix) {
    const { lat, lon, speedMps, headingDeg } = fix;
    const route = navState.route;

    let derivedHeading = headingDeg != null ? headingDeg : null;
    if (derivedHeading == null && navState.lastFix && speedMps != null && speedMps >= THRESHOLDS.HEADING_MIN_SPEED_MPS) {
      derivedHeading = bearingDeg(navState.lastFix.lat, navState.lastFix.lon, lat, lon);
    }
    navState.lastFix = { lat, lon };
    if (derivedHeading != null) navState.heading = derivedHeading;

    const nearest = nearestRouteIndex(lat, lon, route.coordinates);
    const distToRoute = nearest.distanceM;
    const currentRoadClass = roadClassAt(route, nearest.index);
    if (distToRoute > THRESHOLDS.OFF_ROUTE_M) {
      navState.offRouteStreak++;
    } else {
      navState.offRouteStreak = 0;
      if (navState.state === NavState.OFF_ROUTE) navState.state = NavState.NAVIGATING;
    }

    const shouldReroute = navState.offRouteStreak >= THRESHOLDS.OFF_ROUTE_STREAK_NEEDED;
    if (shouldReroute) navState.state = NavState.OFF_ROUTE;

    const last = route.coordinates[route.coordinates.length - 1];
    const distToDestination = haversineM(lat, lon, last[1], last[0]);
    const arrived = distToDestination < THRESHOLDS.ARRIVE_DEST_M;
    if (arrived) navState.state = NavState.ARRIVED;

    const steps = route.steps || [];
    let passedStep = false;
    let target = stepTargetLatLon(route, steps[navState.stepIdx]);
    let distToNextManeuver = haversineM(lat, lon, target.lat, target.lon);
    while (!arrived && distToNextManeuver < THRESHOLDS.ARRIVE_STEP_M && navState.stepIdx < steps.length - 1) {
      navState.stepIdx++;
      passedStep = true;
      target = stepTargetLatLon(route, steps[navState.stepIdx]);
      distToNextManeuver = haversineM(lat, lon, target.lat, target.lon);
    }

    return {
      state: navState.state,
      stepIdx: navState.stepIdx,
      step: steps[navState.stepIdx] || null,
      distToNextManeuver,
      distToDestination,
      distToRoute,
      nearestIndex: nearest.index,
      currentRoadClass,
      shouldReroute,
      passedStep,
      arrived,
      heading: navState.heading,
      speedMps: speedMps != null ? speedMps : null,
    };
  }

  const BUSY_ROAD_CLASSES = ["primary", "secondary", "trunk", "motorway"];
  const CALM_ROAD_CLASSES = ["path", "track", "pedestrian", "footway", "living_street", "residential"];

  // Pure "what should the ambient soundscape do right now" decision, fed by
  // whatever real context is actually available (current road class, nav
  // state, walking speed) — no traffic-API or weather-API access exists in
  // this app, so those two named context sources from the spec are simply
  // not inputs here; nothing about this function pretends otherwise.
  // Returns a target ambient level multiplier (1 = normal) and why.
  function suggestAmbientLevel(ctx) {
    ctx = ctx || {};
    if (ctx.navState === NavState.OFF_ROUTE || ctx.navState === NavState.RECALCULATING) {
      return { level: 0.4, reason: "off-route-or-recalculating" };
    }
    if (BUSY_ROAD_CLASSES.indexOf(ctx.roadClass) !== -1) {
      return { level: 0.6, reason: "busy-road" };
    }
    if (CALM_ROAD_CLASSES.indexOf(ctx.roadClass) !== -1 && (ctx.speedMps == null || ctx.speedMps < 2.2)) {
      return { level: 1.0, reason: "calm-road" };
    }
    return { level: 0.85, reason: "default" };
  }

  return {
    NavState,
    THRESHOLDS,
    TRAVEL_MODES,
    BUSY_ROAD_CLASSES,
    CALM_ROAD_CLASSES,
    haversineM,
    bearingDeg,
    lerpLatLon,
    smoothHeading,
    destinationPoint,
    nearestRouteDistanceM,
    nearestRouteIndex,
    roadClassAt,
    stepTargetLatLon,
    createNavState,
    resetForNewRoute,
    processFix,
    suggestAmbientLevel,
  };
});
