// A provisioning profile (.mobileprovision) for the on-device signer (I6): the plist inside its CMS envelope, and the
// rules it signs by (which certificate, which App ID, which devices). The website's signer (core/websign.js, F93)
// applies the same ones.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct Profile {
    let data: Data
    let name: String
    let uuid: String
    let team: String
    let appID: String                 // application-identifier without the team: "*", "com.you.*" or explicit
    let entitlements: [String: Any]
    let expires: Date?
    let created: Date?
    let devices: Int                  // -1: all (enterprise)
    let certificates: [Data]          // DeveloperCertificates, DER

    init(_ data: Data) throws {
        self.data = data
        guard let start = data.range(of: Data("<?xml".utf8)), let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), format: nil) as? [String: Any]
        else { throw SignError("bad_profile", "That file isn't a provisioning profile.") }
        name = plist["Name"] as? String ?? ""
        uuid = plist["UUID"] as? String ?? ""
        let ents = plist["Entitlements"] as? [String: Any] ?? [:]
        entitlements = ents
        team = (plist["TeamIdentifier"] as? [String])?.first ?? ents["com.apple.developer.team-identifier"] as? String ?? ""
        let full = ents["application-identifier"] as? String ?? ""
        appID = full.hasPrefix(team + ".") ? String(full.dropFirst(team.count + 1)) : full
        expires = plist["ExpirationDate"] as? Date
        created = plist["CreationDate"] as? Date
        if plist["ProvisionsAllDevices"].flatMap(plistBool) == true { devices = -1 }
        else { devices = (plist["ProvisionedDevices"] as? [Any])?.count ?? 0 }
        certificates = plist["DeveloperCertificates"] as? [Data] ?? []
    }

    var isWildcard: Bool { appID == "*" || appID.hasSuffix(".*") }

    // The bundle ID an app is signed as: a wildcard TEAM.* keeps the app's own; TEAM.com.you.* keeps it if it
    // fits, else puts the last part of the app's ID under the prefix; an explicit app ID signs the app as that ID.
    func bundleID(for appBundleID: String) throws -> String {
        if appID == "*" { return appBundleID }
        if appID.hasSuffix(".*") {
            let prefix = String(appID.dropLast())
            if appBundleID.hasPrefix(prefix) { return appBundleID }
            return prefix + (appBundleID.split(separator: ".").last.map(String.init) ?? appBundleID)
        }
        guard !appID.isEmpty else { throw SignError("bad_profile", "The provisioning profile has no app ID.") }
        return appID
    }

    // F237: the profile's aps-environment ("production" in an Ad Hoc profile with Push, "development" in a
    // development one), or nil when its App ID has no Push (every wildcard profile).
    var pushEnvironment: String? { (entitlements["aps-environment"] as? String).flatMap { $0.isEmpty ? nil : $0 } }

    // F237 (R25's verdict): the IDs one app is signed with. `keep` (Keep Bundle IDs, on by default): Info.plist and
    // the code signature keep the app's own ID (or the one the user typed), and only the entitlements'
    // application-identifier and keychain group take the profile's App ID (explicit, or the wildcard narrowed:
    // bundleID(for:)); iOS's installer never compares the two. Off: the old way, the app becomes a copy under the
    // profile's ID.
    func signingIDs(for appBundleID: String, keep: Bool) throws -> (bundleID: String, entitlementsID: String) {
        let ent = try bundleID(for: appBundleID)
        return (keep ? appBundleID : ent, ent)
    }

    // The profile's entitlements narrowed to one bundle, the way Xcode signs (I5's app_entitlements). The keychain
    // group comes first from the app's own ID (keptID, its Info.plist's) when the profile's groups allow it (TEAM.*
    // does): an explicit profile signs every app under one App ID, and a group named after it was one keychain shared
    // by all of them. Items go to the first group, the app's alone, under any profile or certificate of the same
    // team; TEAM.<App ID> stays second for items an earlier signature put there. The website's signer does the same
    // (core/websign.js keychainGroups).
    func entitlements(for bundleID: String, keptID: String? = nil) -> [String: Any] {
        var e = entitlements
        let t = e["com.apple.developer.team-identifier"] as? String ?? team
        if !t.isEmpty {
            e["application-identifier"] = "\(t).\(bundleID)"
            if e["keychain-access-groups"] != nil {
                e["keychain-access-groups"] = Profile.keychainGroups(e["keychain-access-groups"], team: t, bundleID: bundleID, keptID: keptID ?? bundleID)
            }
        }
        e["get-task-allow"] = false
        return e
    }

    // [TEAM.keptID, TEAM.bundleID] (once when they're the same), the first only when the profile's groups allow it.
    static func keychainGroups(_ allowed: Any?, team: String, bundleID: String, keptID: String) -> [String] {
        let own = "\(team).\(keptID)", app = "\(team).\(bundleID)"
        let ok = (allowed as? [Any] ?? []).compactMap { $0 as? String }
            .contains { $0 == own || ($0.hasSuffix("*") && own.hasPrefix(String($0.dropLast()))) }
        return own != app && ok ? [own, app] : [app]
    }

    // B327: the sign log's keychain line for entitlements(for:keptID:): the groups in order (new items go to the
    // first) and the application-identifier (installd keeps an update to it). The same words as core/websign.js
    // keychainLogLine.
    static func keychainLine(_ ents: [String: Any]) -> String {
        let groups = (ents["keychain-access-groups"] as? [Any] ?? []).compactMap { $0 as? String }
        return "Keychain: " + (groups.isEmpty ? "no keychain groups" : groups.joined(separator: ", "))
            + " (application-identifier \(ents["application-identifier"] as? String ?? "none"))"
    }

    // Why this certificate can't sign with this profile, or nil when it can.
    func problem(with cert: Data, now: Date = Date()) -> SignError? {
        if let x = expires, x < now { return SignError("profile_expired", "The provisioning profile \"\(name)\" expired.") }
        guard let c = try? Certificate(der: cert) else { return SignError("bad_p12", "The certificate can't be read.") }
        if let na = c.notAfter, na < now { return SignError("cert_expired", "The certificate expired.") }
        if let nb = c.notBefore, nb > now { return SignError("cert_expired", "The certificate isn't valid yet.") }
        if !certificates.contains(cert) {
            return SignError("cert_not_in_profile", "The provisioning profile doesn't list this certificate.")
        }
        return nil
    }
}
