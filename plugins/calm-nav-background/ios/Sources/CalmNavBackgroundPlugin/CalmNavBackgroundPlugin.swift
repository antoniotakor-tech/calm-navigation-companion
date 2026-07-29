import Capacitor
import CoreLocation
import Foundation

// Capacitor-facing bridge — thin delegation to NavigationEngine (active nav
// session) and AmbientLocationManager (one-shot/continuous ambient fixes).
// See IOS_BACKGROUND_NAVIGATION.md for what each method actually does on
// the OS side and exactly what has/hasn't been verified with a real build.
@objc(CalmNavBackgroundPlugin)
public class CalmNavBackgroundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CalmNavBackgroundPlugin"
    public let jsName = "CalmNavBackground"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPermissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestForegroundLocationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBackgroundLocationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLocationUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLocationUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startNavigationSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopNavigationSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateNavigationRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNavigationSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMuted", returnType: CAPPluginReturnPromise),
    ]

    private let engine = NavigationEngine()
    private let ambient = AmbientLocationManager()

    public override func load() {
        engine.onEvent = { [weak self] type, data in
            guard let self = self else { return }
            DispatchQueue.main.async {
                // notificationAction (lock-screen Stop/Mute/Unmute taps, via
                // MPRemoteCommandCenter) is a distinct JS listener channel
                // from navEvent — see native/nativeNotificationController.js
                // vs native/nativeBackgroundNavigationService.js.
                if type == "notificationAction" {
                    self.notifyListeners("notificationAction", data)
                } else {
                    self.notifyListeners("navEvent", data)
                }
            }
        }
    }

    // MARK: - Permissions

    @objc func getPermissionStatus(_ call: CAPPluginCall) {
        let status = engine.permissionStatus()
        call.resolve(["foreground": status.foreground, "background": status.background])
    }

    @objc func requestForegroundLocationPermission(_ call: CAPPluginCall) {
        engine.requestForegroundPermission { granted in
            call.resolve(["granted": granted])
        }
    }

    @objc func requestBackgroundLocationPermission(_ call: CAPPluginCall) {
        engine.requestBackgroundPermission { granted, reason in
            var result: [String: Any] = ["granted": granted]
            if let reason = reason { result["reason"] = reason }
            call.resolve(result)
        }
    }

    // MARK: - Ambient / one-shot location (autocomplete only — never the nav loop)

    @objc func startLocationUpdates(_ call: CAPPluginCall) {
        ambient.startUpdates(
            onFix: { [weak self] location in
                self?.notifyListeners("navEvent", [
                    "type": "fix",
                    "fix": [
                        "lat": location.coordinate.latitude, "lon": location.coordinate.longitude,
                        "accuracyM": location.horizontalAccuracy, "headingDeg": location.course >= 0 ? location.course : NSNull(),
                        "speedMps": location.speed >= 0 ? location.speed : NSNull(),
                        "timestampMs": location.timestamp.timeIntervalSince1970 * 1000,
                    ],
                ])
            },
            onError: { [weak self] error in
                self?.notifyListeners("navEvent", ["type": "error", "message": error.localizedDescription])
            }
        )
        call.resolve()
    }

    @objc func stopLocationUpdates(_ call: CAPPluginCall) {
        ambient.stopUpdates()
        call.resolve()
    }

    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        ambient.getCurrentPosition { result in
            switch result {
            case .success(let location):
                call.resolve([
                    "lat": location.coordinate.latitude, "lon": location.coordinate.longitude,
                    "accuracyM": location.horizontalAccuracy, "headingDeg": location.course >= 0 ? location.course : NSNull(),
                    "speedMps": location.speed >= 0 ? location.speed : NSNull(),
                    "timestampMs": location.timestamp.timeIntervalSince1970 * 1000,
                ])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - Navigation session

    @objc func startNavigationSession(_ call: CAPPluginCall) {
        guard let routeDict = call.getObject("route"), let route = NavRoutePayload(dict: routeDict) else {
            call.reject("Invalid or missing route payload.")
            return
        }
        let wantsBackground = call.getBool("wantsBackground", false)
        let muted = call.getBool("muted", false)
        let allowAmbient = call.getBool("allowAmbient", false)
        let apiBaseUrl = call.getString("apiBaseUrl", "") ?? ""

        let result = engine.start(route: route, wantsBackground: wantsBackground, muted: muted, allowAmbient: allowAmbient, apiBaseUrl: apiBaseUrl)
        var response: [String: Any] = ["backgrounded": result.backgrounded]
        if let reason = result.reason { response["reason"] = reason }
        call.resolve(response)
    }

    @objc func stopNavigationSession(_ call: CAPPluginCall) {
        engine.stop()
        call.resolve()
    }

    @objc func updateNavigationRoute(_ call: CAPPluginCall) {
        guard let routeDict = call.getObject("route"), let route = NavRoutePayload(dict: routeDict) else {
            call.reject("Invalid or missing route payload.")
            return
        }
        engine.updateRoute(route)
        call.resolve()
    }

    @objc func getNavigationSnapshot(_ call: CAPPluginCall) {
        call.resolve(engine.snapshot())
    }

    @objc func setMuted(_ call: CAPPluginCall) {
        engine.setMuted(call.getBool("muted", false))
        call.resolve()
    }
}
