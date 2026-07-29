package com.calmnav.background

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.location.Location
import android.os.Build
import android.os.IBinder
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.PermissionState
import org.json.JSONObject

/**
 * Capacitor-facing bridge — permission staging, binds to
 * NavigationForegroundService (the real Android system-resource owner) and
 * AmbientLocation (foreground-only ambient fixes). See
 * ANDROID_BACKGROUND_NAVIGATION.md for what each method actually does on
 * the OS side and exactly what has/hasn't been verified with a real build.
 */
@CapacitorPlugin(
    name = "CalmNavBackground",
    permissions = [
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION], alias = "location"),
        Permission(strings = [Manifest.permission.ACCESS_BACKGROUND_LOCATION], alias = "backgroundLocation"),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ]
)
class CalmNavBackgroundPlugin : Plugin() {

    private var service: NavigationForegroundService? = null
    private var bound = false
    private val ambient by lazy { AmbientLocation(context) }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val localBinder = binder as NavigationForegroundService.LocalBinder
            service = localBinder.getService()
            bound = true
            service?.onEvent = { _, data -> notifyListeners("navEvent", jsObjectFromJson(data)) }
            service?.onNotificationAction = { action -> notifyListeners("notificationAction", JSObject().put("action", action)) }
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            service = null
            bound = false
        }
    }

    private fun jsObjectFromJson(json: JSONObject): JSObject {
        // com.getcapacitor.JSObject extends org.json.JSONObject, so this is
        // a plain re-wrap, not a deep conversion.
        return JSObject.fromJSONObject(json)
    }

    // MARK: - Permissions

    @PluginMethod
    fun getPermissionStatus(call: PluginCall) {
        val foreground = if (getPermissionState("location") == PermissionState.GRANTED) "granted" else "denied"
        val background = when {
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q -> "not-applicable" // no separate grant before Android 10
            getPermissionState("backgroundLocation") == PermissionState.GRANTED -> "granted"
            else -> "denied"
        }
        call.resolve(JSObject().put("foreground", foreground).put("background", background))
    }

    @PluginMethod
    fun requestForegroundLocationPermission(call: PluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("location", call, "foregroundPermissionCallback")
        }
    }

    @PermissionCallback
    private fun foregroundPermissionCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("location") == PermissionState.GRANTED))
    }

    @PluginMethod
    fun requestBackgroundLocationPermission(call: PluginCall) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", false).put("reason", "Foreground location must be granted before requesting background access."))
            return
        }
        // ACCESS_BACKGROUND_LOCATION doesn't exist as a separate grant
        // before Android 10 — foreground access already implies it.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        if (getPermissionState("backgroundLocation") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        // Android 11+ actively refuses to show a combined prompt here — the
        // OS itself routes this through Settings' "Allow all the time"
        // option once foreground trust is established. requestPermissionForAlias
        // still triggers the correct system flow; it just may land the user
        // in Settings rather than an in-app dialog, depending on OS version.
        requestPermissionForAlias("backgroundLocation", call, "backgroundPermissionCallback")
    }

    @PermissionCallback
    private fun backgroundPermissionCallback(call: PluginCall) {
        val granted = getPermissionState("backgroundLocation") == PermissionState.GRANTED
        val result = JSObject().put("granted", granted)
        if (!granted) {
            result.put("reason", "Background location (\"Allow all the time\") wasn't granted — navigation will pause while locked/backgrounded. You can change this later in Settings.")
        }
        call.resolve(result)
    }

    // MARK: - Ambient / one-shot location (autocomplete only)

    @PluginMethod
    fun startLocationUpdates(call: PluginCall) {
        ambient.startUpdates(
            onFix = { location -> notifyListeners("navEvent", JSObject().put("type", "fix").put("fix", locationToJs(location))) },
            onError = { message -> notifyListeners("navEvent", JSObject().put("type", "error").put("message", message)) }
        )
        call.resolve()
    }

    @PluginMethod
    fun stopLocationUpdates(call: PluginCall) {
        ambient.stopUpdates()
        call.resolve()
    }

    @PluginMethod
    fun getCurrentPosition(call: PluginCall) {
        ambient.getCurrentPosition(
            onFix = { location -> call.resolve(locationToJs(location)) },
            onError = { message -> call.reject(message) }
        )
    }

    private fun locationToJs(location: Location): JSObject {
        return JSObject().apply {
            put("lat", location.latitude); put("lon", location.longitude)
            put("accuracyM", if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL)
            put("headingDeg", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
            put("speedMps", if (location.hasSpeed()) location.speed.toDouble() else JSONObject.NULL)
            put("timestampMs", location.time.toDouble())
        }
    }

    // MARK: - Navigation session — starts (and binds to) NavigationForegroundService

    @PluginMethod
    fun startNavigationSession(call: PluginCall) {
        val routeObj = call.getObject("route")
        val route = routeObj?.let { NavRoutePayload.fromJson(JSONObject(it.toString())) }
        if (route == null) {
            call.reject("Invalid or missing route payload.")
            return
        }
        val wantsBackground = call.getBoolean("wantsBackground", false) ?: false
        val muted = call.getBoolean("muted", false) ?: false
        val allowAmbient = call.getBoolean("allowAmbient", false) ?: false
        val apiBaseUrl = call.getString("apiBaseUrl", "") ?: ""

        // Android 13+ notification permission is requested just-in-time,
        // immediately before the foreground service actually starts — not
        // bundled with location, since it's a conceptually separate need
        // (the user must *see* the notification, not just allow location).
        // Navigation proceeds even if this is denied (see proceedStart()).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            saveCall(call)
            requestPermissionForAlias("notifications", call, "notificationsPermissionCallback")
            pendingStart = PendingStart(route, wantsBackground, muted, allowAmbient, apiBaseUrl)
            return
        }
        proceedStart(call, route, wantsBackground, muted, allowAmbient, apiBaseUrl)
    }

    private data class PendingStart(val route: NavRoutePayload, val wantsBackground: Boolean, val muted: Boolean, val allowAmbient: Boolean, val apiBaseUrl: String)
    private var pendingStart: PendingStart? = null

    @PermissionCallback
    private fun notificationsPermissionCallback(call: PluginCall) {
        val pending = pendingStart
        pendingStart = null
        if (pending == null) { call.reject("Navigation start state was lost."); return }
        proceedStart(call, pending.route, pending.wantsBackground, pending.muted, pending.allowAmbient, pending.apiBaseUrl)
    }

    private fun proceedStart(call: PluginCall, route: NavRoutePayload, wantsBackground: Boolean, muted: Boolean, allowAmbient: Boolean, apiBaseUrl: String) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.resolve(JSObject().put("backgrounded", false).put("reason", "Foreground location permission is required to start navigation."))
            return
        }

        val backgroundGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || getPermissionState("backgroundLocation") == PermissionState.GRANTED
        var reason: String? = null
        val backgrounded = wantsBackground && backgroundGranted
        if (wantsBackground && !backgroundGranted) {
            reason = "Background location isn't granted — navigation will pause while locked/backgrounded."
        }

        val intent = Intent(context, NavigationForegroundService::class.java)
        context.startForegroundService(intent)
        context.bindService(intent, connection, Context.BIND_AUTO_CREATE)

        // startForegroundService()/bindService() are async — the actual
        // startNavigation() call needs the bound service reference, so it's
        // deferred slightly. A production build should replace this with a
        // proper onServiceConnected-triggered continuation rather than a
        // fixed delay; flagged in ANDROID_BACKGROUND_NAVIGATION.md as
        // needing real-device verification of the actual bind timing.
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            service?.startNavigation(route, muted, allowAmbient, apiBaseUrl)
            val result = JSObject().put("backgrounded", backgrounded)
            if (reason != null) result.put("reason", reason)
            call.resolve(result)
        }, 300)
    }

    @PluginMethod
    fun stopNavigationSession(call: PluginCall) {
        service?.stopNavigation()
        if (bound) {
            try { context.unbindService(connection) } catch (e: IllegalArgumentException) { /* not bound */ }
            bound = false
        }
        context.stopService(Intent(context, NavigationForegroundService::class.java))
        call.resolve()
    }

    @PluginMethod
    fun updateNavigationRoute(call: PluginCall) {
        val routeObj = call.getObject("route")
        val route = routeObj?.let { NavRoutePayload.fromJson(JSONObject(it.toString())) }
        if (route == null) { call.reject("Invalid or missing route payload."); return }
        service?.updateRoute(route)
        call.resolve()
    }

    @PluginMethod
    fun getNavigationSnapshot(call: PluginCall) {
        val snap = service?.snapshot() ?: JSONObject().put("active", false)
        call.resolve(jsObjectFromJson(snap))
    }

    @PluginMethod
    fun setMuted(call: PluginCall) {
        val muted = call.getBoolean("muted", false) ?: false
        service?.setMuted(muted)
        call.resolve()
    }
}
