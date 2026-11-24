"""F418b: the signed Restore My VPN Shortcut the app hands to Shortcuts."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))


class Signed(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "App", "RestoreShortcut.swift")) as f:
            self.name = re.search(r'shortcutName = "(.+)"', f.read()).group(1)

    def test_signed(self):
        with open(os.path.join(ROOT, "web", "app", "shortcuts", self.name + ".shortcut"), "rb") as f:
            self.assertEqual(f.read(4), b"AEA1")  # signed: iOS refuses the plain one

    def test_one_name(self):
        with open(os.path.join(ROOT, "tools", "shortcuts", "sign.sh")) as f:
            self.assertIn('key=restore-vpn name="%s"' % self.name, f.read())


if __name__ == "__main__":
    unittest.main()
