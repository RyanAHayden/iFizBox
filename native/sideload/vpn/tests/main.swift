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
check(!C.begin(.run, vpnUp: true) && !C.begin(.check, vpnUp: true), "a given-up Shortcut may still go on")
check(C.report == nil && C.begin(.on, vpnUp: true), "a late end doesn't count; on begins")
C.opened(); C.finished()
check(C.report?.ok == true, "on ok")
check(C.begin(.run, vpnUp: true, now: Date() + C.settle + 1), "a run begins once it is over")

// a check's verdict: the actions decide; Shortcuts' callback is only told on
func v(opened: Bool = false, ended: Bool = false, _ elapsed: Double, front: Double = 0, _ said: String? = nil) -> C.Verdict {
    let r = C.Report(kind: .check, opened: opened, turns: ended ? 1 : 0, finished: ended)
    return C.verdict(r, elapsed: elapsed, front: front, said: said)
}
check(v(1) == .wait, "Shortcuts just opened")
check(v(30) == .wait, "waiting for Allow")
check(v(30, "an earlier run's error") == .wait, "an earlier run's error doesn't end it")
check(v(opened: true, ended: true, 2, front: 1, ("an earlier run's error")) == .ok, "nor fail it")
check(v(5, front: 3, nil) == .failed("not_run", nil), "Shortcuts' success without our actions is no success")
check(v(5, front: 3, "missing") == .failed("not_run", "missing"), "a missing Shortcut")
check(v(5, front: 2.9) == .wait, "just back")
check(v(opened: true, 5, front: 4) == .wait, "Open ran: still going")
check(v(opened: true, 15, front: 10) == .failed("no_end", nil), "Open ran, no end")
check(v(C.checkLimit) == .failed("no_return", nil), "nothing came back")
let u = C.runURL(.check) { "x://b?r=\($0)" }?.absoluteString ?? ""
check(u.hasPrefix("shortcuts://x-callback-url/run-shortcut?name=Cellular%20Installs&input=text&text=%7B%22check%22:1%7D&"), "link: \(u)")
let back = URLComponents(string: u)?.queryItems?.first { $0.name == "x-error" }?.value
check(back == "x://b?r=error", "callback link")
let two = C.runURL(.check) { "x://b?id=1&r=\($0)" }.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?.queryItems
check(two?.count == 6 && two?.first { $0.name == "x-error" }?.value == "x://b?id=1&r=error", "a callback link with two items stays one")

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
