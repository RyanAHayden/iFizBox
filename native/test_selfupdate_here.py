"""B159/B173: iFizBox's own update on the This iPhone route (Sideload.swift installHere, installd through the
built-in VPN, RemotePairing). iOS 17.4+ installd doesn't end the running copy: it waits until it is gone, so
installation_proxy's Complete never comes while iFizBox runs. So installHere feeds installd's copy and statuses to
HereClose (native/sign/SelfCloseClock.swift decides, tested in Swift by test_sideload.py): once installd accepted the
install (its first status) it answers the install call and closes iFizBox through CloseForUpdate.hereReady, with an
exit backstop off the main queue (B173: the close never fired). Checked as text: Sideload.swift only
builds with the iOS SDK."""
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


def block(src, start, end="\n    }\n"):
    s = src[src.index(start):]
    return s[:s.index(end)]


class HereSelfClose(unittest.TestCase):
    def setUp(self):
        self.side = read("Sources", "Sideload.swift")

    def test_install_here_reaches_close_for_update(self):
        here = block(self.side, "static func installHere")
        self.assertIn("let closer: HereClose? = isSelf ? HereClose(job: job, log: log)", here)
        self.assertIn("CloseForUpdate.hereReady()", here)
        self.assertIn("CloseForUpdate.hereBegan(app: app)", here)
        # the copy's end and installd's statuses drive it
        self.assertIn("if p >= 1 { closer?.copied() }", here)
        self.assertIn("closer?.installd(p)", here)
        # the call answers before iFizBox exits, a backstop exits whatever the main queue does, and a late installd
        # answer doesn't answer it twice
        fire = here[here.index("HereClose(job: job, log: log) {"):here.index("} : nil")]
        self.assertLess(fire.index("opened(.success((app, record)))"), fire.index("CloseForUpdate.hereReady()"))
        self.assertIn('CloseForUpdate.exitBackstop("This iPhone self-update")', fire)
        self.assertIn("IDevice.ilog(", fire)  # logged
        self.assertIn("if closer?.end() == true { return }", here)
        self.assertIn("CloseForUpdate.hereEnded()", here)

    def test_close_for_update_here_states(self):
        ready = block(self.side, "static func hereReady()")
        self.assertIn("guard state != .finished", ready)  # B173: no other state keeps iFizBox open
        self.assertIn("set(.finished)", ready)
        self.assertIn("closeWith(exitAfter: hereExit)", ready)  # B178: no notification
        began = block(self.side, "static func hereBegan(")
        self.assertIn("run += 1", began)  # an older hosted run's polls stop
        self.assertIn("set(.waiting)", began)
        ended = block(self.side, "static func hereEnded()")
        self.assertIn("sinks = sinks.filter { $0(nil) }", ended)  # signing.selfUpdate answers null
        close = block(self.side, "private static func closeWith")
        self.assertIn("exit(0)", close)
        self.assertIn("deadline: .now() + exitAfter", close)
        # B173: the exit doesn't hang on the notification's completion or the main queue (every route: the hosted
        # finish/guess close through closeWith too)
        self.assertIn("exitBackstop(", close)
        back = block(self.side, "static func exitBackstop(")
        self.assertIn("DispatchQueue.global(", back)
        self.assertIn("exit(0)", back)

    def test_close_within_a_couple_of_seconds(self):
        clock = read("sign", "SelfCloseClock.swift")
        self.assertIn("static let accepted: TimeInterval = 1", clock)
        self.assertIn("static let hereExit: TimeInterval = 2", self.side)

    def test_here_close_uses_the_clock_off_main(self):
        hc = self.side[self.side.index("final class HereClose"):]
        hc = hc[:hc.index("\n}\n")]
        self.assertIn("SelfCloseClock()", hc)
        self.assertIn("self.clock.due(Date())", hc)
        self.assertIn("self.job?.cancelled == true", hc)  # a cancelled job never closes iFizBox
        self.assertNotIn("DispatchQueue.main", hc)  # B173: its own queue
        self.assertIn("q.asyncAfter", hc)
        self.assertIn("installd accepted", hc)  # logged to the page and the device log
        self.assertIn("SelfCloseClock", read("sign", "SelfCloseClock.swift"))


if __name__ == "__main__":
    unittest.main()
