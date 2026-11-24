// CellularShortcut's run state, on Linux (../test_vpn.py builds and runs it).
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String) {
    print("\(ok ? "ok  " : "FAIL") \(what)")
    if !ok { failures += 1 }
}
typealias C = CellularShortcut

// no run: the actions do nothing and no wait waits
C.opened(); C.waited(); C.finished()
check(C.report == nil && !C.waiting(), "no run: nothing waits")

check(!C.begin(.run, vpnUp: false) && C.report == nil, "no run before the VPN is up")
check(C.input(.check) == "{\"check\":1}", "input")
check(C.begin(.check, vpnUp: false), "check begins")
check(!C.begin(.run, vpnUp: true), "one run at a time")
C.finished()
check(C.report?.finished == false, "an end before Open is an earlier run's")
C.opened()
check(!C.waiting(), "a check doesn't wait")
C.waited(); C.finished()
check(C.report?.ok == true, "check ok")

check(C.begin(.run, vpnUp: true), "run begins after a finished one")
check(C.waiting(), "a run waits")
C.opened(); C.waited()
check(C.waiting(), "still waiting after a turn")
C.release()
check(!C.waiting(), "connected: the wait ends")
C.waited(); C.finished()
check(C.report?.ok == true && C.report?.turns == 2, "run ok")
C.waited()
check(C.report?.turns == 2, "nothing counts after the end")

check(C.begin(.run, vpnUp: true), "run")
C.opened()
for _ in 0..<C.waitTurns { C.waited() }
check(C.report?.ranOut == true && !C.waiting(), "the waits ran out")
let r = C.giveUp()
check(r?.opened == true && r?.finished == false && C.report == nil, "given up")
C.finished()
check(C.report == nil && C.begin(.on, vpnUp: true), "a late end doesn't count; on begins")
C.opened(); C.finished()
check(C.report?.ok == true, "on ok")

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
