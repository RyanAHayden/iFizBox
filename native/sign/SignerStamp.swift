// B259: which signer made a signed app. Needs Re-sign (web/app/core/signing.js needsResign) otherwise looks only at a
// signature's end, so an app signed before the signer's output changed (B227's own keychain group, B233's group fix)
// kept the old signature until it neared expiry. Each signed record (SignedRecord, My IPAs' signed copy) keeps the
// stamp it was signed with; signing.installed answers the current one beside the records, and an app whose stamp is
// older (or missing: signed before stamps) is listed under Needs Re-sign. A signed copy in My IPAs with an older stamp
// is signed again rather than installed as it is.
//
//   SignerStamp.reaches   a signer change that installed apps should get is marked here by hand, as a new version with
//                         the apps it reaches: every app, or only those that carry the group fix
//   SignerStamp.version   the newest of those
//   groupFix              the group fix dylib's hash (hash(_:)) when the app got it, else nil. A saved signed copy (My
//                         IPAs) with a different dylib is signed again, whatever its revision
//   groupFixRevision      B458: the revision of the dylib the app got, else nil (also nil in older records). Raise it by
//                         hand only for a dylib change that installed apps with the fix should get (groupfix/build.sh);
//                         without that, a different dylib alone needn't list them
//   SignerStamp.now       this build's stamp: version, and the bundled dylib's hash and revision
//   SignerStamp.currentJSON   `now` for signing.installed, with each version's reach: reach {all: [], groupFix: []}
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SignerStamp: Codable, Equatable {
    // 1: own keychain group first and the group fix's own folders (B227, B233). Records with no stamp are older.
    // 2: every app with a keychain group of its own gets the group fix's isolate, its passwords kept there (B327).
    // 3: no default data protection from the profile that the app's original signature didn't ask for (B413).
    static let reaches: [Int: Reach] = [1: .all, 2: .all, 3: .all]
    static let version = reaches.keys.max() ?? 0

    // Which installed apps a version's change reaches.
    enum Reach: String { case all, groupFix }

    // 1: the dylib of 0.31.0 (hash 496d0525dc08812d); older ones have no revision.
    static let groupFixRevision = 1

    var version: Int
    var groupFix: String?
    var groupFixRevision: Int? = nil

    // The first 16 hex digits of the SHA-256: enough to tell two builds of the dylib apart.
    static func hash(_ d: Data) -> String { String(IPALibrary.hex(sha256(d)).prefix(16)) }

    // A stamp as this build signs; `groupFix`: the hash of the dylib the app got, whose revision goes with it.
    static func signed(groupFix: String?) -> SignerStamp {
        SignerStamp(version: version, groupFix: groupFix, groupFixRevision: groupFix == nil ? nil : groupFixRevision)
    }

    static var now: SignerStamp { signed(groupFix: GroupFix.dylib().map(hash)) }

    // For a saved signed copy: older than `current`, by an earlier version or a group fix dylib that isn't the current one.
    func isStale(against current: SignerStamp = .now) -> Bool {
        if version < current.version { return true }
        if let g = groupFix, let c = current.groupFix, g != c { return true }
        return false
    }

    var json: [String: Any] {
        var j: [String: Any] = ["version": version]
        j["groupFix"] = groupFix ?? NSNull()
        j["groupFixRevision"] = groupFixRevision ?? NSNull()
        return j
    }

    static var currentJSON: [String: Any] {
        var j = now.json
        func versions(_ r: Reach) -> [Int] { reaches.filter { $0.value == r }.keys.sorted() }
        j["reach"] = [Reach.all.rawValue: versions(.all), Reach.groupFix.rawValue: versions(.groupFix)]
        return j
    }
}

extension SignedApp {
    // The stamp a record of this signing keeps.
    var stamp: SignerStamp { .signed(groupFix: groupFix) }
}
