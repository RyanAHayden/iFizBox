// B246: the This iPhone route (IDevice.install) when the connection to iOS drops mid-install. Leaving the app during
// a big install over Tailscale (user 2026-11-20, a 383.7 MB IPA) ended with "install_failed: Socket(Kind(
// UnexpectedEof)) (1)" while iOS went on and installed the app. A dropped connection is not iOS refusing the app:
// the install connects again, finishes the copy from where iOS's file ends, and once the install was sent asks iOS
// for the app (installation_proxy Browse) instead of calling it failed. Only installd's own error fails.
// Pure, no UIKit or idevice: native/sign/tests/sideload/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum HereRecheck {
    /// How often one install connects again after a drop, and the pause before each try (the tunnel or the
    /// Tailscale node coming back after the app returns to the front).
    static let reconnects = 4
    static func pause(_ attempt: Int) -> TimeInterval { [2, 4, 8, 15][min(max(attempt, 1), 4) - 1] }
    /// How long to keep asking iOS for the app after a drop, and how often.
    static let askFor: TimeInterval = 180
    static let askEvery: TimeInterval = 3
    /// `cannotTell` (this version listed, nothing to tell it from the earlier copy) counts as installed only once it
    /// has held this long: installd replacing the copy changes the folder or version well within it.
    static let settle: TimeInterval = 30

    /// idevice error codes for a connection that went away, not an answer from iOS: Socket (1, UnexpectedEof, reset,
    /// refused), SessionInactive (17), NoEstablishedConnection (19), CdTunnel (101), RemotePairing (103),
    /// Timeout (109). installd's refusals come as other codes (InstallationProxy 107, ApplicationVerificationFailed
    /// 203, UnexpectedResponse 13, …).
    static let droppedCodes: Set<Int32> = [1, 17, 19, 101, 103, 109]

    /// `code` is IDevice.Failure's prefix, `lib` idevice's error code when the failure came from idevice. The
    /// watchdog's "timeout" (a step went quiet and the tunnel was closed) is a drop too.
    static func isDropped(code: String, lib: Int32?) -> Bool {
        code == "timeout" || lib.map { droppedCodes.contains($0) } == true
    }

    /// Whether install() connects again after this failure. A drop always; once it is already connecting again, a
    /// connect that fails too (the route still coming back: Tailscale's VPN reconnecting refused or timed out the
    /// connect on the iPhone 15 Pro) is tried again as well, up to `reconnects`. A refused or rejected pairing never.
    static func shouldReconnect(code: String, lib: Int32?, reconnecting: Bool) -> Bool {
        isDropped(code: code, lib: lib) || (reconnecting && code == "connect_failed")
    }

    /// What iOS lists for the app (installation_proxy Browse).
    struct AppState: Equatable {
        var path: String?          // the app's bundle folder; a new install gets a new one
        var version: String?       // CFBundleVersion
        var shortVersion: String?  // CFBundleShortVersionString

        /// The signed app's version is its CFBundleShortVersionString, else its CFBundleVersion: the same order here,
        /// so an old build number never reads as the new version.
        func has(_ v: String) -> Bool { (shortVersion ?? version) == v }
    }

    /// What iOS listed before the install started.
    enum Before: Equatable { case unknown, absent, present(AppState) }

    enum Verdict: Equatable {
        case installed    // iOS lists the new copy
        case notYet       // not listed, or listed with another version: installd may still be at it
        case sameAsBefore // listed exactly as before the install: the new copy hasn't replaced it (yet)
        case cannotTell   // listed with this version, and nothing tells it from what was there before
    }

    /// Whether iOS has the copy being installed: `version` is the signed app's, `now` what iOS lists now (nil: no
    /// such app).
    static func verdict(version: String, before: Before, now: AppState?) -> Verdict {
        guard let now = now, now.has(version) else { return .notYet }
        switch before {
        case .absent: return .installed
        case .unknown: return .cannotTell
        case .present(let old):
            if !old.has(version) { return .installed }
            if let a = old.path, let b = now.path { return a == b ? .sameAsBefore : .installed }
            return .cannotTell
        }
    }

    /// B251: while installd's step is quiet, a second look. A connection that dropped after "iOS is installing it" was
    /// only noticed when installd's long quiet limit ran out (180 s, kept for a big app installd is still verifying).
    /// After `lookAfter` of quiet, and every `lookEvery` while it stays quiet, a second connection asks
    /// installation_proxy for the app; when iOS lists the new copy, the install is done. A look that can't reach iOS
    /// or doesn't find the copy changes nothing: the long limit still decides. Times are the step's quiet seconds.
    static let lookAfter: TimeInterval = 30
    static let lookEvery: TimeInterval = 30

    struct SecondLook {
        private(set) var lastAt: TimeInterval? // the quiet time of the last look

        /// Whether to look now, at `quiet` seconds of quiet (and if so, counts it as the look's time). The step
        /// moving (quiet below the last look's) starts over.
        mutating func due(quiet: TimeInterval) -> Bool {
            if let l = lastAt, quiet < l { lastAt = nil }
            guard quiet >= HereRecheck.lookAfter else { return false }
            if let l = lastAt, quiet - l < HereRecheck.lookEvery { return false }
            lastAt = quiet
            return true
        }

        /// Whether what a look found (nil: it couldn't ask iOS) ends the wait: only the new copy listed. Unlike after a
        /// drop, `cannotTell` never counts here: the first connection may be alive with installd still verifying, and
        /// the copy that was there already matches (a reinstall of the same version), so the long limit decides.
        static func ends(_ v: Verdict?) -> Bool { v == .installed }
    }

    /// Where to carry on copying after a drop: iOS's file size, never past what was sent, down to a whole chunk so a
    /// chunk cut off mid-write is sent again.
    static func resumeAt(remoteSize: Int, sent: Int, chunk: Int) -> Int {
        let have = max(0, min(remoteSize, sent))
        return chunk > 0 ? have / chunk * chunk : have
    }

    /// B292: the copy's quiet limit, from how fast chunks have been landing. Over Tailscale the path between the app's
    /// node and the phone's can drop mid-copy (R53 run 2: the phone's node fell back to DERP, handshakes went
    /// unanswered, AFC stalled): with chunks landing every fraction of a second, waiting the full `ceiling` (30 s)
    /// before reconnecting loses most of a minute. Once `warmup` chunks have landed, the limit is `factor` times the
    /// slowest of the last `window` gaps between chunks, never under `floor` nor over `ceiling`: a fast copy that
    /// stops is a drop after `floor`; a slow route (DERP, a weak network) keeps a limit that fits its pace. installd's
    /// own long limit is not this one.
    struct CopyQuiet {
        static let floor: TimeInterval = 8
        static let ceiling: TimeInterval = 30
        static let factor: Double = 4
        static let window = 16
        static let warmup = 4

        private(set) var gaps: [TimeInterval] = []
        private(set) var landed = 0

        /// A chunk landed `gap` seconds after the one before it (or after the copy started). After the app was
        /// suspended, start a new CopyQuiet: a gap that spans the suspension is not the route's pace, and the watchdog
        /// may notice the suspension only after that chunk has been added.
        mutating func add(_ gap: TimeInterval) {
            landed += 1
            guard gap >= 0 else { return }
            gaps.append(gap)
            if gaps.count > Self.window { gaps.removeFirst(gaps.count - Self.window) }
        }

        /// The quiet limit for the next chunk.
        var limit: TimeInterval {
            guard landed >= Self.warmup, let slowest = gaps.max() else { return Self.ceiling }
            return min(Self.ceiling, max(Self.floor, slowest * Self.factor))
        }
    }

    /// "18.2 MB/s in front, 14.2 MB/s in the background, 42 s waiting for the connection", for the log.
    /// B293: only the time a chunk was moving counts toward a speed. `gap` is the time since the chunk before it
    /// landed, across a drop and its reconnect (the first chunk after a reconnect carries the stall, the pauses and
    /// the new connection). Once `warmup` chunks have landed, a gap over `stallFactor` times the median of the last
    /// `window` moving gaps (never under `stallFloor`) is a stall: a chunk that took 15 s with the VPN off moved for
    /// the median's time and waited the rest. Time the app was suspended counts as waiting too.
    struct CopySpeed {
        static let stallFloor: TimeInterval = 1
        static let stallFactor: Double = 4
        static let window = 16
        static let warmup = 4

        private(set) var frontBytes = 0, backBytes = 0
        private(set) var frontSecs: TimeInterval = 0, backSecs: TimeInterval = 0
        private(set) var waitSecs: TimeInterval = 0
        private(set) var paces: [TimeInterval] = []
        private(set) var landed = 0

        /// A normal chunk's time: the median of the last moving gaps (nil: no pace yet).
        var pace: TimeInterval? {
            guard landed >= Self.warmup, !paces.isEmpty else { return nil }
            let s = paces.sorted()
            return s[s.count / 2]
        }

        /// How long a chunk may take before it counts as stalled (nil: no pace yet).
        var stallAfter: TimeInterval? { pace.map { max(Self.stallFloor, $0 * Self.stallFactor) } }

        mutating func add(_ bytes: Int, _ gap: TimeInterval, front: Bool) {
            let gap = max(0, gap)
            var moving = gap
            // a stalled chunk moved for a normal chunk's time and waited the rest
            if let cap = stallAfter, let p = pace, gap > cap { moving = p; waitSecs += gap - p }
            landed += 1
            paces.append(moving)
            if paces.count > Self.window { paces.removeFirst(paces.count - Self.window) }
            if front { frontBytes += bytes; frontSecs += moving } else { backBytes += bytes; backSecs += moving }
        }

        static func rate(_ b: Int, _ s: TimeInterval) -> String {
            String(format: "%.1f MB/s", Double(b) / 1_048_576 / max(s, 0.001))
        }

        var summary: String {
            var parts: [String] = []
            if frontBytes > 0 { parts.append("\(Self.rate(frontBytes, frontSecs)) in front") }
            if backBytes > 0 { parts.append("\(Self.rate(backBytes, backSecs)) in the background") }
            let wait = Int(waitSecs.rounded())
            if wait > 0 { parts.append("\(wait) s waiting for the connection") }
            return parts.joined(separator: ", ")
        }
    }
}
