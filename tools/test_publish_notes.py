"""F439b: the release notes' format (tools/publish_notes.py) and tools/publish.sh refusing notes that break it before
its version commit. publish.sh runs in a throwaway git repo with stand-ins for release.sh and deploy.sh: nothing is
published, nothing touches the network."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import publish_notes  # noqa: E402

GOOD = """- Install apps straight from a source's page.
- Updates keep downloading when you leave the app.
- Search finds packages by their author, e.g. Saurik.
- Smaller fixes: long package names wrap, and Sources no longer jumps.
"""

# Logs its arguments and the raw notes it was given; a real run stops at the publish (step 3).
FAKE_RELEASE = r"""#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case " $* " in
  *" --check-auth "*) ;;
  *" --dry-run "*) cat "$IFIZBOX_RELEASE_NOTES_DIR"/*.md ;;
  *) echo "fake release: stop" >&2; exit 7 ;;
esac
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class Format(unittest.TestCase):
    def bad(self, text, line, what):
        found = publish_notes.problems(text)
        self.assertTrue([1 for n, m in found if n == line and what in m], found)

    def test_good(self):
        self.assertEqual(publish_notes.problems(GOOD), [])
        for ok in ("- Smaller fixes and improvements.", "- Downloads resume after a restart.", "- Opening a .deb file shows its details.",
                   "- iOS 26.1 works, and ifizbox.com loads faster.", "- " + "x" * 99 + "."):
            self.assertEqual(publish_notes.problems(ok + "\n"), [], ok)

    def test_long(self):
        self.bad("- Short one.\n- " + "x" * 100 + ".\n", 2, "101 characters")

    def test_one_list(self):
        self.bad("Install apps from a source.\n\n- Tap Get on an app.\n", 1, "not a")
        self.bad("- Icons load.\n\n- Search is faster.\n", 3, "one list")
        self.bad("## New\n- Tap Get on an app.\n", 1, "not a")
        self.bad("- Tap Get\n  on an app.\n", 2, "not a")
        self.bad("* Tap Get on an app.\n", 1, "not a")

    def test_count(self):
        self.bad("", 1, "no bullets")
        self.bad("".join("- Thing%d.\n" % i for i in range(7)), 7, "at most 6")
        self.assertEqual(publish_notes.problems("".join("- Thing%d.\n" % i for i in range(6))), [])

    def test_one_sentence(self):
        self.bad("- Search is faster. iPhones stay cool.\n", 1, "more than one")
        self.bad("- Search is faster\n", 1, "not a whole")

    def test_repeated(self):
        self.bad("- Search is faster.\n- Icons load.\n- Search is faster.\n", 3, "repeats line 1")
        # 0.34.0 said this twice
        self.bad("- Browse's New and Top 25 now have a Filter button.\n"
                 "- Browse's New and Top 25 have a Filter button, to filter and sort them as you can the other lists.\n",
                 2, "repeats line 1")
        self.bad("- Smaller fixes: icons.\n- Smaller fixes: names wrap.\n", 2, "second Smaller fixes")

    def test_linked(self):
        for text in ("See https://example.org.", "Read [the notes](notes).", "Go to www.example.org.", "Go to github.com/x."):
            self.bad("- %s\n" % text, 1, "link")

    def test_download_text(self):
        for text in (publish_notes.NAME + ".ipa is unsigned.", "Download the latest %s." % publish_notes.NAME,
                     "Download the IPA to update.", "Get the .deb for jailbroken phones.",
                     "Download the app from GitHub.", "Take the IPA from the release page."):
            self.bad("- %s\n" % text, 1, "download text")


class Publish(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.log = os.path.join(self.tmp, "log")
        self.repo = os.path.join(self.tmp, "repo")
        origin = os.path.join(self.tmp, "origin.git")
        git(self.tmp, "init", "-q", "--bare", "-b", "main", origin)
        git(self.tmp, "init", "-q", "-b", "main", self.repo)
        for k, v in (("user.name", "t"), ("user.email", "t@example.org"), ("commit.gpgsign", "false")):
            git(self.repo, "config", k, v)
        for p in ("tools/publish.sh", "tools/publish_notes.py", "native/brand.py", "native/brand.env"):
            os.makedirs(os.path.dirname(os.path.join(self.repo, p)), exist_ok=True)
            shutil.copy2(os.path.join(ROOT, p), os.path.join(self.repo, p))
        self.write("native/VERSION", "0.1.0\n")
        self.write("web/app/tweak-index.json", "{}\n")
        self.write("tools/tweak-index.mjs", "process.exit(1)\n")
        self.write("release-notes/README.md", "readme\n")
        self.write("release-notes/F1.md", "A raw note.\n")
        self.write("tools/release.sh", FAKE_RELEASE, 0o755)
        self.write("tools/deploy.sh", "#!/bin/sh\n", 0o755)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "start")
        git(self.repo, "remote", "add", "origin", origin)
        git(self.repo, "push", "-q", "-u", "origin", "main")
        self.start = git(self.repo, "rev-parse", "HEAD")

    def write(self, path, text, mode=0o644):
        path = os.path.join(self.repo, path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        os.chmod(path, mode)

    def publish(self, *args, notes=None):
        if notes is not None:
            path = os.path.join(self.tmp, "notes.md")
            with open(path, "w") as f:
                f.write(notes)
            args += ("--notes", path)
        return subprocess.run(["bash", "tools/publish.sh", "0.2.0", *args], cwd=self.repo, capture_output=True,
                              text=True, timeout=120, env=dict(os.environ, SWIFT_TOOLCHAIN="x", IOS_SDK="x",
                                                               FAKE_LOG=self.log, TMPDIR=self.tmp))

    def refused(self, r, *said):
        self.assertNotEqual(r.returncode, 0, r.stdout)
        for s in said:
            self.assertIn(s, r.stderr)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.start)
        self.assertEqual(git(self.repo, "status", "--porcelain", "--untracked-files=no"), "")
        self.assertFalse(os.path.exists(self.log))  # release.sh was never reached

    def test_missing(self):
        self.refused(self.publish(), "1 release note(s) wait", "--notes")

    def test_bad_notes(self):
        self.refused(self.publish(notes="- Fine.\n- " + "x" * 120 + ".\n"), "line 2", "at most 100")
        self.refused(self.publish(notes="- It is faster.\n- It is faster.\n"), "line 2", "repeats line 1")
        self.refused(self.publish(notes="- See https://example.org.\n"), "line 1", "link")
        self.refused(self.publish("--dry-run", notes="Summary.\n"), "line 1")

    def test_good_notes(self):
        r = self.publish(notes=GOOD)
        self.assertEqual(r.returncode, 7, r.stderr)  # the fake release.sh's stop, after the version commit
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s", "origin/main"), "Version 0.2.0")
        self.assertEqual(git(self.repo, "ls-files", "release-notes"), "release-notes/README.md")
        with open(self.log) as f:
            self.assertIn("--notes " + os.path.join(self.tmp, "notes.md"), f.read())

    def test_none_waiting(self):
        git(self.repo, "rm", "-q", "release-notes/F1.md")
        git(self.repo, "commit", "-qm", "none waiting")
        git(self.repo, "push", "-q", "origin", "main")
        self.assertEqual(self.publish().returncode, 7)

    def test_dry_run_prints_the_raw_list(self):
        r = self.publish("--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("A raw note.", r.stdout)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.start)


if __name__ == "__main__":
    unittest.main()
