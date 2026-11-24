// RestoreShortcut's run state, on Linux (../../test_restoreshortcut.py builds and runs it).
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String) {
    print("\(ok ? "ok  " : "FAIL") \(what)")
    if !ok { failures += 1 }
}
typealias R = RestoreShortcut
func v(_ elapsed: TimeInterval, _ front: TimeInterval = 0, other: Bool = false, _ said: String? = nil) -> R.Verdict {
    R.verdict(R.report, elapsed: elapsed, front: front, otherVPN: other, said: said)
}

// no run: the actions do nothing
R.remembered(); R.restoring(); R.finished()
check(R.report == nil, "no run: nothing counts")
check(R.input(.store) == "{\"store\":1}", "input")

// what begins
check(R.begin(.store, vpnUp: false, otherVPN: false) == "no_vpn", "nothing to remember")
check(R.begin(.store, vpnUp: true, otherVPN: true) == "vpn_on", "ours would be remembered")
check(R.begin(.back, vpnUp: true, otherVPN: false) == "vpn_on", "ours is in use")
check(R.report == nil, "a refused run isn't going on")

// store
check(R.begin(.store, vpnUp: false, otherVPN: true) == nil, "store begins")
check(R.begin(.check, vpnUp: false, otherVPN: true) == "busy", "one run at a time")
check(v(30) == .wait, "the first run waits for Allow")
R.restoring()
check(R.report?.restoring == false, "a back run's action doesn't count for store")
check(v(5, 3, "missing") == .failed("not_run", "missing"), "a missing Shortcut")
check(v(60) == .failed("no_return", nil), "never back")
R.remembered()
check(v(5, 5) == .wait, "remembered, the end is to come")
check(v(20, 10, "x") == .failed("no_end", "x"), "no end")
R.finished()
check(v(5, 5, "stale error") == .ok, "remembered; the callback's error doesn't count")
check(R.end()?.remembered == true && R.report == nil, "ended")
check(R.begin(.store, vpnUp: false, otherVPN: true) == nil, "the next begins at once after a finished run")
R.finished(); R.remembered()
check(v(1) == .failed("no_vpn", nil), "Shortcuts found no current VPN; nothing counts after the end")
R.end()

// back
check(R.begin(.back, vpnUp: false, otherVPN: false) == nil, "back begins")
R.remembered()
check(R.report?.remembered == false, "a store run's action doesn't count for back")
check(v(60, 2) == .wait, "back in front after a minute: its actions still get their time")
check(v(1, 1, other: true) == .ok, "the VPN decides, also when an action's report is lost")
R.restoring()
check(v(1) == .wait && v(5, 9, "error 2") == .wait, "error 2 alone decides nothing")
check(v(1, 1, other: true, "error 2") == .ok, "error 2 after the VPN switched is a success")
check(v(5, 10, "error 2") == .failed("not_back", "error 2"), "the VPN isn't back")
check(v(60) == .failed("no_return", nil), "behind the VPN not found alert")
check(v(70, 2) == .wait, "back in front after a long alert: the VPN still gets its time")
let t = Date()
check(R.end(now: t)?.finished == false, "ended before its Shortcut did")
R.finished()
check(R.report == nil, "a late end doesn't count")
check(R.begin(.back, vpnUp: false, otherVPN: false, now: t + 1) == "busy", "it may still report")
check(R.begin(.back, vpnUp: false, otherVPN: false, now: t + R.settle) == nil, "the next begins once it is over")
R.finished()
check(v(1) == .failed("not_stored", nil), "nothing kept yet")
R.end()
check(R.begin(.back, vpnUp: false, otherVPN: true) == "on_already", "nothing to bring back")
check(R.begin(.back, vpnUp: false, otherVPN: false) == nil, "back")
R.restoring(); R.finished()
check(v(1) == .wait && v(5, 10) == .failed("not_back", nil), "the end without the VPN is no success")
check(v(1, 0, other: true) == .ok, "the end with it is")
R.end()

// check
check(R.begin(.check, vpnUp: true, otherVPN: false) == nil, "check begins whatever is on")
check(v(5, 3, nil) == .failed("not_run", nil), "Shortcuts' success without our actions is no success")
R.finished()
check(v(1) == .ok, "check ok")
R.end()

let u = R.runURL(.back, back: { "ifizbox://restore-vpn?id=1&r=\($0)" })?.absoluteString ?? ""
check(u.hasPrefix("shortcuts://x-callback-url/run-shortcut?name=Restore%20My%20VPN&input=text&text=%7B%22back%22:1%7D&"), "link: \(u)")
check(u.contains("x-success=ifizbox://restore-vpn?id%3D1%26r%3Dok&x-error="), "callbacks: \(u)")

exit(failures == 0 ? 0 : 1)
