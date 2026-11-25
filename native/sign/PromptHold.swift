// B435: when an install's KeepAlive hold (silent audio) is given back while iOS hasn't asked for the IPA. One per IPA
// served to iOS's Install prompt (Sideload.serveChecked); InstallPrompt.Awake feeds it and does what it answers.
//
// Held from the start of serving. With no request from iOS, it is given back `quiet` s after the prompt was dismissed,
// or after the app went to the background with the prompt unanswered, whichever is first; an upload to the Signing
// Server under way puts that off. An open of the install link (Try Again) or iOS's first request takes it again, and
// from that request on only over() gives it back. Every .take is followed by exactly one .release.
// Pure, no UIKit: native/test_prompt_hold.py tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct PromptHold {
    enum Step: Equatable { case none, take, release }
    static let quiet: TimeInterval = 60
    static let beat: TimeInterval = 2 // InstallServer's heartbeat: a suspension's start is seen up to this much early

    private(set) var held = false
    private(set) var requested = false // iOS asked for the IPA
    private var ended = false // no longer served: never taken again
    private var gone = false // over(): given back for good
    private var uploading = false
    private var dismissedAt: Date?, backgroundAt: Date?
    private var takenAt = Date.distantPast, releasedAt: Date?

    // Serving starts; `background`: the app isn't in front.
    mutating func start(at t: Date, background: Bool) -> Step {
        if background { backgroundAt = t }
        return take(t)
    }

    // The install link is handed to iOS, for the first time or again (the app is in front).
    mutating func opened(at t: Date) -> Step {
        dismissedAt = nil
        backgroundAt = nil
        return take(t)
    }

    // The prompt closed (or another install of the same app took its place).
    mutating func dismissed(at t: Date) { if dismissedAt == nil { dismissedAt = t } }

    mutating func background(at t: Date) { if backgroundAt == nil { backgroundAt = t } }
    mutating func foreground() { backgroundAt = nil }

    // iOS asked for the IPA, here or at the Signing Server.
    mutating func request(at t: Date) -> Step {
        guard !ended, !gone else { return .none }
        requested = true
        return take(t)
    }

    // The upload after a freeze (hostAfterFreeze) began or ended.
    mutating func upload(_ on: Bool, at t: Date) -> Step {
        uploading = on && !ended && !gone
        return uploading ? take(t) : .none
    }

    // The IPA's serving ended (fetched, or the link expired); the hold stays for its grace, until over().
    mutating func end() { ended = true; uploading = false }

    // The grace is over, or Cancel: given back if still held, and never taken again.
    mutating func over(at t: Date) -> Step {
        gone = true
        return release(t)
    }

    // B437, B438: served, the hold was given back, and iOS hasn't asked: its prompt still waits for the app in front, or
    // for its answer.
    var asleep: Bool { !held && !requested && !ended && !gone }

    // When the hold is given back by the rule, nil while nothing says so.
    var releaseAt: Date? {
        guard held, !requested, !uploading else { return nil }
        return [dismissedAt, backgroundAt].compactMap { $0 }.min()?.addingTimeInterval(Self.quiet)
    }

    mutating func tick(at t: Date) -> Step {
        guard let due = releaseAt, t >= due else { return .none }
        return release(t)
    }

    // A freeze that began at `from` is iOS suspending the app after the hold was given back: expected, so the IPA isn't
    // uploaded for it. (A release that ran only once the app woke from a freeze doesn't count.)
    func slept(from: Date) -> Bool {
        guard let r = releasedAt, r <= from.addingTimeInterval(Self.beat) else { return false }
        return !held || takenAt > from
    }

    private mutating func take(_ t: Date) -> Step {
        guard !held, !ended, !gone else { return .none }
        held = true
        takenAt = t
        return .take
    }

    private mutating func release(_ t: Date) -> Step {
        guard held else { return .none }
        held = false
        releasedAt = t
        return .release
    }
}

// B437: when the page's hold (signing.hold) is given back while an install's prompt waits (PromptHold.asleep): alone
// (the only hold left, the app in the background) at every look for `quiet` s, which outlasts the page's gaps between
// one app's signing and the next.
struct PageYield {
    static let quiet: TimeInterval = 10
    static let poll: TimeInterval = 5
    private var since: Date?

    // One look; true: give it back.
    mutating func step(alone: Bool, at t: Date) -> Bool {
        guard alone else { since = nil; return false }
        if since == nil { since = t }
        guard let s = since, t.timeIntervalSince(s) >= Self.quiet else { return false }
        since = nil
        return true
    }
}
