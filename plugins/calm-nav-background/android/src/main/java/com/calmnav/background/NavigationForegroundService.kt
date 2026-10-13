package com.calmnav.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject

/**
 * The Android system-resource owner for background navigation: a genuine
 * foreground service (persistent notification, LocationManager, audio
 * focus). NavEngine (business logic) is fed fixes exclusively by this
 * class — see ANDROID_BACKGROUND_NAVIGATION.md's "single-engine invariant".
 *
 * Started only when the app is visible and the user explicitly starts
 * navigation (CalmNavBackgroundPlugin.startNavigationSession(), itself only
 * reachable from app.js's user-initiated startNativeNavigation()) — never
 * from a background trigger, satisfying Android's restricted-foreground-
 * service-launch rules by construction, not by a runtime check.
 */
class NavigationForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "calm_nav_background"
        const val NOTIFICATION_ID = 4201
        const val ACTION_STOP = "com.calmnav.background.ACTION_STOP"
        const val ACTION_MUTE = "com.calmnav.background.ACTION_MUTE"
        const val ACTION_UNMUTE = "com.calmnav.background.ACTION_UNMUTE"
    }

    inner class LocalBinder : Binder() {
        fun getService(): NavigationForegroundService = this@NavigationForegroundService
    }

    private val binder = LocalBinder()
    private lateinit var engine: NavEngine
    private val ambientNoise = AmbientNoisePlayer()
    private var locationManager: LocationManager? = null
    private var locationListener: LocationListener? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var muted = false
    private var allowAmbient = false
    private var lastInstructionText = "Navigating"
    private var lastDistToNextManeuver = 0.0

    var onEvent: ((type: String, data: JSONObject) -> Unit)? = null
    var onNotificationAction: ((action: String) -> Unit)? = null

    override fun onCreate() {
        super.onCreate()
        engine = NavEngine(applicationContext)
        engine.onEvent = { type, data ->
            if (type == "maneuver" || type == "arrived") updateNotificationFromSnapshot()
            onEvent?.invoke(type, data)
        }
        engine.onSpeakStart = {
            if (allowAmbient) ambientNoise.duck()
            requestAudioFocus()
        }
        engine.onSpeakEnd = {
            if (allowAmbient) ambientNoise.restore()
            // Give focus back after every sentence so the user's own music
            // (Spotify etc.) comes straight back up (2026-10-13) — focus is
            // NOT released automatically, and holding it kept music paused.
            abandonAudioFocus()
        }
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { onNotificationAction?.invoke("stop"); return START_NOT_STICKY }
            ACTION_MUTE -> { onNotificationAction?.invoke("mute"); return START_NOT_STICKY }
            ACTION_UNMUTE -> { onNotificationAction?.invoke("unmute"); return START_NOT_STICKY }
        }
        // Required on Android 10+, enforced more strictly on Android 14 —
        // both the manifest's android:foregroundServiceType="location" and
        // this runtime call must agree (see AndroidManifest.xml).
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, buildNotification(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        )
        // Deliberately START_NOT_STICKY: if the OS kills this process,
        // navigation ends rather than silently restarting with no route
        // state — a clearly-ended session is more honest than a silent
        // restart with no context. See ANDROID_BACKGROUND_NAVIGATION.md.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        stopLocationUpdates()
        ambientNoise.stop()
        engine.destroy()
        abandonAudioFocus()
        super.onDestroy()
    }

    // MARK: - Public API for the Plugin (called via the bound LocalBinder)

    fun startNavigation(route: NavRoutePayload, muted: Boolean, allowAmbient: Boolean, apiBaseUrl: String) {
        // Same class of bug as the web build's startNavigation(), and fixed
        // the same way: unconditionally tear down any previous session
        // before starting a new one. Without this, a second
        // startNavigationSession() call (e.g. a retried plugin call after a
        // slow permission prompt) would leak the previous LocationManager
        // listener — requestLocationUpdates() with a new listener object
        // does not replace a prior registration, it adds another one — so
        // every real GPS fix would drive NavEngine.handleFix() twice,
        // producing duplicate maneuver/voice/haptic events from a single
        // physical movement.
        stopLocationUpdates()
        ambientNoise.stop()
        engine.stop()

        this.muted = muted
        this.allowAmbient = allowAmbient
        engine.start(route, muted, apiBaseUrl)
        lastInstructionText = route.maneuvers.firstOrNull()?.text ?: "Navigating"
        if (allowAmbient) ambientNoise.start()
        startLocationUpdates()
        updateNotificationFromSnapshot()
    }

    fun stopNavigation() {
        stopLocationUpdates()
        ambientNoise.stop()
        engine.stop()
    }

    fun updateRoute(route: NavRoutePayload) {
        engine.updateRoute(route)
        updateNotificationFromSnapshot()
    }

    fun setMuted(muted: Boolean) {
        this.muted = muted
        engine.setMuted(muted)
        updateNotificationFromSnapshot()
    }

    fun snapshot(): JSONObject = engine.snapshot()

    // MARK: - LocationManager (GPS_PROVIDER only — see class header for why
    // Fused Location Provider / Play Services isn't used here)

    private fun startLocationUpdates() {
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            onEvent?.invoke("error", JSONObject().put("type", "error").put("message", "Fine location permission not granted."))
            return
        }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val headingDeg = if (location.hasBearing()) location.bearing.toDouble() else null
                val speedMps = if (location.hasSpeed()) location.speed.toDouble() else null
                val accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null
                engine.handleFix(location.latitude, location.longitude, accuracyM, headingDeg, speedMps, location.time.toDouble())
            }
            @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderDisabled(provider: String) {
                onEvent?.invoke("error", JSONObject().put("type", "error").put("message", "GPS provider was disabled in system settings."))
            }
            override fun onProviderEnabled(provider: String) {}
        }
        locationListener = listener
        // 2-second minimum interval, 3-meter distance filter — appropriate
        // for on-foot/bike precision (see ANDROID_BACKGROUND_NAVIGATION.md).
        locationManager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 3f, listener, Looper.getMainLooper())
    }

    private fun stopLocationUpdates() {
        locationListener?.let { locationManager?.removeUpdates(it) }
        locationListener = null
    }

    // MARK: - Audio focus (USAGE_ASSISTANCE_NAVIGATION_GUIDANCE, transient
    // gain — ducks rather than silences other apps' audio during speech)

    private fun requestAudioFocus() {
        val am = audioManager ?: return
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener { focusChange ->
                // A phone call or another app took priority — surfaced so
                // the UI/engines react honestly instead of fighting it (see
                // ANDROID_BACKGROUND_NAVIGATION.md's "Audio focus").
                if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                    onEvent?.invoke("state", JSONObject().put("type", "state").put("state", "audio-interrupted"))
                } else if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                    onEvent?.invoke("state", JSONObject().put("type", "state").put("state", "audio-resumed"))
                }
            }
            .build()
        audioFocusRequest = request
        am.requestAudioFocus(request)
    }

    private fun abandonAudioFocus() {
        audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
        audioFocusRequest = null
    }

    // MARK: - Persistent notification (instruction, distance, Stop action,
    // Mute/Unmute action, tap-to-open — rebuilt on every maneuver event,
    // never silently stale)

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Navigation", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Ongoing turn-by-turn navigation status"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun updateNotificationFromSnapshot() {
        val snap = engine.snapshot()
        if (snap.optBoolean("active", false)) {
            val route = snap.optJSONObject("route")
            val stepIdx = snap.optInt("stepIdx", 0)
            val maneuvers = route?.optJSONArray("maneuvers")
            val maneuver = maneuvers?.optJSONObject(stepIdx.coerceIn(0, (maneuvers.length() - 1).coerceAtLeast(0)))
            lastInstructionText = maneuver?.optString("text", lastInstructionText) ?: lastInstructionText
            lastDistToNextManeuver = snap.optDouble("distToNextManeuver", lastDistToNextManeuver)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        )
        val stopPending = actionPendingIntent(ACTION_STOP, 1)
        val muteAction = if (muted) {
            NotificationCompat.Action(0, "Unmute", actionPendingIntent(ACTION_UNMUTE, 3))
        } else {
            NotificationCompat.Action(0, "Mute", actionPendingIntent(ACTION_MUTE, 2))
        }

        val distanceText = "${lastDistToNextManeuver.toInt()}m to next turn"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(lastInstructionText)
            .setContentText(distanceText)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setOngoing(true)
            .setContentIntent(openPending)
            .addAction(NotificationCompat.Action(0, "Stop navigation", stopPending))
            .addAction(muteAction)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun actionPendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, NavigationForegroundService::class.java).apply { this.action = action }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getService(this, requestCode, intent, flags)
    }
}
