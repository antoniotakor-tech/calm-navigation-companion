package com.calmnav.background

import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper

/**
 * Separate, foreground-only location for autocomplete's "use my current
 * location" and nearby-city-bias detection — never used by the active nav
 * loop (NavigationForegroundService + NavEngine own that entirely). Two
 * independent location paths is intentional: this class has no route/state-
 * machine concept at all, so it physically cannot become a second nav
 * engine (see IOS_/ANDROID_BACKGROUND_NAVIGATION.md's "single-engine
 * invariant").
 */
class AmbientLocation(private val context: Context) {
    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var oneShotListener: LocationListener? = null
    private var continuousListener: LocationListener? = null

    fun getCurrentPosition(onFix: (Location) -> Unit, onError: (String) -> Unit) {
        if (!hasPermission()) { onError("Location permission not granted."); return }
        if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            onError("GPS provider is disabled in system settings.")
            return
        }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                oneShotListener?.let { locationManager.removeUpdates(it) }
                oneShotListener = null
                onFix(location)
            }
            @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderDisabled(provider: String) { onError("GPS provider disabled.") }
            override fun onProviderEnabled(provider: String) {}
        }
        oneShotListener = listener
        locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper())
    }

    fun startUpdates(onFix: (Location) -> Unit, onError: (String) -> Unit) {
        if (!hasPermission()) { onError("Location permission not granted."); return }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) { onFix(location) }
            @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            override fun onProviderDisabled(provider: String) { onError("GPS provider disabled.") }
            override fun onProviderEnabled(provider: String) {}
        }
        continuousListener = listener
        // Deliberately less precise / less frequent than the nav loop's 2s /
        // 3m — this is a light bias stream, not turn-by-turn tracking.
        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 10000L, 50f, listener, Looper.getMainLooper())
    }

    fun stopUpdates() {
        continuousListener?.let { locationManager.removeUpdates(it) }
        continuousListener = null
    }

    private fun hasPermission(): Boolean {
        return context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }
}
