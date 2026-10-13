package com.calmnav.background

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The actual navigation engine: location math (hand-ported from
 * navlogic.js's processFix — that file is the canonical version this must
 * be kept in sync with by hand, see ANDROID_BACKGROUND_NAVIGATION.md),
 * native TextToSpeech voice guidance, and native reroute-with-backoff.
 * Fed fixes exclusively by NavigationForegroundService, which owns
 * LocationManager/the notification/audio focus — this class has no Android
 * Service lifecycle concept at all.
 */
class NavEngine(private val context: Context) {

    // Voice distance bands — mirrors voiceengine.js's VOICE_NEAR_M/VOICE_FAR_M
    // fallback values (not part of the wire payload, so duplicated here too).
    private val voiceNearM = 30.0
    private val voiceFarM = 220.0

    private var route: NavRoutePayload? = null
    private var stepIdx = 0
    private var offRouteStreak = 0
    private var state = "navigating"
    private var lastFix: Pair<Double, Double>? = null
    private var heading: Double? = null
    private val spoken = mutableSetOf<String>()
    private var lastAnnouncedStepIdx: Int? = null
    private var lastEventAtMs = 0.0
    private var distToNextManeuverCache = 0.0
    private var distToDestinationCache = 0.0
    private var muted = false
    private var apiBaseUrl = ""

    // Reroute backoff — mirrors shared/rerouteBackoff.js exactly.
    private var rerouteAttempts = 0
    private val rerouteMaxAttempts = 5
    private val rerouteBaseDelayMs = 3000.0
    private val rerouteMaxDelayMs = 60000.0
    private var lastRerouteAttemptAtMs = 0.0
    private var rerouteInFlight = false

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    var onEvent: ((type: String, data: JSONObject) -> Unit)? = null
    var onSpeakStart: (() -> Unit)? = null
    var onSpeakEnd: (() -> Unit)? = null

    init {
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) { onSpeakStart?.invoke() }
                override fun onDone(utteranceId: String?) { onSpeakEnd?.invoke() }
                @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) { onSpeakEnd?.invoke() }
            })
        }
    }

    fun start(route: NavRoutePayload, muted: Boolean, apiBaseUrl: String) {
        this.route = route
        this.stepIdx = 0
        this.offRouteStreak = 0
        this.state = "navigating"
        this.lastFix = null
        this.heading = null
        this.spoken.clear()
        this.lastAnnouncedStepIdx = null
        this.rerouteAttempts = 0
        this.muted = muted
        this.apiBaseUrl = apiBaseUrl
    }

    fun updateRoute(newRoute: NavRoutePayload) {
        route = newRoute
        stepIdx = 0
        offRouteStreak = 0
        state = "navigating"
        spoken.clear()
    }

    fun stop() {
        tts?.stop()
        route = null
    }

    fun destroy() {
        tts?.shutdown()
        tts = null
    }

    fun setMuted(muted: Boolean) {
        this.muted = muted
        if (muted) tts?.stop()
    }

    fun snapshot(): JSONObject {
        val r = route ?: return JSONObject().put("active", false)
        return JSONObject().apply {
            put("active", true)
            put("route", r.toJson())
            put("stepIdx", stepIdx)
            put("state", state)
            put("distToNextManeuver", distToNextManeuverCache)
            put("distToDestination", distToDestinationCache)
            put("lastEventAtMs", lastEventAtMs)
            put("lastAnnouncedStepIdx", lastAnnouncedStepIdx ?: JSONObject.NULL)
        }
    }

    // MARK: Core per-fix update, hand-ported from navlogic.js's processFix().
    fun handleFix(lat: Double, lon: Double, accuracyM: Double?, headingDeg: Double?, speedMps: Double?, timestampMs: Double) {
        val route = this.route ?: return

        var derivedHeading = headingDeg
        val last = lastFix
        if (derivedHeading == null && last != null && speedMps != null && speedMps >= route.thresholds.headingMinSpeedMps) {
            derivedHeading = bearingDeg(last.first, last.second, lat, lon)
        }
        lastFix = Pair(lat, lon)
        if (derivedHeading != null) heading = derivedHeading

        val nearest = nearestRouteIndex(lat, lon, route.geometry)
        val distToRoute = nearest.second

        if (distToRoute > route.thresholds.offRouteM) {
            offRouteStreak++
        } else {
            offRouteStreak = 0
            if (state == "off_route") state = "navigating"
        }

        val shouldReroute = offRouteStreak >= route.thresholds.offRouteStreakNeeded
        if (shouldReroute) state = "off_route"

        val lastPoint = route.geometry.last()
        val distToDestination = haversineM(lat, lon, lastPoint.lat, lastPoint.lon)
        val arrived = distToDestination < route.thresholds.arriveDestM
        if (arrived) state = "arrived"

        var passedStep = false
        var target = route.maneuvers[stepIdx.coerceAtMost(route.maneuvers.size - 1)]
        var distToNextManeuver = haversineM(lat, lon, target.lat, target.lon)
        while (!arrived && distToNextManeuver < route.thresholds.arriveStepM && stepIdx < route.maneuvers.size - 1) {
            stepIdx++
            passedStep = true
            target = route.maneuvers[stepIdx]
            distToNextManeuver = haversineM(lat, lon, target.lat, target.lon)
        }

        distToNextManeuverCache = distToNextManeuver
        distToDestinationCache = distToDestination
        lastEventAtMs = timestampMs

        val fixObj = JSONObject().apply {
            put("lat", lat); put("lon", lon)
            put("accuracyM", accuracyM ?: JSONObject.NULL); put("headingDeg", heading ?: JSONObject.NULL)
            put("speedMps", speedMps ?: JSONObject.NULL); put("timestampMs", timestampMs)
        }
        emit("fix", JSONObject().apply {
            put("fix", fixObj); put("stepIdx", stepIdx)
            put("distToNextManeuver", distToNextManeuver); put("distToDestination", distToDestination)
        })

        if (passedStep) {
            emit("maneuver", JSONObject().apply { put("stepIdx", stepIdx); put("distToNextManeuver", distToNextManeuver) })
            onceKey("$stepIdx:onstep") { speak(target.text) }
            lastAnnouncedStepIdx = stepIdx
        } else {
            announceIfNeeded(target, distToNextManeuver)
        }

        if (arrived) {
            onceKey("arrived") { speak("You have arrived at your destination.") }
            emit("arrived", JSONObject())
            return
        }

        if (shouldReroute) {
            emit("offroute", JSONObject().put("distToRoute", distToRoute))
            attemptRerouteIfDue(lat, lon)
        }
    }

    private fun announceIfNeeded(maneuver: NavRouteManeuver, distToNextManeuver: Double) {
        if (maneuver.text.isEmpty()) return
        if (distToNextManeuver <= voiceNearM) {
            onceKey("$stepIdx:near") { speak(maneuver.text) }
        } else if (distToNextManeuver <= voiceFarM) {
            val rounded = (Math.round(distToNextManeuver / 10.0) * 10).toInt()
            onceKey("$stepIdx:far") { speak("In $rounded meters, ${maneuver.text.lowercase()}") }
        }
    }

    private fun onceKey(key: String, fn: () -> Unit) {
        if (spoken.contains(key)) return
        spoken.add(key)
        fn()
    }

    private fun speak(text: String) {
        if (muted || text.isEmpty() || !ttsReady) return
        val params = android.os.Bundle()
        tts?.speak(text, TextToSpeech.QUEUE_ADD, params, "calmnav-${System.currentTimeMillis()}")
    }

    // MARK: Geometry, hand-ported from navlogic.js

    private fun toRad(d: Double) = d * Math.PI / 180
    private fun toDeg(r: Double) = r * 180 / Math.PI

    private fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val dLat = toRad(lat2 - lat1)
        val dLon = toRad(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) + cos(toRad(lat1)) * cos(toRad(lat2)) * sin(dLon / 2).pow(2)
        return 2 * r * asin(min(1.0, sqrt(a)))
    }

    private fun bearingDeg(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val y = sin(toRad(lon2 - lon1)) * cos(toRad(lat2))
        val x = cos(toRad(lat1)) * sin(toRad(lat2)) - sin(toRad(lat1)) * cos(toRad(lat2)) * cos(toRad(lon2 - lon1))
        return (toDeg(atan2(y, x)) + 360) % 360
    }

    private fun nearestRouteIndex(lat: Double, lon: Double, coordinates: List<NavRouteGeometryPoint>): Pair<Int, Double> {
        // Distance to the route LINE, not its points (2026-10-13, mirrors
        // navlogic.js) — no more reroutes while walking on a long straight.
        var minDist = Double.POSITIVE_INFINITY
        var idx = 0
        val kx = 111320.0 * Math.cos(Math.toRadians(lat)); val ky = 110540.0
        for (i in coordinates.indices) {
            val ax = (coordinates[i].lon - lon) * kx; val ay = (coordinates[i].lat - lat) * ky
            var d = Math.hypot(ax, ay); var near = i
            if (i + 1 < coordinates.size) {
                val bx = (coordinates[i + 1].lon - lon) * kx; val by = (coordinates[i + 1].lat - lat) * ky
                val dx = bx - ax; val dy = by - ay; val len2 = dx * dx + dy * dy
                val t = if (len2 > 0) Math.max(0.0, Math.min(1.0, -(ax * dx + ay * dy) / len2)) else 0.0
                val seg = Math.hypot(ax + t * dx, ay + t * dy)
                if (seg < d) { d = seg; near = if (t > 0.5) i + 1 else i }
            }
            if (d < minDist) { minDist = d; idx = near }
        }
        return Pair(idx, minDist)
    }

    // MARK: Reroute, backoff mirrored from shared/rerouteBackoff.js

    private fun attemptRerouteIfDue(lat: Double, lon: Double) {
        if (rerouteInFlight || rerouteAttempts >= rerouteMaxAttempts) return
        val nowMs = System.currentTimeMillis().toDouble()
        val delay = min(rerouteBaseDelayMs * 2.0.pow(rerouteAttempts), rerouteMaxDelayMs)
        if (lastRerouteAttemptAtMs != 0.0 && (nowMs - lastRerouteAttemptAtMs) < delay) return

        val currentRoute = route ?: return
        rerouteInFlight = true
        lastRerouteAttemptAtMs = nowMs
        rerouteAttempts++
        emit("reroute-needed", JSONObject())
        onceKey("recalculating-${rerouteAttempts}") { speak("Recalculating your route.") }

        Thread {
            val newRoute = performReroute(lat, lon, currentRoute.destination, currentRoute.travelMode, currentRoute.thresholds)
            rerouteInFlight = false
            if (newRoute != null) {
                rerouteAttempts = 0 // success resets the counter, per rerouteBackoff.js's recordSuccess()
                route = newRoute
                stepIdx = 0
                offRouteStreak = 0
                state = "navigating"
                spoken.clear()
                emit("rerouted", JSONObject().put("route", newRoute.toJson()))
            }
            // failure: next off-route fix past the backoff delay retries — see attemptRerouteIfDue's own delay check
        }.start()
    }

    // Takes GraphHopper's first returned path only — not routing.js's
    // calm-vs-fastest scored choice. Named simplification, see
    // ANDROID_BACKGROUND_NAVIGATION.md's "Known simplifications". Plain
    // HttpURLConnection, not OkHttp/Retrofit — same "avoid adding a
    // dependency" philosophy as GPS_PROVIDER-only location.
    private fun performReroute(lat: Double, lon: Double, destination: NavRouteDestination, travelMode: String, thresholds: NavRouteThresholds): NavRoutePayload? {
        return try {
            val ghProfile = if (travelMode == "bike") "bike" else "foot"
            val query = listOf(
                "point=${URLEncoder.encode("$lat,$lon", "UTF-8")}",
                "point=${URLEncoder.encode("${destination.lat},${destination.lon}", "UTF-8")}",
                "profile=$ghProfile",
                "algorithm=alternative_route",
                "max_paths=3",
                "max_weight_factor=2.0",
                "max_share_factor=0.7",
                "points_encoded=false",
                "locale=en",
            ).joinToString("&")
            val url = URL("$apiBaseUrl/api/route?$query")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            if (connection.responseCode != 200) { connection.disconnect(); return null }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()

            val json = JSONObject(body)
            val paths = json.getJSONArray("paths")
            if (paths.length() == 0) return null
            val firstPath = paths.getJSONObject(0)
            buildRoutePayload(firstPath, destination, travelMode, thresholds)
        } catch (e: Exception) {
            null
        }
    }

    private fun buildRoutePayload(path: JSONObject, destination: NavRouteDestination, travelMode: String, thresholds: NavRouteThresholds): NavRoutePayload? {
        val coordsArr = path.getJSONObject("points").getJSONArray("coordinates")
        if (coordsArr.length() < 2) return null
        val geometry = (0 until coordsArr.length()).map {
            val pair = coordsArr.getJSONArray(it)
            NavRouteGeometryPoint(lat = pair.getDouble(1), lon = pair.getDouble(0)) // GraphHopper returns [lon, lat]
        }
        val instructionsArr = path.optJSONArray("instructions")
        val maneuvers = mutableListOf<NavRouteManeuver>()
        if (instructionsArr != null) {
            for (i in 0 until instructionsArr.length()) {
                val instr = instructionsArr.getJSONObject(i)
                val interval = instr.optJSONArray("interval")
                val idx = if (interval != null && interval.length() == 2) interval.getInt(1) else geometry.size - 1
                val point = geometry.getOrElse(idx) { geometry.last() }
                maneuvers.add(
                    NavRouteManeuver(
                        index = idx, lat = point.lat, lon = point.lon,
                        text = instr.optString("text", ""), distanceM = instr.optDouble("distance", 0.0),
                        sign = instr.optInt("sign", 0), streetName = instr.optString("street_name", ""),
                        isFinal = i == instructionsArr.length() - 1,
                    )
                )
            }
        }
        if (maneuvers.isEmpty()) {
            val last = geometry.last()
            maneuvers.add(NavRouteManeuver(geometry.size - 1, last.lat, last.lon, "Arrive at destination", 0.0, 4, "", true))
        }

        return NavRoutePayload(
            version = 1, createdAtMs = System.currentTimeMillis().toDouble(), travelMode = travelMode, safetyMode = false,
            destination = destination, distanceM = path.optDouble("distance", 0.0), durationMs = path.optDouble("time", 0.0),
            geometry = geometry, maneuvers = maneuvers, thresholds = thresholds,
        )
    }

    private fun emit(type: String, data: JSONObject) {
        data.put("type", type)
        onEvent?.invoke(type, data)
    }
}
