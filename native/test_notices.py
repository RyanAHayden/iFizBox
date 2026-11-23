"""Third-party notices: the Credits screen names every library the builds ship, idevice's MIT licence sits beside its
pin, and the computer setup tool builds the same idevice commit as the sideload app."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
IDEVICE = os.path.join(HERE, "sideload", "idevice")

# What the builds are made from: the website's signer (zsign, OpenSSL, zlib), the sideload app's install route
# (idevice) and tweak injection (ElleKit).
CREDITED = ["zsign", "OpenSSL", "zlib", "idevice", "ElleKit"]


def read(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()


def credits_source(js):
    """renderCredits' body in screens/home.js: everything the Credits screen draws."""
    start = js.index("function renderCredits")
    end = js.index("\nfunction ", start + 1)
    return js[start:end]


def credited_labels(src):
    """Row labels on the Credits screen: `label: "X"` rows and `["X", "subtitle", url]` table entries."""
    labels = set(re.findall(r'\blabel:\s*"([^"]+)"', src))
    labels |= set(re.findall(r'\[\s*"([^"]+)",\s*"[^"]*",\s*"https?://', src))
    return labels


def pin_commit(text):
    for line in text.splitlines():
        line = line.split(" #", 1)[0].strip()
        if line.startswith("IDEVICE_COMMIT="):
            return line.split("=", 1)[1]
    raise AssertionError("pin.env has no IDEVICE_COMMIT")


def cargo_idevice_rev(text):
    m = re.search(r'^idevice\s*=\s*\{[^}\n]*\brev\s*=\s*"([^"]+)"', text, re.M)
    if not m:
        raise AssertionError("Cargo.toml has no idevice dependency with a rev")
    return m.group(1)


class Credits(unittest.TestCase):
    def test_credits_name_every_shipped_library(self):
        labels = credited_labels(credits_source(read(ROOT, "web", "app", "screens", "home.js")))
        missing = [n for n in CREDITED if n not in labels]
        self.assertFalse(missing, f"Credits screen does not name {missing}")

    def test_check_fails_when_a_name_is_dropped(self):
        src = credits_source(read(ROOT, "web", "app", "screens", "home.js"))
        for name in CREDITED:
            changed = src.replace(f'"{name}"', '"Renamed"')
            self.assertNotIn(name, credited_labels(changed), name)


class IdeviceNotice(unittest.TestCase):
    def test_mit_licence_beside_the_pin(self):
        lic = read(IDEVICE, "LICENSE")
        self.assertIn("Jackson Coxson", lic)
        self.assertIn("Permission is hereby granted, free of charge", lic)
        self.assertIn("The above copyright notice and this permission notice shall be included", lic)


class OneIdevicePin(unittest.TestCase):
    def test_setup_cli_builds_the_pinned_commit(self):
        commit = pin_commit(read(IDEVICE, "pin.env"))
        self.assertRegex(commit, r"^[0-9a-f]{40}$")
        rev = cargo_idevice_rev(read(ROOT, "tools", "setup", "cli", "Cargo.toml"))
        self.assertEqual(rev, commit, "tools/setup/cli/Cargo.toml's idevice rev differs from IDEVICE_COMMIT in pin.env")

    def test_check_fails_when_the_pin_moves(self):
        cargo = read(ROOT, "tools", "setup", "cli", "Cargo.toml")
        commit = pin_commit(read(IDEVICE, "pin.env"))
        moved = cargo.replace(commit, "0" * 40)
        self.assertNotEqual(cargo_idevice_rev(moved), commit)


if __name__ == "__main__":
    unittest.main()
