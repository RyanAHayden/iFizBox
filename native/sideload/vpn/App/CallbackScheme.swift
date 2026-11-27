import Foundation

/// B491: the scheme Shortcuts calls back on (x-success, x-error, x-cancel), one per installed copy.
/// Every copy claims ifizbox://, and iOS gives that to one of them, so a second copy could take the callback.
/// Each copy also declares ifizbox-<its bundle ID> (lowercase), written into Info.plist at signing
/// (native/sign/IPASigner.swift) and in Info-sideload.plist for the build's own ID.
enum CallbackScheme {
    static let shared = "ifizbox"
    static let prefix = "ifizbox-"

    /// The own scheme for a bundle ID.
    static func own(_ bundleID: String) -> String { prefix + bundleID.lowercased() }

    /// The scheme to call back on: the copy's own when its Info.plist declares it (a copy signed before this, or by
    /// the website signer, does not), else the shared one.
    static func current(bundleID: String? = Bundle.main.bundleIdentifier, info: [String: Any]? = Bundle.main.infoDictionary) -> String {
        guard let id = bundleID else { return shared }
        let mine = own(id)
        let declared = (info?["CFBundleURLTypes"] as? [[String: Any]] ?? [])
            .flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
            .contains { $0.lowercased() == mine }
        return declared ? mine : shared
    }

    /// True for a callback URL's scheme: the shared one, or this copy's own (never another copy's).
    static func accepts(_ scheme: String?, bundleID: String? = Bundle.main.bundleIdentifier) -> Bool {
        guard let s = scheme?.lowercased() else { return false }
        return s == shared || (bundleID.map { s == own($0) } ?? false)
    }
}
