"""F354: the app shows web/app's own bars in every era, so Theme > Style iOS 26's floating glass tab bar with its
Search circle and the capsule bar buttons (web/app/ios26.css, <html data-tabbar="float">) look in the app as they do
on the website and the Home Screen app. The shell draws no UINavigationBar or UITabBar of its own, and nothing puts
the `native` class on <html> that would hide the web bars (style.css's html.native rules).
F369: one exception, the glass bars (NativeGlass.swift): on iOS 26+ under the iOS 26 style, when the page asks through
ui.glass, the tab bar is a real UITabBarController's. Nowhere else, and never for another era."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = os.path.join(HERE, "Sources")
WEB = os.path.join(ROOT, "web", "app")
GLASS_BARS = "NativeGlass.swift"  # F369: the glass bars, the one place a UITabBarController is allowed

# A UIKit bar the shell would draw over the page: made, subclassed, or styled through its appearance proxy.
UIKIT_BAR = re.compile(r"\bUI(?:Navigation|Tab)Bar(?:Controller)?\s*(?:\(|\.appearance|:)|\bUI(?:Navigation|Tab)BarController\b")
# Anything that would give <html> the `native` class: classList, className, or a class attribute. The class name
# whole: `is-native` (nav/switch.js's WebKit switch) is another class.
NATIVE_CLASS = re.compile(r"""classList\.(?:add|toggle)\(\s*["']native["']|className\s*\+?=\s*["'](?:[^"']*\s)?native(?=["'\s])"""
                          r"""|setAttribute\(\s*["']class["']\s*,\s*["'](?:[^"']*\s)?native(?=["'\s])"""
                          r"""|<html[^>]*class=["'](?:[^"']*\s)?native(?=["'\s])""")


def files(root, exts):
    for d, _, names in os.walk(root):
        if "vendor" in d.split(os.sep):
            continue
        for n in names:
            if n.endswith(exts) and ".test." not in n:
                yield os.path.join(d, n)


class WebBars(unittest.TestCase):
    def test_shell_draws_no_uikit_bars(self):
        hits = []
        for p in files(SOURCES, (".swift", ".m", ".h", ".c")):
            if os.path.basename(p) == GLASS_BARS:
                continue
            for i, line in enumerate(open(p, encoding="utf-8"), 1):
                code = line.split("//", 1)[0]
                if UIKIT_BAR.search(code):
                    hits.append(f"{os.path.relpath(p, ROOT)}:{i}: {line.strip()}")
        self.assertEqual(hits, [], "the shell would draw its own bars over web/app's (iOS 26's glass among them)")

    def test_glass_bars_tab_bar_only_on_ios26_through_ui_glass(self):
        text = open(os.path.join(SOURCES, GLASS_BARS), encoding="utf-8").read()
        self.assertIn('b.on("ui.glass")', text)
        self.assertIn('guard #available(iOS 26.0, *) else { return c.reply(nil, "unsupported:', text)
        code = "\n".join(line.split("//", 1)[0] for line in text.splitlines())
        self.assertNotRegex(code, r"\bUINavigationBar\b", "the nav bar's buttons only, no UIKit nav bar")
        made = list(re.finditer(r"\bUITabBarController\(\)", code))
        self.assertTrue(made)
        for m in made:
            before = code[:m.start()]
            cls = before.rfind("\nprivate final class")
            self.assertIn("@available(iOS 26.0, *)", before[max(0, cls - 40):cls],
                          "the UITabBarController lives only in an iOS 26-only class")

    def test_nothing_hides_the_web_bars(self):
        hits = []
        for root, exts in ((SOURCES, (".swift", ".m", ".js")), (WEB, (".js", ".html")),
                           (os.path.join(HERE, "bridge.js"), ())):
            paths = [root] if os.path.isfile(root) else files(root, exts)
            for p in paths:
                text = open(p, encoding="utf-8").read()
                for m in NATIVE_CLASS.finditer(text):
                    hits.append(f"{os.path.relpath(p, ROOT)}: {m.group(0)}")
        self.assertEqual(hits, [], "html.native hides the nav and tab bars (style.css), so the app would show none")


if __name__ == "__main__":
    unittest.main()
