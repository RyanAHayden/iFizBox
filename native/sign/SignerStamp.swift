// B259: which signer made a signed app. Needs Re-sign (web/app/core/signing.js needsResign) otherwise looks only at a
// signature's end, so an app signed before the signer's output changed (B227's own keychain group, B233's group fix)
// kept the old signature until it neared expiry. Each signed record (SignedRecord, My IPAs' signed copy) keeps the
// stamp it was signed with; signing.installed answers the current one beside the records, and an app whose stamp is
// older (or missing: signed before stamps) is listed under Needs Re-sign. A signed copy in My IPAs with an older stamp
// is signed again rather than installed as it is.
//
//   SignerStamp.version   bump it by hand whenever the signer's output changes in a way installed apps should get
//   groupFix              the group fix dylib's hash (hash(_:)) when the app got it, else nil; a different dylib
//                         makes only the apps that carry it stale
//   SignerStamp.now       this build's stamp: version and the bundled dylib's hash
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SignerStamp: Codable, Equatable {
    // 1: own keychain group first and the group fix's own folders (B227, B233). Records with no stamp are older.
    // 2: every app with a keychain group of its own gets the group fix's isolate, its passwords kept there (B327).
    static let version = 2

    var version: Int
    var groupFix: String?

    // The first 16 hex digits of the SHA-256: enough to tell two builds of the dylib apart.
    static func hash(_ d: Data) -> String { String(IPALibrary.hex(sha256(d)).prefix(16)) }

    static var now: SignerStamp { SignerStamp(version: version, groupFix: GroupFix.dylib().map(hash)) }

    // Older than `current`: an earlier version, or a group fix dylib that isn't the current one.
    func isStale(against current: SignerStamp = .now) -> Bool {
        if version < current.version { return true }
        if let g = groupFix, let c = current.groupFix, g != c { return true }
        return false
    }

    var json: [String: Any] {
        var j: [String: Any] = ["version": version]
        j["groupFix"] = groupFix ?? NSNull()
        return j
    }
}

extension SignedApp {
    // The stamp a record of this signing keeps.
    var stamp: SignerStamp { SignerStamp(version: SignerStamp.version, groupFix: groupFix) }
}
