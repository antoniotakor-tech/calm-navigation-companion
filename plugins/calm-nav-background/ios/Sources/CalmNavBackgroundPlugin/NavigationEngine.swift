import AVFAudio
import CoreLocation
import Foundation
import MediaPlayer

// The actual navigation engine: location math (hand-ported from
// navlogic.js's processFix — see that file for the canonical version this
// must be kept in sync with by hand), native voice guidance, audio session
// management, Now Playing/lock-screen info, and native reroute-with-backoff.
//
// Owns CLLocationManager directly rather than going through
// AmbientLocationManager — see that file's header for why the two are kept
// completely separate (this one is the single, exclusive owner of the
// active nav GPS stream; see IOS_BACKGROUND_NAVIGATION.md's "single-engine
// invariant").
final class NavigationEngine: NSObject {
    // MARK: - Thresholds mirrored from navlogic.js's THRESHOLDS, minus the
    // route-specific ones which travel with each NavRoutePayload instead
    // (arriveStepM/arriveDestM/offRouteM/offRouteStreakNeeded/headingMinSpeedMps).
    // VOICE_NEAR_M/VOICE_FAR_M are not part of the wire payload (voiceengine.js
    // hardcodes a fallback of the same values), so they're duplicated here too.
    private let voiceNearM: Double = 30
    private let voiceFarM: Double = 220

    // MARK: - State
    private var route: NavRoutePayload?
    private var stepIdx: Int = 0
    private var offRouteStreak: Int = 0
    private var state: String = "navigating" // mirrors NavLogic.NavState string values
    private var lastFix: (lat: Double, lon: Double)?
    private var heading: Double?
    private var spoken = Set<String>() // "<stepIdx>:<band>" already announced this leg — mirrors VoiceEngine.spoken
    private var lastAnnouncedStepIdx: Int?
    private var lastEventAtMs: Double = 0
    private var distToNextManeuverCache: Double = 0
    private var distToDestinationCache: Double = 0

    private var muted: Bool = false
    private var allowAmbient: Bool = false
    private var apiBaseUrl: String = ""
    private var wantsBackground: Bool = false
    private var isActive: Bool = false

    // Reroute backoff — mirrors shared/rerouteBackoff.js exactly (same
    // constants), since it's the same tunable, just duplicated because Swift
    // and JS can't share source.
    private var rerouteAttempts = 0
    private let rerouteMaxAttempts = 5
    private let rerouteBaseDelayMs: Double = 3000
    private let rerouteMaxDelayMs: Double = 60000
    private var lastRerouteAttemptAtMs: Double = 0
    private var rerouteInFlight = false

    // MARK: - Location
    private let locationManager = CLLocationManager()

    // MARK: - Voice
    private let speechSynthesizer = AVSpeechSynthesizer()

    // MARK: - Ambient noise (generic filtered-noise loop — not a port of
    // ambientengine.js's 11 soundscapes; see IOS_BACKGROUND_NAVIGATION.md's
    // "Known simplifications" for why).
    private var ambientEngine: AVAudioEngine?
    private var ambientPlayer: AVAudioPlayerNode?
    private var ambientEQ: AVAudioUnitEQ?
    private var ambientDucked = false

    // MARK: - Callback into the plugin, which forwards to notifyListeners("navEvent", ...)
    var onEvent: ((_ type: String, _ data: [String: Any]) -> Void)?

    override init() {
        super.init()
        locationManager.delegate = self
    }

    // MARK: - Permissions

    func permissionStatus() -> (foreground: String, background: String) {
        let status = locationManager.authorizationStatus
        let foreground: String
        switch status {
        case .authorizedWhenInUse, .authorizedAlways: foreground = "granted"
        case .denied, .restricted: foreground = "denied"
        case .notDetermined: foreground = "prompt"
        @unknown default: foreground = "prompt"
        }
        let background: String
        switch status {
        case .authorizedAlways: background = "granted"
        case .denied, .restricted: background = "denied"
        case .authorizedWhenInUse, .notDetermined: background = "prompt"
        @unknown default: background = "prompt"
        }
        return (foreground, background)
    }

    private var pendingForegroundPermissionCompletion: ((Bool) -> Void)?
    private var pendingBackgroundPermissionCompletion: ((Bool, String?) -> Void)?

    func requestForegroundPermission(_ completion: @escaping (Bool) -> Void) {
        let status = locationManager.authorizationStatus
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            completion(true)
            return
        }
        guard status == .notDetermined else {
            completion(false)
            return
        }
        pendingForegroundPermissionCompletion = completion
        locationManager.requestWhenInUseAuthorization()
    }

    func requestBackgroundPermission(_ completion: @escaping (Bool, String?) -> Void) {
        let status = locationManager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            completion(false, "Foreground location must be granted before requesting background access.")
            return
        }
        if status == .authorizedAlways {
            completion(true, nil)
            return
        }
        pendingBackgroundPermissionCompletion = completion
        // iOS presents this as an upgrade prompt ("Change to Always Allow?")
        // rather than the harsher first-ask dialog, because foreground use
        // already established trust — see IOS_BACKGROUND_NAVIGATION.md.
        locationManager.requestAlwaysAuthorization()
    }

    // MARK: - Session lifecycle

    // Returns (backgrounded, reason) — backgrounded is only ever true when
    // .authorizedAlways is actually confirmed; never optimistic (see
    // shared/interfaces.js's BackgroundNavigationService doc comment).
    func start(route: NavRoutePayload, wantsBackground: Bool, muted: Bool, allowAmbient: Bool, apiBaseUrl: String) -> (backgrounded: Bool, reason: String?) {
        guard CLLocationManager.locationServicesEnabled() else {
            return (false, "Location Services are turned off system-wide.")
        }

        // Same class of bug as the web build's startNavigation(), and fixed
        // the same way: unconditionally tear down any previous session
        // before starting a new one, rather than assuming this is only ever
        // called once. Without this, a second startNavigationSession() call
        // (e.g. the JS side retrying after a slow permission prompt) would
        // leave the previous CLLocationManager delivery running AND, more
        // subtly, register duplicate MPRemoteCommandCenter targets in
        // setupNowPlaying() below — addTarget() adds another handler rather
        // than replacing the existing one, so a single lock-screen Stop/Mute
        // tap would fire the JS event twice.
        if isActive { stop() }

        self.route = route
        self.stepIdx = 0
        self.offRouteStreak = 0
        self.state = "navigating"
        self.lastFix = nil
        self.heading = nil
        self.spoken.removeAll()
        self.lastAnnouncedStepIdx = nil
        self.rerouteAttempts = 0
        self.muted = muted
        self.allowAmbient = allowAmbient
        self.apiBaseUrl = apiBaseUrl
        self.wantsBackground = wantsBackground

        configureAudioSession()
        if allowAmbient { startAmbientLoop() }

        let authStatus = locationManager.authorizationStatus
        var reason: String? = nil
        var backgrounded = false

        if authStatus == .authorizedAlways && wantsBackground {
            locationManager.allowsBackgroundLocationUpdates = true
            locationManager.showsBackgroundLocationIndicator = true
            backgrounded = true
        } else {
            locationManager.allowsBackgroundLocationUpdates = false
            if wantsBackground {
                reason = "Background location isn't granted — navigation will pause while locked/backgrounded."
            }
        }

        if #available(iOS 14.0, *), locationManager.accuracyAuthorization == .reducedAccuracy {
            let accNote = "Precise location is off — off-route detection may be less reliable."
            reason = reason.map { $0 + " " + accNote } ?? accNote
        }

        locationManager.activityType = .fitness
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = 5
        // Deliberate: iOS's automatic-pause heuristic is tuned for "car
        // parked, stationary" and would inappropriately pause updates during
        // a legitimate pedestrian pause (waiting at a crossing) — see
        // IOS_BACKGROUND_NAVIGATION.md. Battery tradeoff named there too.
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.startUpdatingLocation()

        setupNowPlaying()
        isActive = true

        return (backgrounded, reason)
    }

    func stop() {
        isActive = false
        locationManager.stopUpdatingLocation()
        locationManager.allowsBackgroundLocationUpdates = false
        speechSynthesizer.stopSpeaking(at: .immediate)
        stopAmbientLoop()
        teardownNowPlaying()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        route = nil
    }

    func updateRoute(_ newRoute: NavRoutePayload) {
        guard isActive else { return }
        route = newRoute
        stepIdx = 0
        offRouteStreak = 0
        state = "navigating"
        spoken.removeAll()
    }

    func snapshot() -> [String: Any] {
        guard isActive, let route = route else { return ["active": false] }
        return [
            "active": true,
            "route": route.toDict(),
            "stepIdx": stepIdx,
            "state": state,
            "distToNextManeuver": distToNextManeuverCache,
            "distToDestination": distToDestinationCache,
            "lastEventAtMs": lastEventAtMs,
            "lastAnnouncedStepIdx": lastAnnouncedStepIdx as Any,
        ]
    }

    func setMuted(_ muted: Bool) {
        self.muted = muted
        if muted { speechSynthesizer.stopSpeaking(at: .immediate) }
    }

    // MARK: - Core per-fix update, hand-ported from navlogic.js's processFix().
    // Any change there must be mirrored here by hand — see
    // IOS_BACKGROUND_NAVIGATION.md's "Keeping the ported engine in sync"
    // section; there is no automated check for drift today.
    private func handleFix(lat: Double, lon: Double, accuracyM: Double?, headingDeg: Double?, speedMps: Double?, timestampMs: Double) {
        guard let route = route else { return }

        var derivedHeading = headingDeg
        if derivedHeading == nil, let last = lastFix, let speed = speedMps, speed >= route.thresholds.headingMinSpeedMps {
            derivedHeading = bearingDeg(lat1: last.lat, lon1: last.lon, lat2: lat, lon2: lon)
        }
        lastFix = (lat, lon)
        if let h = derivedHeading { heading = h }

        let nearest = nearestRouteIndex(lat: lat, lon: lon, coordinates: route.geometry)
        let distToRoute = nearest.distanceM

        if distToRoute > route.thresholds.offRouteM {
            offRouteStreak += 1
        } else {
            offRouteStreak = 0
            if state == "off_route" { state = "navigating" }
        }

        let shouldReroute = offRouteStreak >= route.thresholds.offRouteStreakNeeded
        if shouldReroute { state = "off_route" }

        let lastPoint = route.geometry[route.geometry.count - 1]
        let distToDestination = haversineM(lat1: lat, lon1: lon, lat2: lastPoint.lat, lon2: lastPoint.lon)
        let arrived = distToDestination < route.thresholds.arriveDestM
        if arrived { state = "arrived" }

        var passedStep = false
        var target = route.maneuvers[min(stepIdx, route.maneuvers.count - 1)]
        var distToNextManeuver = haversineM(lat1: lat, lon1: lon, lat2: target.lat, lon2: target.lon)
        while !arrived && distToNextManeuver < route.thresholds.arriveStepM && stepIdx < route.maneuvers.count - 1 {
            stepIdx += 1
            passedStep = true
            target = route.maneuvers[stepIdx]
            distToNextManeuver = haversineM(lat1: lat, lon1: lon, lat2: target.lat, lon2: target.lon)
        }

        distToNextManeuverCache = distToNextManeuver
        distToDestinationCache = distToDestination
        lastEventAtMs = timestampMs

        let fixData: [String: Any] = [
            "lat": lat, "lon": lon,
            "accuracyM": accuracyM as Any, "headingDeg": heading as Any,
            "speedMps": speedMps as Any, "timestampMs": timestampMs,
        ]
        emit("fix", ["fix": fixData, "stepIdx": stepIdx, "distToNextManeuver": distToNextManeuver, "distToDestination": distToDestination])

        if passedStep {
            emit("maneuver", ["stepIdx": stepIdx, "distToNextManeuver": distToNextManeuver])
            speak(text: target.text, stepIdx: stepIdx, justAdvanced: true)
            updateNowPlaying()
        } else {
            announceIfNeeded(maneuver: target, distToNextManeuver: distToNextManeuver)
        }

        if arrived {
            speak(text: "You have arrived at your destination.", key: "arrived", urgent: true)
            emit("arrived", [:])
            updateNowPlaying()
            return
        }

        if shouldReroute {
            emit("offroute", ["distToRoute": distToRoute])
            attemptRerouteIfDue(from: lat, lon: lon)
        }
    }

    private func announceIfNeeded(maneuver: NavRouteManeuver, distToNextManeuver: Double) {
        guard !maneuver.text.isEmpty else { return }
        if distToNextManeuver <= voiceNearM {
            onceKey("\(stepIdx):near") { self.speak(text: maneuver.text, stepIdx: self.stepIdx, justAdvanced: false) }
        } else if distToNextManeuver <= voiceFarM {
            let rounded = (distToNextManeuver / 10).rounded() * 10
            let text = "In \(Int(rounded)) meters, \(maneuver.text.lowercased())"
            onceKey("\(stepIdx):far") { self.speak(text: text, stepIdx: self.stepIdx, justAdvanced: false) }
        }
    }

    private func onceKey(_ key: String, _ fn: () -> Void) {
        if spoken.contains(key) { return }
        spoken.insert(key)
        fn()
    }

    private func speak(text: String, stepIdx: Int, justAdvanced: Bool) {
        if justAdvanced { onceKey("\(stepIdx):onstep") { speak(text: text, key: nil, urgent: false) } }
        else { speak(text: text, key: nil, urgent: false) }
        lastAnnouncedStepIdx = stepIdx
    }

    private func speak(text: String, key: String?, urgent: Bool) {
        if let key = key { onceKey(key) { reallySpeak(text) } } else { reallySpeak(text) }
    }

    private func reallySpeak(_ text: String) {
        guard !muted, !text.isEmpty else { return }
        duckAmbientForSpeech()
        duckOtherAppsForSpeech()
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        speechSynthesizer.speak(utterance)
    }

    // MARK: - Geometry, hand-ported from navlogic.js

    private func toRad(_ d: Double) -> Double { d * .pi / 180 }
    private func toDeg(_ r: Double) -> Double { r * 180 / .pi }

    private func haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let R = 6371000.0
        let dLat = toRad(lat2 - lat1)
        let dLon = toRad(lon2 - lon1)
        let a = pow(sin(dLat / 2), 2) + cos(toRad(lat1)) * cos(toRad(lat2)) * pow(sin(dLon / 2), 2)
        return 2 * R * asin(min(1, sqrt(a)))
    }

    private func bearingDeg(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let y = sin(toRad(lon2 - lon1)) * cos(toRad(lat2))
        let x = cos(toRad(lat1)) * sin(toRad(lat2)) - sin(toRad(lat1)) * cos(toRad(lat2)) * cos(toRad(lon2 - lon1))
        return (toDeg(atan2(y, x)) + 360).truncatingRemainder(dividingBy: 360)
    }

    private func nearestRouteIndex(lat: Double, lon: Double, coordinates: [NavRouteGeometryPoint]) -> (index: Int, distanceM: Double) {
        var minDist = Double.infinity
        var idx = 0
        for (i, p) in coordinates.enumerated() {
            let d = haversineM(lat1: lat, lon1: lon, lat2: p.lat, lon2: p.lon)
            if d < minDist { minDist = d; idx = i }
        }
        return (idx, minDist)
    }

    // MARK: - Reroute, backoff mirrored from shared/rerouteBackoff.js

    private func attemptRerouteIfDue(from lat: Double, lon: Double) {
        guard !rerouteInFlight, rerouteAttempts < rerouteMaxAttempts else { return }
        let nowMs = Date().timeIntervalSince1970 * 1000
        let delay = min(rerouteBaseDelayMs * pow(2, Double(rerouteAttempts)), rerouteMaxDelayMs)
        guard lastRerouteAttemptAtMs == 0 || (nowMs - lastRerouteAttemptAtMs) >= delay else { return }

        // apiBaseUrl may legitimately be "" (same-origin on web; native always
        // supplies CONFIG.NATIVE_API_BASE_URL — see NATIVE_SETUP.md), so it's
        // not itself a precondition for attempting a reroute.
        guard let route = route else { return }
        rerouteInFlight = true
        lastRerouteAttemptAtMs = nowMs
        rerouteAttempts += 1
        emit("reroute-needed", [:])
        speak(text: "Recalculating your route.", key: "recalculating", urgent: true)

        performReroute(startLat: lat, startLon: lon, destination: route.destination, travelMode: route.travelMode) { [weak self] newRoute in
            guard let self = self else { return }
            self.rerouteInFlight = false
            guard let newRoute = newRoute else { return } // failure: next off-route fix past the backoff delay retries
            self.rerouteAttempts = 0 // success resets the counter, per rerouteBackoff.js's recordSuccess()
            self.route = newRoute
            self.stepIdx = 0
            self.offRouteStreak = 0
            self.state = "navigating"
            self.spoken.removeAll()
            self.emit("rerouted", ["route": newRoute.toDict()])
        }
    }

    // Takes GraphHopper's first returned path only — not routing.js's
    // calm-vs-fastest scored choice. Named simplification, see
    // IOS_BACKGROUND_NAVIGATION.md's "Known simplifications".
    private func performReroute(startLat: Double, startLon: Double, destination: NavRouteDestination, travelMode: String, completion: @escaping (NavRoutePayload?) -> Void) {
        var components = URLComponents(string: apiBaseUrl + "/api/route")
        let ghProfile = travelMode == "bike" ? "bike" : "foot"
        components?.queryItems = [
            URLQueryItem(name: "point", value: "\(startLat),\(startLon)"),
            URLQueryItem(name: "point", value: "\(destination.lat),\(destination.lon)"),
            URLQueryItem(name: "profile", value: ghProfile),
            URLQueryItem(name: "algorithm", value: "alternative_route"),
            URLQueryItem(name: "max_paths", value: "3"),
            URLQueryItem(name: "max_weight_factor", value: "2.0"),
            URLQueryItem(name: "max_share_factor", value: "0.7"),
            URLQueryItem(name: "points_encoded", value: "false"),
            URLQueryItem(name: "locale", value: "en"),
        ]
        guard let url = components?.url else { completion(nil); return }

        let task = URLSession.shared.dataTask(with: url) { data, response, error in
            guard error == nil, let data = data,
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let paths = json["paths"] as? [[String: Any]], let firstPath = paths.first
            else { completion(nil); return }

            completion(Self.buildRoutePayload(from: firstPath, destination: destination, travelMode: travelMode, thresholds: self.route?.thresholds))
        }
        task.resume()
    }

    private static func buildRoutePayload(from path: [String: Any], destination: NavRouteDestination, travelMode: String, thresholds: NavRouteThresholds?) -> NavRoutePayload? {
        guard
            let points = path["points"] as? [String: Any],
            let coords = points["coordinates"] as? [[Double]],
            coords.count >= 2
        else { return nil }

        let geometry = coords.compactMap { pair -> NavRouteGeometryPoint? in
            guard pair.count >= 2 else { return nil }
            return NavRouteGeometryPoint(lat: pair[1], lon: pair[0]) // GraphHopper returns [lon, lat]
        }
        let instructions = (path["instructions"] as? [[String: Any]]) ?? []
        var maneuvers: [NavRouteManeuver] = instructions.enumerated().compactMap { i, instr in
            let interval = instr["interval"] as? [Int]
            let idx = interval?.count == 2 ? interval![1] : geometry.count - 1
            let point = (idx >= 0 && idx < geometry.count) ? geometry[idx] : geometry[geometry.count - 1]
            return NavRouteManeuver(
                index: idx, lat: point.lat, lon: point.lon,
                text: (instr["text"] as? String) ?? "",
                distanceM: (instr["distance"] as? Double) ?? 0,
                sign: (instr["sign"] as? Int) ?? 0,
                streetName: (instr["street_name"] as? String) ?? "",
                isFinal: i == instructions.count - 1
            )
        }
        if maneuvers.isEmpty {
            let last = geometry[geometry.count - 1]
            maneuvers = [NavRouteManeuver(index: geometry.count - 1, lat: last.lat, lon: last.lon, text: "Arrive at destination", distanceM: 0, sign: 4, streetName: "", isFinal: true)]
        }

        return NavRoutePayload(
            version: 1,
            createdAtMs: Date().timeIntervalSince1970 * 1000,
            travelMode: travelMode,
            safetyMode: false,
            destination: destination,
            distanceM: (path["distance"] as? Double) ?? 0,
            durationMs: (path["time"] as? Double) ?? 0,
            geometry: geometry,
            maneuvers: maneuvers,
            thresholds: thresholds ?? NavRouteThresholds(arriveStepM: 18, arriveDestM: 20, offRouteM: 35, offRouteStreakNeeded: 3, headingMinSpeedMps: 0.6)
        )
    }

    // MARK: - Audio session (category .playback, mode .voicePrompt, ducking
    // not exclusive — see IOS_BACKGROUND_NAVIGATION.md's "Voice, audio
    // session, and lock-screen controls").

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            // Mix only — the user's own music plays at full volume between
            // directions; it is ducked just while a sentence is spoken (2026-10-13).
            try session.setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            emit("error", ["message": "Audio session configuration failed: \(error.localizedDescription)"])
        }
        NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption(_:)), name: AVAudioSession.interruptionNotification, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(handleRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: session)
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else { return }

        if type == .began {
            emit("state", ["state": "audio-interrupted"])
        } else if type == .ended {
            if let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt,
               AVAudioSession.InterruptionOptions(rawValue: optionsValue).contains(.shouldResume) {
                try? AVAudioSession.sharedInstance().setActive(true)
                emit("state", ["state": "audio-resumed"])
            }
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        guard let info = notification.userInfo,
              let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
        else { return }
        // oldDeviceUnavailable covers Bluetooth/wired headphone disconnects —
        // iOS automatically routes back to the built-in speaker; nothing
        // extra required here beyond letting the UI know a route change
        // happened, since audio (voice guidance) continues either way.
        if reason == .oldDeviceUnavailable || reason == .newDeviceAvailable {
            emit("state", ["state": "audio-route-changed"])
        }
    }

    // MARK: - Ambient noise (generic filtered-noise loop)

    private func startAmbientLoop() {
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        let eq = AVAudioUnitEQ(numberOfBands: 1)
        eq.bands[0].filterType = .lowPass
        eq.bands[0].frequency = 900
        eq.bands[0].bypass = false

        engine.attach(player)
        engine.attach(eq)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        engine.connect(player, to: eq, format: format)
        engine.connect(eq, to: engine.mainMixerNode, format: format)

        guard let buffer = Self.generateNoiseBuffer(format: format, seconds: 4) else { return }
        player.scheduleBuffer(buffer, at: nil, options: .loops)
        player.volume = 0.18

        do {
            try engine.start()
            player.play()
            ambientEngine = engine
            ambientPlayer = player
            ambientEQ = eq
        } catch {
            emit("error", ["message": "Ambient audio engine failed to start: \(error.localizedDescription)"])
        }
    }

    private static func generateNoiseBuffer(format: AVAudioFormat, seconds: Double) -> AVAudioPCMBuffer? {
        let frameCount = AVAudioFrameCount(format.sampleRate * seconds)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return nil }
        buffer.frameLength = frameCount
        guard let channelData = buffer.floatChannelData else { return nil }
        for i in 0..<Int(frameCount) {
            channelData[0][i] = Float.random(in: -1...1) * 0.35
        }
        return buffer
    }

    private func stopAmbientLoop() {
        ambientPlayer?.stop()
        ambientEngine?.stop()
        ambientPlayer = nil
        ambientEngine = nil
        ambientEQ = nil
    }

    private var unduckWork: DispatchWorkItem?
    private func duckOtherAppsForSpeech() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .mixWithOthers])
        unduckWork?.cancel()
        let work = DispatchWorkItem {
            try? session.setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers])
        }
        unduckWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0, execute: work)
    }

    private func duckAmbientForSpeech() {
        guard let player = ambientPlayer, allowAmbient, !ambientDucked else { return }
        ambientDucked = true
        player.volume = 0.05
        // Fixed-duration restore, matching Android's approach (see
        // ANDROID_BACKGROUND_NAVIGATION.md) rather than a precise
        // AVSpeechSynthesizerDelegate "did finish" callback, for directly
        // comparable ducking behavior across both platforms in this pass.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            guard let self = self, let p = self.ambientPlayer else { return }
            p.volume = 0.18
            self.ambientDucked = false
        }
    }

    // MARK: - Now Playing / lock-screen (MPNowPlayingInfoCenter + MPRemoteCommandCenter)

    private func setupNowPlaying() {
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.stopCommand.isEnabled = true
        commandCenter.stopCommand.addTarget { [weak self] _ in
            self?.emit("notificationAction", ["action": "stop"])
            return .success
        }
        // MPRemoteCommandCenter has no native "mute this app's speech"
        // command — pause/play are repurposed as mute/unmute, the most
        // appropriate *supported* lock-screen surface without a full Live
        // Activity (see IOS_BACKGROUND_NAVIGATION.md).
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.emit("notificationAction", ["action": "mute"])
            return .success
        }
        commandCenter.playCommand.isEnabled = true
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.emit("notificationAction", ["action": "unmute"])
            return .success
        }
        updateNowPlaying()
    }

    private func updateNowPlaying() {
        guard let route = route else { return }
        let maneuver = route.maneuvers[min(stepIdx, route.maneuvers.count - 1)]
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: maneuver.text.isEmpty ? "Navigating" : maneuver.text,
            MPMediaItemPropertyArtist: route.destination.label,
            MPMediaItemPropertyAlbumTitle: "\(Int(distToNextManeuverCache))m to next turn",
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
        ]
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func teardownNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.stopCommand.removeTarget(nil)
        commandCenter.pauseCommand.removeTarget(nil)
        commandCenter.playCommand.removeTarget(nil)
    }

    // MARK: - Event emission

    private func emit(_ type: String, _ data: [String: Any]) {
        var payload = data
        payload["type"] = type
        onEvent?(type, payload)
    }
}

// MARK: - CLLocationManagerDelegate

extension NavigationEngine: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if let completion = pendingForegroundPermissionCompletion, status != .notDetermined {
            pendingForegroundPermissionCompletion = nil
            completion(status == .authorizedWhenInUse || status == .authorizedAlways)
        }
        if let completion = pendingBackgroundPermissionCompletion, status != .notDetermined {
            pendingBackgroundPermissionCompletion = nil
            if status == .authorizedAlways {
                completion(true, nil)
            } else {
                completion(false, "iOS didn't grant \"Always Allow\" — navigation will pause while locked/backgrounded. You can change this later in Settings.")
            }
        }
        // Background permission revoked mid-session (user opened Settings
        // while navigating): detect the downgrade, turn off
        // allowsBackgroundLocationUpdates, and emit an error rather than
        // silently continuing to claim background capability — see
        // IOS_BACKGROUND_NAVIGATION.md's "Handled failure modes".
        if isActive && wantsBackground && status != .authorizedAlways && manager.allowsBackgroundLocationUpdates {
            manager.allowsBackgroundLocationUpdates = false
            emit("error", ["message": "Background location permission was revoked — navigation continues in the foreground only."])
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, isActive else { return }
        let headingDeg = location.course >= 0 ? location.course : nil
        let speedMps = location.speed >= 0 ? location.speed : nil
        let accuracyM = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        handleFix(
            lat: location.coordinate.latitude, lon: location.coordinate.longitude,
            accuracyM: accuracyM, headingDeg: headingDeg, speedMps: speedMps,
            timestampMs: location.timestamp.timeIntervalSince1970 * 1000
        )
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        emit("error", ["message": "Location update failed: \(error.localizedDescription)"])
    }
}
