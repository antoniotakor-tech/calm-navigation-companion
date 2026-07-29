package com.calmnav.background

import org.json.JSONArray
import org.json.JSONObject

/**
 * Mirrors shared/routeTransfer.js's buildNavRoutePayload() output shape —
 * see that file's header comment for why lat/lon are separate named numbers
 * rather than [lon,lat] tuples at this specific JS -> native boundary.
 * Parsed via org.json (Android's built-in JSON support), not a third-party
 * serialization library — no extra dependency needed for this plugin.
 */
data class NavRouteDestination(val label: String, val lat: Double, val lon: Double)

data class NavRouteGeometryPoint(val lat: Double, val lon: Double)

data class NavRouteManeuver(
    val index: Int,
    val lat: Double,
    val lon: Double,
    val text: String,
    val distanceM: Double,
    val sign: Int,
    val streetName: String,
    val isFinal: Boolean,
)

data class NavRouteThresholds(
    val arriveStepM: Double,
    val arriveDestM: Double,
    val offRouteM: Double,
    val offRouteStreakNeeded: Int,
    val headingMinSpeedMps: Double,
)

data class NavRoutePayload(
    val version: Int,
    val createdAtMs: Double,
    val travelMode: String,
    val safetyMode: Boolean,
    val destination: NavRouteDestination,
    val distanceM: Double,
    val durationMs: Double,
    val geometry: List<NavRouteGeometryPoint>,
    val maneuvers: List<NavRouteManeuver>,
    val thresholds: NavRouteThresholds,
    // roadClassSegments intentionally not carried — see ANDROID_BACKGROUND_
    // NAVIGATION.md's "Known simplifications": road-class-aware ambient
    // level isn't ported natively.
) {
    fun toJson(): JSONObject {
        val obj = JSONObject()
        obj.put("version", version)
        obj.put("createdAtMs", createdAtMs)
        obj.put("travelMode", travelMode)
        obj.put("safetyMode", safetyMode)
        obj.put("destination", JSONObject().apply {
            put("label", destination.label); put("lat", destination.lat); put("lon", destination.lon)
        })
        obj.put("distanceM", distanceM)
        obj.put("durationMs", durationMs)
        obj.put("geometry", JSONArray().apply {
            geometry.forEach { put(JSONObject().apply { put("lat", it.lat); put("lon", it.lon) }) }
        })
        obj.put("maneuvers", JSONArray().apply {
            maneuvers.forEach {
                put(JSONObject().apply {
                    put("index", it.index); put("lat", it.lat); put("lon", it.lon); put("text", it.text)
                    put("distanceM", it.distanceM); put("sign", it.sign); put("streetName", it.streetName)
                    put("isFinal", it.isFinal)
                })
            }
        })
        obj.put("roadClassSegments", JSONArray())
        obj.put("thresholds", JSONObject().apply {
            put("arriveStepM", thresholds.arriveStepM); put("arriveDestM", thresholds.arriveDestM)
            put("offRouteM", thresholds.offRouteM); put("offRouteStreakNeeded", thresholds.offRouteStreakNeeded)
            put("headingMinSpeedMps", thresholds.headingMinSpeedMps)
        })
        return obj
    }

    companion object {
        /**
         * Parses a raw JSObject (Capacitor hands call options as JSONObject-
         * backed data on Android) into a validated payload. Returns null
         * (rather than throwing) on any malformed input — the caller
         * (CalmNavBackgroundPlugin.kt) rejects the call with a clear reason
         * rather than starting a session against half-parsed data, mirroring
         * shared/routeTransfer.js's validateNavRoutePayload()'s intent.
         */
        fun fromJson(obj: JSONObject): NavRoutePayload? {
            return try {
                val destObj = obj.getJSONObject("destination")
                val destination = NavRouteDestination(
                    label = destObj.optString("label", "Destination"),
                    lat = destObj.getDouble("lat"),
                    lon = destObj.getDouble("lon"),
                )
                val geometryArr = obj.getJSONArray("geometry")
                val geometry = (0 until geometryArr.length()).map {
                    val p = geometryArr.getJSONObject(it)
                    NavRouteGeometryPoint(p.getDouble("lat"), p.getDouble("lon"))
                }
                if (geometry.size < 2) return null

                val maneuversArr = obj.getJSONArray("maneuvers")
                val maneuvers = (0 until maneuversArr.length()).map {
                    val m = maneuversArr.getJSONObject(it)
                    NavRouteManeuver(
                        index = m.getInt("index"), lat = m.getDouble("lat"), lon = m.getDouble("lon"),
                        text = m.optString("text", ""), distanceM = m.optDouble("distanceM", 0.0),
                        sign = m.optInt("sign", 0), streetName = m.optString("streetName", ""),
                        isFinal = m.optBoolean("isFinal", false),
                    )
                }
                if (maneuvers.isEmpty()) return null

                val t = obj.getJSONObject("thresholds")
                val thresholds = NavRouteThresholds(
                    arriveStepM = t.getDouble("arriveStepM"), arriveDestM = t.getDouble("arriveDestM"),
                    offRouteM = t.getDouble("offRouteM"), offRouteStreakNeeded = t.getInt("offRouteStreakNeeded"),
                    headingMinSpeedMps = t.getDouble("headingMinSpeedMps"),
                )

                NavRoutePayload(
                    version = obj.getInt("version"),
                    createdAtMs = obj.optDouble("createdAtMs", 0.0),
                    travelMode = obj.getString("travelMode"),
                    safetyMode = obj.optBoolean("safetyMode", false),
                    destination = destination,
                    distanceM = obj.optDouble("distanceM", 0.0),
                    durationMs = obj.optDouble("durationMs", 0.0),
                    geometry = geometry,
                    maneuvers = maneuvers,
                    thresholds = thresholds,
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
