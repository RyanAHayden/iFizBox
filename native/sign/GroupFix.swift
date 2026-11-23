// B211: signed apps keep their own app-group folders and keychain. The same rules as the website's signer
// (web/app/core/groupfix.js): the original executable's entitlements are read before signing, and an app that asks
// for app groups the profile can't give, or names keychain access groups, gets the fix dylib (native/groupfix/,
// committed built at web/app/vendor/groupfix/ and bundled with web/) through the tweak path (Tweaks.swift), with
// its config beside it: { groups, target ("": a folder of the app's own; a profile group only for an app an earlier
// sign mapped there), keychain }.
// iFizBox's own IPA never gets it.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum GroupFix {
    static let dylibPath = "Frameworks/ifizbox-groupfix.dylib"
    static let configPath = "Frameworks/ifizbox-groupfix.plist"
    static let inject = "@rpath/ifizbox-groupfix.dylib"
    // The dylib's bytes, from the app's bundled web/ (the tests set their own); nil signs without it.
    static var dylib: () -> Data? = {
        try? Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("web/vendor/groupfix/ifizbox-groupfix.dylib"))
    }

    struct Plan: Equatable {
        var groups: [String]
        var target: String
        var keychain: Bool
        var lost: String? = nil   // B227: the profile group an earlier sign mapped to, which this profile lacks
        var legacy: String? = nil // B227: the profile group older signs mapped to, copied into the app's own once
        var isolate: String? = nil // B327: the app's own keychain group, its passwords' only one (groupfix.m)
    }

    private static func strings(_ v: Any?) -> [String] { (v as? [Any] ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty } }

    // The original's groups the profile doesn't have, to a folder of the app's own (target ""); nil when there's
    // nothing to fix. `previous`: the config an earlier sign left in the app (an IPA signed again), whose groups still
    // count. B227: never the profile's first group for a new plan (it changed when the profile was made again, and
    // every app signed with it shared it); an earlier sign's profile group stays while the profile has it, else `lost`.
    // B327: `isolate`, the app's own keychain group, whenever the signed app has one besides TEAM.<App ID> (the keychain
    // every app under that App ID shares; core/groupfix.js the same): every app gets the fix then.
    static func plan(original: [String: Any]?, profile: [String: Any], previous: Data? = nil, keychainGroups: [String] = []) -> Plan? {
        let prev = previous.flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: Any] } ?? [:]
        let o = original ?? [:]
        let have = strings(profile["com.apple.security.application-groups"])
        var groups = [String]()
        for g in strings(o["com.apple.security.application-groups"]) + strings(prev["groups"]) where !have.contains(g) && !groups.contains(g) {
            groups.append(g)
        }
        let keychain = !strings(o["keychain-access-groups"]).isEmpty || (prev["keychain"] as? Bool) == true
        let kc = strings(keychainGroups)
        let isolate = kc.count > 1 ? kc[0] : nil
        guard !groups.isEmpty || keychain || isolate != nil else { return nil }
        let was = prev["target"] as? String ?? ""
        var p = Plan(groups: groups, target: !was.isEmpty && have.contains(was) ? was : "", keychain: keychain,
                     lost: !was.isEmpty && !have.contains(was) ? was : nil, isolate: isolate)
        // the group the older rule (the profile's first) would have picked: the dylib copies its folder and suite into
        // the app's own once, so an app signed that way, now signed again from its original IPA, keeps that data
        if p.target.isEmpty, let first = have.first, !(previous != nil && prev["target"] as? String == "") { p.legacy = first }
        return p
    }

    // B327: the sign log's line for the group fix a sign put in, every part of its config (the same words as
    // core/groupfix.js groupFixLogLine), or why it put none in.
    static let notNeeded = "the original signature names no app groups or keychain groups"
    static func logLine(_ p: Plan?, none: String = notNeeded) -> String {
        guard let p = p else { return "Group fix: none (\(none))" }
        return "Group fix: \(p.groups.isEmpty ? "no app groups" : p.groups.joined(separator: ", ")) -> "
            + (p.target.isEmpty ? "the app's own folder" : p.target) + (p.keychain ? "; keychain groups stripped" : "")
            + (p.legacy.map { "; \($0) copied in once if the app ran before" } ?? "")
            + (p.isolate.map { "; passwords kept in \($0), the shared groups' copied in once if the app ran before" } ?? "")
    }

    // The tweak set with the dylib and its config added (after the user's own tweaks).
    static func adding(_ p: Plan, dylib: Data, to tweaks: TweakSet?) throws -> TweakSet {
        var c: [String: Any] = ["groups": p.groups, "target": p.target, "keychain": p.keychain]
        if let l = p.legacy { c["legacy"] = l }
        if let i = p.isolate { c["isolate"] = i }
        let config = try PropertyListSerialization.data(fromPropertyList: c, format: .xml, options: 0)
        var t = tweaks ?? TweakSet()
        t.files.removeAll { $0.path == dylibPath || $0.path == configPath }
        t.files += [TweakFile(path: dylibPath, data: dylib), TweakFile(path: configPath, data: config)]
        t.inject = t.inject.filter { $0 != inject } + [inject]
        return t
    }
}
