// RestoreDue on Linux (test_restoredue.py): when a look runs the back run, waits, or lets go.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

func check(_ ok: Bool, _ what: String) {
    if !ok { print("FAIL: \(what)"); exit(1) }
}
func step(_ f: (inout RestoreDue.Now) -> Void = { _ in }) -> RestoreDue.Step {
    var n = RestoreDue.Now()
    f(&n)
    return RestoreDue.step(n)
}

check(step() == .back, "ours down, in front throughout, online")
check(step { $0.front = false; $0.active = false } == .onReturn, "the app was left")
check(step { $0.active = false } == .later, "Control Center over the app")
check(step { $0.online = false } == .later, "Airplane Mode")
check(step { $0.waiting = true } == .later, "the next of the queue")
check(step { $0.waiting = true; $0.front = false } == .onReturn, "an install waits for the app")
check(step { $0.down = false } == .later, "still on, or in use")
check(step { $0.down = nil } == .later, "not read")
check(step { $0.otherVPN = true } == .drop, "back by itself")
check(step { $0.otherVPN = true; $0.front = false } == .drop, "back by itself, the app left")
check(step { $0.otherVPN = true; $0.down = nil } == .later, "another VPN's address, ours not read")
check(step { $0.replaced = true } == .drop, "another VPN was picked since")

// left or killed with it owed: only after an answer
check(step { $0.left = true } == .ask, "back in front after it was left, or opened after a kill")
check(step { $0.left = true; $0.front = false; $0.active = false } == .onReturn, "still away")
check(step { $0.left = true; $0.active = false } == .later, "not asked under Control Center")
check(step { $0.left = true; $0.online = false } == .later, "not asked in Airplane Mode")
check(step { $0.left = true; $0.waiting = true } == .later, "an install began while it waits")
check(step { $0.left = true; $0.down = false } == .later, "ours is on again")
check(step { $0.left = true; $0.otherVPN = true } == .drop, "back by itself, unasked")
check(step { $0.left = true; $0.replaced = true } == .drop, "another VPN was picked, unasked")
check(!RestoreDue.leftOnTrip(8) && RestoreDue.leftOnTrip(60) && RestoreDue.leftOnTrip(-5), "a Cellular Installs trip, and one gone on from")
// never
check(step { $0.left = true; $0.never = true } == .drop, "never: no question")
check(step { $0.left = true; $0.never = true; $0.front = false } == .drop, "never: left")
check(step { $0.left = true; $0.never = true; $0.waiting = true } == .drop, "never: left during the queue")
check(step { $0.never = true } == .back, "never: right after an install it runs")
// the answers
check(RestoreDue.outcome(.on, .ask) == .run, "on")
check(RestoreDue.outcome(.on, .later) == .approve, "on, an install going on")
check(RestoreDue.outcome(.on, .drop) == .drop, "on, back by itself meanwhile")
check(RestoreDue.outcome(.on, .onReturn) == .keep, "on, left again")
for s in [RestoreDue.Step.ask, .later, .onReturn, .drop] {
    check(RestoreDue.outcome(.notNow, s) == .drop, "not now: \(s)")
    check(RestoreDue.outcome(.never, s) == .drop, "never: \(s)")
}
check(["on", "notNow", "never"].allSatisfy { RestoreDue.Answer(rawValue: $0) != nil } && RestoreDue.Answer(rawValue: "x") == nil, "the page's words")
check(!RestoreDue.Now().going, "nothing goes on")
for n in [RestoreDue.Now(waiting: true), RestoreDue.Now(down: false)] { check(n.going, "the question is withdrawn") }
check(!RestoreDue.Now(active: false, online: false, down: nil).going, "not under a menu")

check(RestoreDue.stillDue("busy", active: true), "busy")
check(RestoreDue.stillDue("vpn_on", active: true), "a start came in between")
check(RestoreDue.stillDue("not_opened", active: false), "left as it was about to open")
check(!RestoreDue.stillDue("not_opened", active: true), "no Shortcuts on the phone: not over and over")
for e in [nil, "on_already", "not_run", "not_stored", "not_back", "no_return"] {
    check(!RestoreDue.stillDue(e, active: true), "once per queue: \(e ?? "ok")")
}
print("ok")
