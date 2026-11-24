"""F418a: the Restore My VPN Shortcut's bridge calls, read as text (no iOS here). The rules they go by are RestoreShortcut's,
run on Linux by test_restoreshortcut.py."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))


def read(*p, base=HERE):
    with open(os.path.join(base, *p), encoding="utf-8") as f:
        return f.read()


def part(src, start, end):
    i = src.index(start)
    return src[i:src.index(end, i)]


class RestoreBridge(unittest.TestCase):
    def setUp(self):
        self.src = read("App", "RestoreShortcutBridge.swift")

    def assertOrder(self, text, steps):
        self.assertEqual(sorted(steps, key=text.index), steps)

    def test_calls(self):
        self.assertEqual(sorted(re.findall(r'b\.on\("([^"]+)"', self.src)), ["restore.add", "restore.back", "restore.store"])
        self.assertIn("RestoreShortcutBridge.register(b)", read("App", "LocalVPN.swift"))
        self.assertIn("if RestoreShortcutBridge.receive(url) { return }", read("Sources", "App.swift", base=NATIVE))
        self.assertIn('"restore-vpn"', self.src)
        self.assertIn('answer(c, .store)', part(self.src, 'b.on("restore.store")', "b.on(\"restore.back\")"))
        self.assertIn('answer(c, .back)', part(self.src, 'b.on("restore.back")', "\n    }\n"))

    def test_refused(self):
        """Never in the jailbreak app, nor under another bundle ID, nor without the signed file."""
        for name in ["restore.add", "restore.store", "restore.back"]:
            self.assertIn("{ c in\n            if let e = refusal { return", self.src[self.src.index('b.on("%s")' % name):][:120])
        refusal = part(self.src, "static var refusal", "\n    }\n")
        self.assertIn("guard CellularShortcutBridge.available", refusal)
        self.assertIn('file == nil ? "missing: ', refusal)
        self.assertIn('subdirectory: "web/shortcuts"', self.src)
        available = part(read("App", "CellularShortcutBridge.swift"), "static var available", "\n    }\n")
        self.assertIn("AppMode.current != .jailbreak && Bundle.main.bundleIdentifier == SignOptions.selfBundleID", available)

    def test_run(self):
        """What is up is read before Shortcuts opens; every begun run ends, judged by RestoreShortcut and otherVPN."""
        run = part(self.src, "private static func run(", "\n    }\n")
        self.assertOrder(run, ["CellularShortcutBridge.active()", "RestoreShortcut.begin(k, vpnUp: !LocalVPN.isDown(), otherVPN: LocalVPN.otherVPNUp())",
                               "drive(k)", "RestoreShortcut.end()", "guard case .failed"])
        drive = part(self.src, "private static func drive(", "\n    }\n")
        self.assertIn("RestoreShortcut.verdict(RestoreShortcut.report", drive)
        self.assertIn("otherVPN: LocalVPN.otherVPNUp()", drive)

    def test_is_down(self):
        """Our tunnel counts as up when its state isn't known, while it comes or goes, and while something holds it."""
        down = part(read("App", "LocalVPN.swift"), "static func isDown()", "\n    }\n")
        self.assertIn("holds > 0 || installs > 0", down)
        self.assertIn("guard let s = savedStatus() else { return false }", down)
        self.assertIn("[.disconnected, .invalid].contains(s)", down)


if __name__ == "__main__":
    unittest.main()
