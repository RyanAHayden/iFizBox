"""F354: the app shows web/app's own bars in every era, so Theme > Style iOS 26's floating glass tab bar with its
Search circle and the capsule bar buttons (web/app/ios26.css, <html data-tabbar="float">) look in the app as they do
on the website and the Home Screen app. The shell draws no UINavigationBar or UITabBar of its own, and nothing puts
the `native` class on <html> that would hide the web bars (style.css's html.native rules)."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = os.path.join(HERE, "Sources")
WEB = os.path.join(ROOT, "web", "app")

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
            for i, line in enumerate(open(p, encoding="utf-8"), 1):
                code = line.split("//", 1)[0]
                if UIKIT_BAR.search(code):
                    hits.append(f"{os.path.relpath(p, ROOT)}:{i}: {line.strip()}")
        self.assertEqual(hits, [], "the shell would draw its own bars over web/app's (iOS 26's glass among them)")

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
