"""F419: Restore My VPN after a queue: the rules (RestoreDue.swift) run on Linux, what carries them out read as text."""
import os
import re
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))

sys.path.insert(0, NATIVE)

import disktmp  # noqa: E402
from test_sign import toolchain  # noqa: E402

SWIFTC = toolchain()


def read(*p, base=HERE):
    with open(os.path.join(base, *p)) as f:
        return f.read()


class Due(unittest.TestCase):
    def setUp(self):
        self.src = read("App", "RestoreBack.swift")

    def part(self, start, end="\n    }\n"):
        i = self.src.index(start)
        return self.src[i:self.src.index(end, i)]

    def assertOrder(self, text, steps):
        self.assertEqual(sorted(steps, key=text.index), steps)

    def test_nothing_without_another_vpn(self):
        note = self.part("static func note()")
        self.assertOrder(note, ["guard LocalVPN.restore, !owed || held, LocalVPN.otherVPNUp()", "guard remembered", "setLeft(", "owed = true"])

    def test_once_per_queue(self):
        """Cleared before Shortcuts opens, with no start in between; due again only when Shortcuts wasn't opened."""
        back = self.part("case .back:", "private static func done()")
        self.assertOrder(back, ["LocalVPN.withNoStart", "RestoreDue.step(now()) == .back", "run().due"])
        run = self.part("private static func run()")
        self.assertOrder(run, ["owed = false", "RestoreShortcutBridge.back()", "RestoreDue.stillDue(", "owed = true"])
        drop = self.part("case .drop:", "case .onReturn:")
        self.assertOrder(drop, ["LocalVPN.withNoStart", "RestoreDue.step(now()) == .drop", "owed = false"])
        look = self.part("static func look()")
        self.assertIn("looking = true", look)
        self.assertIn("contentsOf: owedFile", self.part("private static var owed", "/// A store run"))  # a killed app's, at its next launch
        self.assertIn("LocalVPN.takeDownLeftOver()", read("App", "LocalVPN.swift").split("enum LocalVPNBridge")[1])

    def test_asks_once_left(self):
        """F427: owed at launch counts as left, as does the background (not a Cellular Installs trip); the answers."""
        self.assertIn("private static var left = true", self.src)
        self.assertOrder(self.part("static func watch()"), ["didEnterBackgroundNotification", "if away() { setLeft(true) }"])
        self.assertIn("{ !CellularShortcut.running }", self.src)  # a finished run's report stays
        self.assertIn("RestoreBack.watch()", read("App", "LocalVPN.swift").split("enum LocalVPNBridge")[1])
        self.assertNotIn("run()", self.part("case .ask:", "case .back:"))
        answer = self.part("static func answer(")
        self.assertOrder(answer, ["forKey: neverKey", "LocalVPN.withNoStart", "guard owed, held, LocalVPN.restore", "RestoreDue.outcome("])
        self.assertEqual(self.src.count("run()"), 4)  # its own, right after the queue, before the close, and the answer's
        self.assertIn("forKey: neverKey", self.part("static func forget()"))
        self.assertIn('"restoreNever": RestoreBack.never', read("App", "LocalVPN.swift"))

    def test_remembered(self):
        src = read("App", "RestoreShortcutBridge.swift")
        self.assertIn("if k == .store { RestoreBack.stored() }", src)
        self.assertIn('if code == "not_stored" { RestoreBack.notStored() }', src)
        self.assertIn('refusal == nil ? run(.back) : ("unavailable", nil)', src)

    @unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): RestoreDue.swift not tested")
    def test_rules(self):
        tmp = disktmp.build_dir("ifizbox-restoreduetest-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        env = disktmp.swift_env(dict(os.environ), tmp)
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(os.path.join(tmp, "libshim"))
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(tmp, "libshim", "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = os.path.join(tmp, "libshim") + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        binary = os.path.join(tmp, "restoreduetest")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(tmp, "modules"), os.path.join(HERE, "App", "RestoreDue.swift"),
                            os.path.join(HERE, "tests", "restoredue", "main.swift"), "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-4000:])
        r = subprocess.run([binary], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
