// B502: a free Apple ID's explicit profile. iOS installs an app signed with it only when the app's bundle ID is the
// profile's App ID (0xe8008016 otherwise), so Keep Bundle IDs doesn't apply: every app signs as that one ID, and a
// second app would replace the first with its data. Until each app has an App ID of its own, that is refused.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum FreeAppID {
    // The name of the other app that has `bundleID`, or nil when signing `originalID` as it replaces nothing else.
    // `own`: the running app's bundle ID (a computer install on a free Apple ID has the profile's). `installed`:
    // what iOS says; nil (it can't be asked: iOS 27) counts as installed.
    static func holder(of bundleID: String, for originalID: String, own: String?, records: [SignedRecord],
                       installed: (String) -> Bool?) -> String? {
        if originalID == bundleID { return nil } // that app itself, signed again
        if own == bundleID { return originalID == SignOptions.selfBundleID ? nil : Brand.name }
        guard let r = records.first(where: { $0.bundleID == bundleID }), r.originalBundleID != originalID,
              installed(bundleID) != false else { return nil }
        return r.shownName
    }

    // Why Re-sign can't renew `r` under `profile`, or nil: signed as the profile's App ID, an app installed under
    // another bundle ID would become a second copy.
    static func resignRefusal(_ r: SignedRecord, _ profile: Profile) -> SignError? {
        guard profile.pinsBundleID, r.bundleID != profile.appID else { return nil }
        return SignError("app_id_mismatch", "A free Apple ID can't re-sign \(r.shownName) under its bundle ID. Install it again instead.")
    }

    static func taken(by other: String) -> SignError {
        let why = "A free Apple ID signs every app as one bundle ID, and \(other) has it, so this install would replace \(other)."
        if other == Brand.name { return SignError("app_id_taken", why) }
        return SignError("app_id_taken", why + " To install this app, delete \(other) and remove it from Signed Apps.")
    }
}
