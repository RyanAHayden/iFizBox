"""B334: a file opened from Files that UIKit drops before the scene delegate (its File Provider bookmark refused when
the app's signature names another App ID than its bundle ID) still reaches Incoming (OpenRescue.swift). Checked as
text: the Swift only builds with the iOS SDK; the iPhone 15 Pro run is in journal/2026-11-22-b334-files-ipa-open/."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*parts):
    with open(os.path.join(HERE, *parts)) as f:
        return f.read()


class OpenRescueWiring(unittest.TestCase):
    def setUp(self):
        self.app = read("Sources", "App.swift")
        self.rescue = read("Sources", "OpenRescue.swift")

    def test_started_at_launch_before_the_scene(self):
        launch = self.app[self.app.index("didFinishLaunchingWithOptions"):]
        launch = launch[:launch.index("return true")]
        self.assertIn("OpenRescue.start()", launch)

    def test_incoming_marks_files_the_delegate_delivered(self):
        receive = self.app[self.app.index("static func receive(_ url: URL)"):]
        receive = receive[:receive.index("if LocalVPN.receive(url)")]
        self.assertIn("if url.isFileURL { OpenRescue.delivered(url) }", receive)

    def test_sideload_only_and_hooks_the_action_url(self):
        start = self.rescue[self.rescue.index("static func start()"):]
        start = start[:start.index("\n    }\n")]
        self.assertIn("AppMode.current == .sideload", start)
        self.assertIn('NSClassFromString("UIOpenURLAction")', start)
        self.assertIn('NSSelectorFromString("url")', start)
        # the hook only notes file URLs and always returns UIKit's own value
        self.assertIn("url.isFileURL { seen(url) }", start)
        self.assertIn("return value", start)

    def test_never_both_the_delegate_and_the_rescue(self):
        seen = self.rescue[self.rescue.index("private static func seen"):]
        self.assertRegex(seen, r"if let d = lastDelivered, d >= at\.addingTimeInterval\(-[0-9.]+\) \{ return \}")
        self.assertIn("asyncAfter(deadline: .now() + grace)", seen)

    def test_unreadable_ipa_becomes_the_pages_pick_route(self):
        pick = self.rescue[self.rescue.index("static func pickLink"):]
        pick = pick[:pick.index("\n    }\n")]
        self.assertIn('url.pathExtension.lowercased() == "ipa", !readable(url.path)', pick)
        for item in ('"route", value: "pick-ipa"', '"name", value: url.lastPathComponent', '"dir", value: url.deletingLastPathComponent().path'):
            self.assertIn(item, pick)
        self.assertIn('q.host = "shared"', pick)

    def test_picker_takes_dir_and_single(self):
        my = read("Sources", "MyIPAs.swift")
        pick = my[my.index("static func pick(_ c: Bridge.Call)"):]
        pick = pick[:pick.index("top.present(picker")]
        self.assertIn('c.params["single"] as? Bool != true', pick)
        self.assertTrue(re.search(r'c\.params\["dir"\] as\? String, dir\.hasPrefix\("/"\)', pick))
        self.assertIn("picker.directoryURL", pick)


if __name__ == "__main__":
    unittest.main()
