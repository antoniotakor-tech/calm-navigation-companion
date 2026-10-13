// Registers the app's own Capacitor plugins (2026-10-13).
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CalmStorePlugin())
    }
}
