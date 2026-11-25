"""iFizBox's own update through the Signing Server (hosted, iOS's prompt). Checked as text (UIKit only builds with the
iOS SDK, and the route only runs on a phone): native CloseForUpdate polls from the prompt on and can't stay in .prompt
(B208), closes only once iOS began the download (B394: `asked` alone can still be cancelled), follows the link for its
whole life, and hands iOS the last upload again instead of uploading a duplicate. The worker side is in worker/test.mjs."""
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def side():
    with open(os.path.join(HERE, "Sources", "Sideload.swift"), encoding="utf-8") as f:
        return f.read()


def cfu():
    src = side()
    return src[src.index("enum CloseForUpdate"):src.index("final class HereClose")]


def body(src, head):
    b = src[src.index(head):]
    return b[:b.index("\n    }\n")]


class HostedSelfUpdate(unittest.TestCase):
    def test_polls_from_the_prompt_and_cannot_stay_in_it(self):
        after = body(cfu(), "static func afterPrompt")
        self.assertLess(after.index("poll(h, run: mine, misses: 0)"), after.index("let begin = {"))
        self.assertIn("asyncAfter(deadline: .now() + promptLimit) { begin() }", after)
        # begin still acts only from .prompt, so the limit can't restart a wait already running
        self.assertIn("guard mine == run, state == .prompt else { return }", after)

    def test_closes_at_the_download_not_before(self):
        poll = body(cfu(), "private static func poll(")
        self.assertIn('if known, mark("started") || mark("finished") {', poll)
        asked = poll[poll.index('if known, mark("asked")'):]
        asked = asked[:asked.index("set(.asked)")]
        self.assertNotIn("finish()", asked)
        self.assertNotIn("guess()", asked)

    def test_follows_the_link_for_its_life(self):
        self.assertIn("if h.age > h.life { return giveUp(", body(cfu(), "private static func poll("))

    def test_second_try_reuses_the_upload(self):
        host = side()
        host = body(host, "static func hostAndOpen(")
        self.assertLess(host.index("CloseForUpdate.reusable(record, server: server)"), host.index("HostUpload("))
        reuse = body(cfu(), "static func reusable(")
        for k in ("sha256", "bundleID", "version", "appID", "expires", "options", "server"):
            self.assertIn(k, reuse)
        self.assertIn("h.age < h.life - reuseSpare", reuse)
        self.assertIn("guard h.by == Bundle.main.bundlePath", reuse)  # B445: not once the update is in
        self.assertIn("hosted = nil", body(cfu(), "private static func giveUp("))


if __name__ == "__main__":
    unittest.main()
