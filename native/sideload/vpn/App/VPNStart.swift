// One start of the built-in VPN, and once more after a stall (B443): LocalVPN.start() starts it, this watches the status.
// Foundation only: ../tests/vpnstart/main.swift tests it on Linux.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum VPNStart {
    /// NEVPNStatus, as far as a start needs it. other: on its way down.
    enum State: String { case off, starting, on, other }

    /// How a start ended without connecting. neverBegan: the status never left off.
    enum Stall: String { case neverBegan = "never began", turnedOff = "turned off as it started", timeout = "didn't connect" }

    /// quiet: how long the first start may stay off. The second has the whole limit.
    static func quiet(_ attempt: Int, limit: TimeInterval) -> TimeInterval { attempt == 1 ? min(3, limit) : limit }

    /// Blocking: nil once connected, else how it stalled. `step` runs about once a second and throws to cancel.
    static func watch(limit: TimeInterval, quiet: TimeInterval, state: () -> State, clock: () -> Date = { Date() },
                      sleep: (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) }, step: () throws -> Void) throws -> Stall? {
        let t0 = clock()
        var began = false, stepped = t0
        while true {
            let s = state(), t = clock().timeIntervalSince(t0)
            switch s {
            case .on: return nil
            case .starting: began = true
            case .off:
                if began { return .turnedOff }
                if t >= quiet { return .neverBegan }
            case .other: break
            }
            if t >= limit { return .timeout }
            if clock().timeIntervalSince(stepped) >= 1 {
                try step()
                stepped = clock()
            }
            sleep(0.05)
        }
    }

    /// `attempt` (1, then 2 after a stall that `again` lets through) starts and watches: the last stall, nil once connected.
    /// What either throws (cancelled, no network, a refused configuration) ends it.
    static func twice(_ attempt: (Int) throws -> Stall?, again: (Stall) throws -> Bool) rethrows -> Stall? {
        guard let first = try attempt(1) else { return nil }
        guard try again(first) else { return first }
        return try attempt(2)
    }
}
