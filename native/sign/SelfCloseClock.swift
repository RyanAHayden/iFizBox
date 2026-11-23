// When iFizBox closes itself during its own update on the This iPhone route (Sideload.swift installHere), through
// the built-in VPN. On iOS 17.4+ (RemotePairing) installd doesn't end the running copy: it takes the new IPA
// and then waits until the old copy is gone, so installation_proxy's Complete never comes while iFizBox runs (user
// 2026-11-20: stuck on "iOS is installing it" until the app was swiped away, then it finished). Waiting for installd
// to stand still (the first rule) still left it hanging, so the rule is now: once installd has accepted
// the install (its first status, any percentage), iFizBox closes `accepted` later; installd goes on without it. If
// installd sends no status at all, `firstQuiet` after the copy ended. Later statuses change nothing.
// Pure, no UIKit: native/sign/tests/sideload/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct SelfCloseClock {
    static let firstQuiet: TimeInterval = 10 // the IPA is copied and installd hasn't sent a status yet
    static let accepted: TimeInterval = 1 // installd's first status: it has the install, close this soon after

    private(set) var copiedAt: Date?
    private(set) var acceptedAt: Date?
    private(set) var percent: Int? // installd's first percentage, for the log

    // The IPA's copy to iOS has ended: the fallback clock starts (once).
    mutating func copied(at t: Date) {
        if copiedAt == nil { copiedAt = t }
    }

    // installd sent a status (0...100). -> true for the first one (the caller re-arms its timer and logs it)
    @discardableResult
    mutating func installd(_ pct: Int, at t: Date) -> Bool {
        if copiedAt == nil { copiedAt = t } // a status means the copy is over
        guard acceptedAt == nil else { return false }
        acceptedAt = t
        percent = pct
        return true
    }

    // When iFizBox closes; nil while the IPA is still being copied.
    var closeAt: Date? {
        if let a = acceptedAt { return a.addingTimeInterval(Self.accepted) }
        return copiedAt?.addingTimeInterval(Self.firstQuiet)
    }

    func due(_ now: Date) -> Bool { closeAt.map { now >= $0 } ?? false }

    // Why it closes, for the logs.
    var reason: String {
        if let p = percent { return "installd accepted the install (\(p)%)" }
        return "installd sent no status \(Int(Self.firstQuiet)) s after the copy"
    }
}
