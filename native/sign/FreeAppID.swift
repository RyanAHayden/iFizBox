// B502: a free Apple ID's explicit profile. iOS installs an app signed with it only when the app's bundle ID is the
// profile's App ID (0xe8008016 otherwise), so Keep Bundle IDs doesn't apply: an app signs as the ID of the profile it
// is signed with, and a second app under one ID would replace the first with its data, which is refused.
// B502a: each app has an App ID of its own (<bundle id>.<TEAMID>); its profile is kept here, one file per App ID (App
// Refresh's go in), and the signer picks it. With none for an app, it signs with the setup's (the held one).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum FreeAppID {
    // The App ID an app has under a free team, as core/freeroute.js freeAppId.
    static func appID(for bundleID: String, team: String) -> String {
        bundleID.uppercased().hasSuffix(".\(team.uppercased())") ? bundleID : "\(bundleID).\(team)"
    }

    // Keeps an app's profile in `dir`, in place of an earlier one for its App ID. Refused unless the
    // held profile pins the bundle ID and this one is a free explicit profile of the same team for this certificate.
    @discardableResult
    static func keep(_ data: Data, held: Profile, certificate: Data, in dir: URL, now: Date = Date()) throws -> Profile {
        let p = try Profile(data)
        guard held.pinsBundleID, p.pinsBundleID, p.team == held.team, SignOptions.validBundleID(p.appID), !p.appID.isEmpty else {
            throw SignError("bad_profile", "That isn't a free Apple ID's profile for one app of this team.")
        }
        if let why = p.problem(with: certificate, now: now) { throw why }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try data.write(to: dir.appendingPathComponent("\(p.appID).mobileprovision"), options: .atomic)
        return p
    }

    static func kept(in dir: URL) -> [Profile] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "mobileprovision" }
            .compactMap { (try? Data(contentsOf: $0)).flatMap { try? Profile($0) } }
    }

    // The profile to sign an app with. `asked`: the bundle ID typed, else the app's own; `original`: the app's own.
    // An app already installed under the held profile's App ID stays there (an update keeps its data). Otherwise the
    // latest-lasting usable profile for the app's own App ID, else the held one. A profile that pins nothing is used as it is.
    static func profile(for asked: String, original: String, held: Profile, kept: [Profile], certificate: Data,
                        records: [SignedRecord], installed: (String) -> Bool?, now: Date = Date()) -> Profile {
        guard held.pinsBundleID else { return held }
        let there = records.contains { $0.bundleID == held.appID && $0.originalBundleID == original }
            && installed(held.appID) != false
        let want = there ? held.appID : appID(for: asked, team: held.team)
        return usable(want, among: [held] + kept, held: held, certificate: certificate, now: now) ?? held
    }

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

    // F463: iOS wants an extension's ID to start with its app's, and a free profile pins it too, so each extension has
    // an App ID of its own: <the app's App ID>.<what the extension adds to the app's bundle ID>, two that would get one
    // ID numbered. `extensions`: their own bundle IDs, in Inspect's order; `original`: the app's own. The IDs in the
    // same order, as core/freeroute.js appIdsFor.
    static func extensionIDs(app: String, original: String, _ extensions: [String]) -> [String] {
        var taken = Set<String>()
        return extensions.map { ext in
            let under = [app, original].first { !$0.isEmpty && ext.lowercased().hasPrefix($0.lowercased() + ".") }
            let tail = under.map { String(ext.dropFirst($0.count + 1)) } ?? String(ext.split(separator: ".").last ?? "")
            let base = "\(app).\(tail)"
            var id = base, n = 2
            while taken.contains(id.lowercased()) { id = "\(base)\(n)"; n += 1 }
            taken.insert(id.lowercased())
            return id
        }
    }

    // The longest-lasting usable profile of the held one's team for exactly `appID`, or nil.
    static func usable(_ appID: String, among profiles: [Profile], held: Profile, certificate: Data, now: Date = Date()) -> Profile? {
        profiles.filter { $0.pinsBundleID && $0.team == held.team && $0.appID == appID && $0.problem(with: certificate, now: now) == nil }
            .max { ($0.expires ?? .distantPast) < ($1.expires ?? .distantPast) }
    }

    // Why Re-sign can't renew `r` under `profile` (the one it would be signed with), or nil: signed as the profile's
    // App ID, an app installed under another bundle ID would become a second copy.
    static func resignRefusal(_ r: SignedRecord, _ profile: Profile) -> SignError? {
        guard profile.pinsBundleID, r.bundleID != profile.appID else { return nil }
        return SignError("app_id_mismatch", "A free Apple ID can't re-sign \(r.shownName) under its bundle ID. Install it again instead.")
    }

    static func taken(by other: String) -> SignError {
        let why = "No App ID of its own was made for this app, and \(other) has the one it would be signed as, so this install would replace \(other)."
        if other == Brand.name { return SignError("app_id_taken", why) }
        return SignError("app_id_taken", why + " To install this app, delete \(other) and remove it from Signed Apps.")
    }
}
