import CoreLocation
import Foundation

// Separate, foreground-only location manager for autocomplete's "use my
// current location" and nearby-city-bias detection — deliberately never
// used by the active nav loop (NavigationEngine.swift owns that entirely).
// Two independent CLLocationManager instances is intentional: it keeps
// "exactly one thing processes GPS fixes during active navigation" true by
// construction (this class has no route/state-machine concept at all, so it
// physically cannot become a second nav engine) rather than by convention.
final class AmbientLocationManager: NSObject {
    private let locationManager = CLLocationManager()
    private var oneShotCompletion: ((Result<CLLocation, Error>) -> Void)?
    private var continuousHandler: ((CLLocation) -> Void)?
    private var continuousErrorHandler: ((Error) -> Void)?

    override init() {
        super.init()
        locationManager.delegate = self
        // Deliberately less precise / less power-hungry than the nav loop's
        // kCLLocationAccuracyBestForNavigation — this is a single bias fetch
        // or a light continuous stream, not turn-by-turn tracking.
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter = 50
    }

    func getCurrentPosition(completion: @escaping (Result<CLLocation, Error>) -> Void) {
        let status = locationManager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            completion(.failure(NSError(domain: "CalmNavBackground", code: 1, userInfo: [NSLocalizedDescriptionKey: "Location permission not granted."])))
            return
        }
        oneShotCompletion = completion
        locationManager.requestLocation()
    }

    func startUpdates(onFix: @escaping (CLLocation) -> Void, onError: @escaping (Error) -> Void) {
        continuousHandler = onFix
        continuousErrorHandler = onError
        locationManager.startUpdatingLocation()
    }

    func stopUpdates() {
        continuousHandler = nil
        continuousErrorHandler = nil
        locationManager.stopUpdatingLocation()
    }
}

extension AmbientLocationManager: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        if let completion = oneShotCompletion {
            oneShotCompletion = nil
            completion(.success(location))
        }
        continuousHandler?(location)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let completion = oneShotCompletion {
            oneShotCompletion = nil
            completion(.failure(error))
        }
        continuousErrorHandler?(error)
    }
}
