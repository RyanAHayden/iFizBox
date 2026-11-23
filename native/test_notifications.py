"""F65: the shell's side of N5's daemon (Sources/Notifications.swift), checked as text: Swift only builds where the
iOS toolchain is (tools/check.sh's native build), and notifications only run on a jailbroken phone (see the F65
journal). Permission asked once in jailbreak mode, a tap opens the userInfo route, app.badge clears the badge."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


class Notifications(unittest.TestCase):
    def setUp(self):
        self.src = read("Sources", "Notifications.swift")

    def test_permission_once_in_jailbreak_mode(self):
        start = self.src[self.src.index("func start()"):]
        start = start[:start.index("\n    }\n")]
        self.assertIn("center.delegate = self", start)
        self.assertLess(start.index("center.delegate = self"), start.index("AppMode.current == .jailbreak"))
        self.assertIn("authorizationStatus == .notDetermined", start)
        self.assertIn("requestAuthorization(options: [.alert, .badge, .sound])", start)
        app = read("Sources", "App.swift")
        launch = app[app.index("didFinishLaunchingWithOptions"):]
        launch = launch[:launch.index("\n    }\n")]
        self.assertIn("Notifications.shared.start()", launch)

    def test_tap_opens_the_route(self):
        self.assertIn('userInfo["url"]', self.src)
        self.assertIn('c.userInfo = @{@"url": @"#/changes"}', read("daemon", "main.m"))
        self.assertIn('location.hash = route', self.src)
        self.assertIn("'ifizbox:update-alert'", self.src)  # B399: Changes refreshes the sources
        with open(os.path.join(HERE, "..", "web", "app", "app.js"), encoding="utf-8") as f:
            self.assertIn('addEventListener("ifizbox:update-alert"', f.read())
        self.assertIn("cfg.requestCachePolicy = .reloadIgnoringLocalCacheData", read("Sources", "Apt.swift"))
        self.assertIn('arguments: ["route": route]', self.src)  # passed as data, never pasted into the script
        self.assertIn('upgradesID = "ifizbox-upgrades"', self.src)
        self.assertIn('#define NOTE_ID @"ifizbox-upgrades"', read("daemon", "main.m"))
        allowed = re.search(r'CharacterSet\(charactersIn: "([^"]+)"\)', self.src).group(1)
        self.assertNotIn("'", allowed)
        self.assertNotIn('\\', allowed)

    def test_badge_bridge(self):
        self.assertIn('b.on("app.badge")', self.src)
        self.assertIn("setBadgeCount(n)", self.src)
        self.assertIn("removeDeliveredNotifications(withIdentifiers: [upgradesID])", self.src)
        self.assertIn("Notifications.register(self)", read("Sources", "Bridge.swift"))

    def test_one_badge_setter(self):
        # B158: every icon badge goes through Notifications.setIcon (UpdateCheck.BadgeSync), so counts land in the
        # order asked and the latest wins; nothing else sets the badge directly.
        self.assertIn("setIcon(n, ask: true)", self.src)
        self.assertIn("UpdateCheck.BadgeSync()", self.src)
        bg = read("Sources", "BackgroundCheck.swift")
        self.assertIn("Notifications.setIcon(n)", bg)
        self.assertIn("Notifications.setIcon(badge)", bg)
        for name in ("BackgroundCheck.swift", "Notifications.swift"):
            src = read("Sources", name)
            self.assertEqual(src.count("setBadgeCount("), 1 if name == "Notifications.swift" else 0, name)
            self.assertEqual(src.count("applicationIconBadgeNumber = "), 1 if name == "Notifications.swift" else 0, name)
        app = read("..", "web", "app", "app.js")
        self.assertIn("upgradeNotices.updated();", app)
        self.assertNotIn('call("app.badge", { count: 0 })', app)


if __name__ == "__main__":
    unittest.main()
