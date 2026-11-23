import Foundation
import Security

// Install Apps With ("iphone" or "server"), kept in the Keychain so a reinstall, a re-sign or a fresh container (an
// account sign-in after one) comes back on the route it had.
//   route.keep   {value: "iphone"|"server"}  keeps it
//   route.kept   -> the kept Install Apps With, or null (core/installroute.js keepRoute takes it on a fresh start)
// This device only, never in a backup, readable after the first unlock. The Keychain outlives the app's container while
// the signing team stays the same.
enum KeptRoute {
    // The service name is the item's address: unchanged, so a route kept by an earlier build is still found.
    static let service = "com.ryha.ifizbox.tailscale"
    static let account = "route"

    private static func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func read() -> String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data,
              let v = String(data: d, encoding: .utf8), ["iphone", "server"].contains(v) else { return nil }
        return v
    }

    /// A failure is never thrown: the app's own copy (localStorage) still works until the next reinstall.
    static func write(_ value: String) {
        let data = Data(value.utf8)
        let q = query()
        if read() == value { return }
        var st = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if st == errSecItemNotFound {
            var add = q
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            st = SecItemAdd(add as CFDictionary, nil)
        }
        if st != errSecSuccess { NSLog("kept route: keychain refused (\(st))") }
    }

    static func register(_ b: Bridge) {
        b.on("route.keep") { c in
            let v = c.params["value"] as? String ?? ""
            guard ["iphone", "server"].contains(v) else { return Apt.reply(c, nil, "bad_params: value is iphone or server") }
            IDeviceBridge.quick(c) { write(v); return true }
        }
        b.on("route.kept") { c in
            IDeviceBridge.quick(c) { read() ?? NSNull() }
        }
    }
}
