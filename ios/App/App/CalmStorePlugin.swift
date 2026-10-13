// Apple In-App Purchase for Calm Companion (StoreKit 2), 2026-10-13.
// App Store guideline 3.1.1: inside the iPhone app, Calm+ and tips must be
// bought through Apple. Exposed to the web layer as Capacitor plugin
// "CalmStore" (see native/nativeStore.js).
//
// Products to create in App Store Connect (exact IDs):
//   com.calmnav.companion.calmplus   Non-Consumable   €2.99  "Calm+"
//   com.calmnav.companion.tip1       Consumable       €0.99  "Support the maker – small"
//   com.calmnav.companion.tip3       Consumable       €2.99  "Support the maker – medium"
//   com.calmnav.companion.tip5       Consumable       €4.99  "Support the maker – large"

import Foundation
import Capacitor
import StoreKit

@objc(CalmStorePlugin)
public class CalmStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CalmStorePlugin"
    public let jsName = "CalmStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    ]
    static let ids = ["com.calmnav.companion.calmplus", "com.calmnav.companion.tip1", "com.calmnav.companion.tip3", "com.calmnav.companion.tip5"]
    private var updates: Task<Void, Never>?

    public override func load() {
        // Finish transactions that complete outside a purchase call (Ask to Buy, renewals, other devices).
        updates = Task.detached {
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
            }
        }
    }

    @objc func products(_ call: CAPPluginCall) {
        Task {
            do {
                let list = try await Product.products(for: CalmStorePlugin.ids)
                call.resolve(["products": list.map { ["id": $0.id, "price": $0.displayPrice, "name": $0.displayName] }])
            } catch { call.reject("Couldn't load products: \(error.localizedDescription)") }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), CalmStorePlugin.ids.contains(id) else { return call.reject("Unknown product") }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else { return call.reject("Product not available") }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    guard case .verified(let t) = verification else { return call.reject("Purchase couldn't be verified") }
                    await t.finish()
                    call.resolve(["ok": true, "id": id, "transactionId": String(t.id)])
                case .userCancelled: call.resolve(["ok": false, "cancelled": true])
                case .pending: call.resolve(["ok": false, "pending": true])
                @unknown default: call.resolve(["ok": false])
                }
            } catch { call.reject("Purchase failed: \(error.localizedDescription)") }
        }
    }

    /// Non-consumables the user owns right now (verified by StoreKit on the device).
    @objc func entitlements(_ call: CAPPluginCall) {
        Task {
            var owned: [String] = []
            for await result in Transaction.currentEntitlements {
                if case .verified(let t) = result, t.revocationDate == nil { owned.append(t.productID) }
            }
            call.resolve(["owned": owned])
        }
    }

    /// "Restore purchases" (required by App Review for non-consumables).
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do { try await AppStore.sync() } catch { /* user may cancel the sign-in sheet */ }
            self.entitlements(call)
        }
    }
}
