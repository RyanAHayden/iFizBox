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

check(step() == .back, "ours down, in front, online")
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

check(RestoreDue.stillDue("busy", active: true), "busy")
check(RestoreDue.stillDue("vpn_on", active: true), "a start came in between")
check(RestoreDue.stillDue("not_opened", active: false), "left as it was about to open")
check(!RestoreDue.stillDue("not_opened", active: true), "no Shortcuts on the phone: not over and over")
for e in [nil, "on_already", "not_run", "not_stored", "not_back", "no_return"] {
    check(!RestoreDue.stillDue(e, active: true), "once per queue: \(e ?? "ok")")
}
print("ok")
