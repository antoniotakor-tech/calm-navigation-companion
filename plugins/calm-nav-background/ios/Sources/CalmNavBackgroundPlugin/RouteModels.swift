import Foundation

// Mirrors shared/routeTransfer.js's buildNavRoutePayload() output shape.
// See that file's own header comment for why lat/lon are separate named
// numbers rather than [lon,lat] tuples at this specific JS -> native
// boundary — a silent order-swap here would be far more costly than the
// extra verbosity.

struct NavRouteDestination {
    let label: String
    let lat: Double
    let lon: Double
}

struct NavRouteGeometryPoint {
    let lat: Double
    let lon: Double
}

struct NavRouteManeuver {
    let index: Int
    let lat: Double
    let lon: Double
    let text: String
    let distanceM: Double
    let sign: Int
    let streetName: String
    let isFinal: Bool
}

struct NavRouteThresholds {
    let arriveStepM: Double
    let arriveDestM: Double
    let offRouteM: Double
    let offRouteStreakNeeded: Int
    let headingMinSpeedMps: Double
}

struct NavRoutePayload {
    let version: Int
    let createdAtMs: Double
    let travelMode: String
    let safetyMode: Bool
    let destination: NavRouteDestination
    let distanceM: Double
    let durationMs: Double
    let geometry: [NavRouteGeometryPoint]
    let maneuvers: [NavRouteManeuver]
    let thresholds: NavRouteThresholds
    // roadClassSegments ([[Int,Int,String]] triples) is intentionally not
    // carried natively — see IOS_BACKGROUND_NAVIGATION.md's "Known
    // simplifications": road-class-aware ambient level isn't ported here.

    private static func number(_ v: Any?) -> Double? {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        if let n = v as? NSNumber { return n.doubleValue }
        return nil
    }

    // Parses a raw Capacitor call-options dictionary ([String: Any]) — the
    // JS side hands untyped JSON here, not a pre-decoded Codable payload.
    // Returns nil (rather than throwing) on any malformed input, matching
    // shared/routeTransfer.js's validateNavRoutePayload()'s "fail loudly and
    // early" intent: the caller (CalmNavBackgroundPlugin.swift) rejects the
    // call with a clear reason when this returns nil, rather than starting a
    // navigation session against half-parsed data.
    init?(dict: [String: Any]) {
        guard
            let version = dict["version"] as? Int,
            let travelMode = dict["travelMode"] as? String,
            let destDict = dict["destination"] as? [String: Any],
            let destLat = Self.number(destDict["lat"]),
            let destLon = Self.number(destDict["lon"]),
            let geometryArr = dict["geometry"] as? [[String: Any]],
            let maneuversArr = dict["maneuvers"] as? [[String: Any]],
            let thresholdsDict = dict["thresholds"] as? [String: Any]
        else { return nil }

        self.version = version
        self.createdAtMs = Self.number(dict["createdAtMs"]) ?? 0
        self.travelMode = travelMode
        self.safetyMode = (dict["safetyMode"] as? Bool) ?? false
        self.destination = NavRouteDestination(label: (destDict["label"] as? String) ?? "Destination", lat: destLat, lon: destLon)
        self.distanceM = Self.number(dict["distanceM"]) ?? 0
        self.durationMs = Self.number(dict["durationMs"]) ?? 0

        let geometry: [NavRouteGeometryPoint] = geometryArr.compactMap { p in
            guard let lat = Self.number(p["lat"]), let lon = Self.number(p["lon"]) else { return nil }
            return NavRouteGeometryPoint(lat: lat, lon: lon)
        }
        let maneuvers: [NavRouteManeuver] = maneuversArr.compactMap { m in
            guard let idx = m["index"] as? Int, let lat = Self.number(m["lat"]), let lon = Self.number(m["lon"]) else { return nil }
            return NavRouteManeuver(
                index: idx, lat: lat, lon: lon,
                text: (m["text"] as? String) ?? "",
                distanceM: Self.number(m["distanceM"]) ?? 0,
                sign: (m["sign"] as? Int) ?? 0,
                streetName: (m["streetName"] as? String) ?? "",
                isFinal: (m["isFinal"] as? Bool) ?? false
            )
        }
        guard geometry.count >= 2, maneuvers.count >= 1 else { return nil }
        self.geometry = geometry
        self.maneuvers = maneuvers

        guard
            let arriveStepM = Self.number(thresholdsDict["arriveStepM"]),
            let arriveDestM = Self.number(thresholdsDict["arriveDestM"]),
            let offRouteM = Self.number(thresholdsDict["offRouteM"]),
            let offRouteStreakNeeded = thresholdsDict["offRouteStreakNeeded"] as? Int,
            let headingMinSpeedMps = Self.number(thresholdsDict["headingMinSpeedMps"])
        else { return nil }
        self.thresholds = NavRouteThresholds(
            arriveStepM: arriveStepM, arriveDestM: arriveDestM, offRouteM: offRouteM,
            offRouteStreakNeeded: offRouteStreakNeeded, headingMinSpeedMps: headingMinSpeedMps
        )
    }

    init(
        version: Int, createdAtMs: Double, travelMode: String, safetyMode: Bool,
        destination: NavRouteDestination, distanceM: Double, durationMs: Double,
        geometry: [NavRouteGeometryPoint], maneuvers: [NavRouteManeuver], thresholds: NavRouteThresholds
    ) {
        self.version = version
        self.createdAtMs = createdAtMs
        self.travelMode = travelMode
        self.safetyMode = safetyMode
        self.destination = destination
        self.distanceM = distanceM
        self.durationMs = durationMs
        self.geometry = geometry
        self.maneuvers = maneuvers
        self.thresholds = thresholds
    }

    // Encodes back to a [String: Any] dictionary for call.resolve()/
    // notifyListeners(), which both take JSObject ([String: Any])-shaped
    // data — used when a native reroute produces a new route the web-side
    // map (if the app happens to be foregrounded) needs to redraw.
    func toDict() -> [String: Any] {
        [
            "version": version,
            "createdAtMs": createdAtMs,
            "travelMode": travelMode,
            "safetyMode": safetyMode,
            "destination": ["label": destination.label, "lat": destination.lat, "lon": destination.lon],
            "distanceM": distanceM,
            "durationMs": durationMs,
            "geometry": geometry.map { ["lat": $0.lat, "lon": $0.lon] },
            "maneuvers": maneuvers.map {
                [
                    "index": $0.index, "lat": $0.lat, "lon": $0.lon, "text": $0.text, "distanceM": $0.distanceM,
                    "sign": $0.sign, "streetName": $0.streetName, "isFinal": $0.isFinal,
                ] as [String: Any]
            },
            "roadClassSegments": [] as [Any],
            "thresholds": [
                "arriveStepM": thresholds.arriveStepM, "arriveDestM": thresholds.arriveDestM,
                "offRouteM": thresholds.offRouteM, "offRouteStreakNeeded": thresholds.offRouteStreakNeeded,
                "headingMinSpeedMps": thresholds.headingMinSpeedMps,
            ],
        ]
    }
}
