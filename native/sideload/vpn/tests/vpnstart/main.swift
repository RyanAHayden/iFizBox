// VPNStart on Linux (native/test_localvpn.py): when a start is given up, and that it is tried once more.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

func check(_ ok: Bool, _ what: String) {
    if !ok { print("FAIL: \(what)"); exit(1) }
}
struct Cancel: Error {}

/// A start whose status follows `states` (from when, state), on a clock that moves only as it sleeps.
func run(_ states: [(TimeInterval, VPNStart.State)], attempt: Int = 1, cancelAt: TimeInterval? = nil) throws -> (stall: VPNStart.Stall?, took: TimeInterval, steps: Int) {
    var t: TimeInterval = 0, steps = 0
    let zero = Date(timeIntervalSince1970: 0)
    let stall = try VPNStart.watch(limit: 10, quiet: VPNStart.quiet(attempt, limit: 10), state: { states.last { $0.0 <= t }!.1 },
                                   clock: { zero + t }, sleep: { t += $0 }) {
        steps += 1
        if let c = cancelAt, t >= c { throw Cancel() }
    }
    return (stall, t, steps)
}

var r = try run([(0, .off), (0.1, .starting), (0.4, .on)])
check(r.stall == nil && r.took < 0.6, "connects")
r = try run([(0, .off)])
check(r.stall == .neverBegan && r.took > 2.9 && r.took < 3.2, "never left off: a few seconds")
r = try run([(0, .off)], attempt: 2)
check(r.stall == .neverBegan && r.took > 9.9 && r.took < 10.2, "the second start has the whole limit")
r = try run([(0, .off), (5, .starting), (6, .on)], attempt: 2)
check(r.stall == nil, "a slow second start")
r = try run([(0, .starting)])
check(r.stall == .timeout && r.took > 9.9 && r.took < 10.2, "stuck connecting")
check(r.steps >= 8 && r.steps <= 10, "says it is alive about every second: \(r.steps)")
r = try run([(0, .starting), (6, .on)])
check(r.stall == nil, "a slow first start is left alone")
r = try run([(0, .off), (0.1, .starting), (0.5, .off)])
check(r.stall == .turnedOff && r.took < 0.7, "turned off as it started")
r = try run([(0, .other), (1, .off), (4, .starting), (5, .on)])
check(r.stall == .neverBegan, "down first, then nothing")
do {
    _ = try run([(0, .starting)], cancelAt: 2)
    check(false, "Cancel ends the wait")
} catch is Cancel {}

func twice(_ stalls: [VPNStart.Stall?], again: Bool = true) -> (VPNStart.Stall?, Int) {
    var n = 0
    let s = VPNStart.twice({ i in n += 1; check(i == n, "attempts count"); return stalls[i - 1] }, again: { _ in again })
    return (s, n)
}
check(twice([nil]) == (nil, 1), "connected at once")
for s in [VPNStart.Stall.neverBegan, .turnedOff, .timeout] {
    check(twice([s, nil]) == (nil, 2), "\(s): the second start connects")
    check(twice([s, s]) == (s, 2), "\(s): twice at most")
    check(twice([s], again: false) == (s, 1), "\(s): not again in the background")
}
var starts = 0
do {
    _ = try VPNStart.twice({ _ in starts += 1; return .timeout }, again: { _ in throw Cancel() })
    check(false, "cancelled, or no network, between the two")
} catch is Cancel {}
check(starts == 1, "no second start then")
starts = 0
do {
    _ = try VPNStart.twice({ _ in starts += 1; throw Cancel() }, again: { _ in true })
    check(false, "a refused configuration")
} catch is Cancel {}
check(starts == 1, "a refused configuration isn't asked again")
