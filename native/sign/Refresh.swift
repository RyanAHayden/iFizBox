// F458: a free Apple ID's refresh without signing again, as AltStore, SideStore and BariStore do it: an installed app
// still signed with the current certificate only needs a fresh profile for its App ID, which iOS takes through
// misagent (IDevice.swift withMisagent): nothing is signed or uploaded. Only an app on another certificate, or one
// whose App ID has no fresh profile (it expired), is signed again.
//   ProfileRefresh.plan(records, certificate:, profiles:, installed:)   what happens to each recorded app
//   ProfileRefresh.run(plan, misagent:, resign:)                       does it; resign gets the rest, once
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

/// Where a profile goes: iOS's misagent on the phone, a stub in the tests.
protocol Misagent { func install(_ profile: Data) throws }

enum ProfileRefresh {
    struct Renewal { let record: SignedRecord; let profile: Profile; let expires: Date? }

    struct Plan {
        var renew: [Renewal] = []
        var resign: [SignedRecord] = []
        var gone: [SignedRecord] = [] // iOS no longer has them: neither renewed nor installed again
    }

    /// The certificate's serial as the record keeps it: upper-case hex, no leading zeros.
    static func serial(_ certificate: Data) -> String? {
        guard let c = try? Certificate(der: certificate), let n = try? DER.parse(c.serial) else { return nil }
        let hex = n.body.map { String(format: "%02X", $0) }.joined()
        return String(hex.drop { $0 == "0" })
    }

    /// `profiles`: the fresh ones from Apple, one per App ID. `installed`: the user apps iOS lists, nil when it
    /// couldn't be asked (an empty list counts as that too: nothing is forgotten on it). An app that already lasts
    /// longer than a fresh free profile would (a paid certificate's) is left as it is. `busy` (F459): a task runs, so an
    /// app iOS doesn't list may still be installing: it is left alone, neither forgotten nor signed again.
    static func plan(_ records: [SignedRecord], certificate: Data, profiles: [Profile], installed: Set<String>?,
                     busy: Bool = false, now: Date = Date()) -> Plan {
        var out = Plan()
        let current = serial(certificate)
        // only a free profile that this certificate can use; the latest to expire wins for an App ID
        var fresh: [String: Profile] = [:]
        for p in profiles where p.isFree && p.problem(with: certificate, now: now) == nil {
            let id = "\(p.team).\(p.appID)"
            if let have = fresh[id], (have.expires ?? .distantPast) >= (p.expires ?? .distantPast) { continue }
            fresh[id] = p
        }
        let latest = fresh.values.compactMap { $0.signatureExpiry(certificate: certificate) }.max()
        for r in records {
            if let have = installed, !have.isEmpty, !have.contains(r.bundleID) {
                if !busy { out.gone.append(r) }
                continue
            }
            if r.certSerial != nil, r.certSerial == current, let id = r.appID, let p = fresh[id] {
                out.renew.append(Renewal(record: r, profile: p, expires: p.signatureExpiry(certificate: certificate)))
            } else if let x = r.expires, let new = latest, x > new {
                continue
            } else {
                out.resign.append(r)
            }
        }
        return out
    }

    struct Outcome {
        var renewed: [Renewal] = []
        var failed: [(record: SignedRecord, error: Error)] = []
    }

    /// Installs each profile once (apps often share an App ID), then hands the apps to sign again to `resign`.
    /// An app whose profile iOS refused is reported, not signed again: the same profile would be refused again.
    static func run(_ plan: Plan, misagent: Misagent, log: (String) -> Void = { _ in }, resign: ([SignedRecord]) -> Void) -> Outcome {
        var out = Outcome()
        var done: [String: Error?] = [:]
        for r in plan.renew {
            let key = r.profile.uuid.isEmpty ? r.profile.appID : r.profile.uuid
            if done[key] == nil {
                do {
                    try misagent.install(r.profile.data)
                    log("Installed the new profile for \(r.profile.appID)")
                    done[key] = .some(nil)
                } catch { done[key] = .some(error) }
            }
            if let error = done[key] ?? nil { out.failed.append((r.record, error)) } else { out.renewed.append(r) }
        }
        resign(plan.resign)
        return out
    }

    /// The records with the renewed apps' new expiry, without the gone ones.
    static func updated(_ records: [SignedRecord], plan: Plan, result: Outcome) -> [SignedRecord] {
        let gone = Set(plan.gone.map(\.bundleID))
        let until = Dictionary(result.renewed.map { ($0.record.bundleID, $0.expires) }, uniquingKeysWith: { a, _ in a })
        return records.filter { !gone.contains($0.bundleID) }.map { r in
            guard let x = until[r.bundleID] else { return r }
            var n = r
            n.expires = x
            return n
        }
    }
}
