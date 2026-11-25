// B435: PromptHold (native/sign/PromptHold.swift), run by native/test_prompt_hold.py.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

var failed = 0
func check(_ name: String, _ ok: Bool) {
    print((ok ? "ok   " : "FAIL ") + name)
    if !ok { failed += 1 }
}
let t0 = Date(timeIntervalSince1970: 1_000_000)
func at(_ s: TimeInterval) -> Date { t0.addingTimeInterval(s) }

// A rule with its steps counted, as KeepAlive would.
struct Run {
    var rule = PromptHold()
    var takes = 0, releases = 0
    init(background: Bool = false) { step { $0.start(at: at(0), background: background) } }
    mutating func step(_ f: (inout PromptHold) -> PromptHold.Step) {
        switch f(&rule) {
        case .take: takes += 1
        case .release: releases += 1
        case .none: break
        }
    }
    mutating func opened(_ s: TimeInterval) { step { $0.opened(at: at(s)) } }
    mutating func request(_ s: TimeInterval) { step { $0.request(at: at(s)) } }
    mutating func tick(_ s: TimeInterval) { step { $0.tick(at: at(s)) } }
    mutating func upload(_ on: Bool, _ s: TimeInterval) { step { $0.upload(on, at: at(s)) } }
    mutating func over(_ s: TimeInterval) { step { $0.over(at: at(s)) } }
    var counts: [Int] { [takes, releases] }
}

var r = Run()
r.opened(0); r.tick(890)
check("a prompt left up in front keeps the hold", r.rule.held && r.rule.releaseAt == nil && r.counts == [1, 0])

r = Run(); r.opened(0); r.rule.dismissed(at: at(10)); r.tick(69)
check("held for a minute after the dismissal", r.rule.held && r.rule.releaseAt == at(70))
r.rule.background(at: at(30)); r.tick(70)
check("dismissed: given back 60 s later", !r.rule.held && r.counts == [1, 1])
r.tick(200); r.over(900); r.over(901)
check("given back once, the expiry too", r.counts == [1, 1])

r = Run(); r.opened(0); r.rule.background(at: at(5)); r.tick(64)
check("background: held for a minute", r.rule.held)
r.tick(65)
check("background: given back 60 s later", r.counts == [1, 1])

r = Run(); r.opened(0); r.rule.background(at: at(5)); r.rule.foreground(); r.tick(100)
check("back in front in time: no release", r.rule.held)

r = Run(background: true); r.tick(60)
check("never opened, in the background: given back", r.counts == [1, 1])
r.rule.foreground(); r.opened(300)
check("its first open takes it", r.rule.held && r.counts == [2, 1])

r = Run(); r.opened(0); r.rule.dismissed(at: at(10)); r.opened(40); r.tick(70)
check("Try Again before the minute keeps it", r.rule.held && r.counts == [1, 0])
r.rule.dismissed(at: at(80)); r.tick(140); r.opened(300)
check("Try Again after it takes it again", r.rule.held && r.counts == [2, 1])
r.request(305); r.rule.background(at: at(306)); r.tick(900)
check("a download under way keeps it", r.rule.held && r.rule.releaseAt == nil)
r.rule.end(); r.tick(950); r.over(1020)
check("served: given back after the grace", r.counts == [2, 2])
r.request(1030); r.opened(1031); r.upload(true, 1032)
check("never taken again", !r.rule.held && r.counts == [2, 2])

r = Run(); r.opened(0); r.rule.dismissed(at: at(1)); r.tick(61); r.request(62); r.tick(900)
check("iOS's first request takes it again", r.rule.held && r.counts == [2, 1])

r = Run(); r.opened(0); r.rule.dismissed(at: at(1)); r.tick(61); r.rule.end(); r.request(62); r.over(1000)
check("a request after the end takes nothing", r.counts == [1, 1])

r = Run(); r.request(1); r.over(2); r.request(3)
check("Cancel mid-download gives it back at once", r.counts == [1, 1])
r = Run(); r.over(2); r.opened(3)
check("Cancel before the open", r.counts == [1, 1])

r = Run(); r.opened(0); r.rule.background(at: at(1)); r.upload(true, 20); r.tick(61)
check("an upload under way keeps it", r.rule.held)
r.upload(false, 80); r.tick(80)
check("the upload over, the minute past: given back", r.counts == [1, 1])

r = Run(); r.opened(0); r.rule.background(at: at(1)); r.tick(61)
check("suspended after the release: expected", r.rule.slept(from: at(90)) && r.rule.slept(from: at(60)))
r.opened(400)
check("still expected once Try Again took it", r.rule.slept(from: at(90)))
check("a freeze after that isn't", !r.rule.slept(from: at(410)))
r = Run(); r.opened(0); r.rule.background(at: at(1))
check("frozen while held isn't", !r.rule.slept(from: at(20)))
r.tick(600)
check("nor when the release ran after waking", !r.rule.slept(from: at(20)))

r = Run(background: true)
check("B437: its prompt waits for the app in front", r.rule.unopened)
r.tick(60)
check("B437: still, once the hold was given back", r.rule.unopened && !r.rule.held)
r.opened(300)
check("B437: not once the link was handed over", !r.rule.unopened && r.rule.held)
r = Run(background: true); r.tick(60); r.over(70)
check("B437: nor after Cancel", !r.rule.unopened)
r = Run(background: true); r.tick(60); r.rule.end()
check("B437: nor after the expiry", !r.rule.unopened)

var y = PageYield()
check("the page's hold stays for now", !y.step(alone: true, at: at(0)) && !y.step(alone: true, at: at(5)))
check("the page's hold goes after 10 s alone", y.step(alone: true, at: at(10)))
check("given back once", !y.step(alone: true, at: at(15)))
y = PageYield()
_ = y.step(alone: true, at: at(0))
check("another hold starts the wait again",
      !y.step(alone: false, at: at(5)) && !y.step(alone: true, at: at(10)) && y.step(alone: true, at: at(20)))

if failed > 0 { print("\(failed) failed"); exit(1) }
print("all passed")
