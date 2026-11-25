"""B435: the KeepAlive hold of an install whose prompt was cancelled or never tapped (native/sign/PromptHold.swift).
native/tests/prompthold/main.swift is built with it alone by the Swift toolchain, as test_urlencode.py does; the
wiring in InstallPrompt.swift and Sideload.swift is checked as text. Without a Swift toolchain the Swift part skips."""
import os
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_sign import toolchain  # noqa: E402
import disktmp  # noqa: E402

SWIFTC = toolchain()


@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/sign/PromptHold.swift not tested")
class SwiftPromptHold(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-promptholdtest-")  # off the shared /tmp tmpfs: see native/disktmp.py
        binary = os.path.join(cls.tmp, "promptholdtest")
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            os.path.join(HERE, "sign", "PromptHold.swift"),
                            os.path.join(HERE, "tests", "prompthold", "main.swift"),
                            "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        cls.out = None if cls.build_error else subprocess.run([binary], capture_output=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        self.assertIn("all passed", self.out.stdout)


def read(name):
    with open(os.path.join(HERE, "Sources", name)) as f:
        return f.read()


def body(src, start, end):
    i = src.index(start)
    return src[i:src.index(end, i)]


class Wiring(unittest.TestCase):
    def test_serving_goes_through_the_hold(self):
        serve = body(read("Sideload.swift"), "private static func serveChecked(", "\n    }\n\n")
        self.assertNotIn("KeepAlive.shared", serve)  # the Awake takes and gives back, once each
        self.assertEqual(serve.count("hold.start()"), 1)
        self.assertEqual(serve.count("hold.over()"), 2)  # after the grace, and on Cancel
        self.assertIn("if hold.slept(from: f.from)", serve)  # our own sleep uploads nothing
        self.assertIn("InstallPrompt.heard(bid, hold: hold)", serve)
        # the expiry's own line isn't iOS asking for the IPA
        self.assertNotIn('serverLog("iOS didn\'t fetch', serve)

    def test_upload_keeps_the_hold(self):
        host = body(read("Sideload.swift"), "static func hostAfterFreeze(", "\n    }\n\n")
        self.assertLess(host.index("state.hold.uploading(true)"), host.index("state.hold.uploading(false)"))

    def test_prompt_feeds_the_hold(self):
        prompt = read("InstallPrompt.swift")
        self.assertIn("e.hold.opened()", body(prompt, "private static func attempt(", "\n    }\n"))
        self.assertIn("e.hold.dismissed()", body(prompt, "private static func observe(", "\n    }\n\n"))
        heard = body(prompt, "static func heard(", "\n    }\n")
        self.assertIn("hold.requested()", heard)
        self.assertIn("e.hold === hold", heard)  # an earlier install of the same app leaves this one alone
        self.assertIn("e.hold.opened()", body(prompt, "static func reprompt(", "\n    }\n"))
        awake = prompt[prompt.index("final class Awake"):]
        self.assertEqual(awake.count("KeepAlive.shared.begin()"), 1)
        self.assertEqual(awake.count("KeepAlive.shared.end()"), 1)
        self.assertIn("asyncAfter(wallDeadline:", awake)

    def test_callers_hold_ends_with_serving(self):  # B437: the answer waits for the app in front
        side = read("Sideload.swift")
        serve = body(side, "private static func serveChecked(", "\n    }\n\n")
        self.assertLess(serve.index("hold.start()"), serve.index("serving?()"))
        install = body(side, "static func install(", "\n    }\n\n")
        self.assertEqual(install.count("signAndOpen("), 3)
        self.assertEqual(install.count("serving: released"), 3)
        for start in ("static func signAndOpen(", "static func serveAndOpen("):
            self.assertIn("serving: serving)", body(side, start, "\n    }\n\n"))

    def test_page_hold_goes_too(self):  # B437, B438
        prompt = read("InstallPrompt.swift")
        self.assertIn("DispatchQueue.main.async { Sideload.yieldPageHold { self.waits } }", prompt)
        self.assertIn("asleep && InstallPrompt.undecided(bid, hold: self)", prompt)
        page = body(read("Sideload.swift"), "static func yieldPageHold(", "\n    }\n")
        self.assertIn("guard waiting() else { return }", page)
        self.assertIn("KeepAlive.shared.holds == 1 && UIApplication.shared.applicationState == .background", page)


if __name__ == "__main__":
    unittest.main()
