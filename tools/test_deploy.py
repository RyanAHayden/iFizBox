"""T53: ifizbox.com is deployed from release tags, not from every push to main.

tools/deploy.sh vX.Y.Z deploys the site from the tag's commit (a clean worktree, build.json written there), and
tools/release.sh --tag-source (what tools/publish.sh runs) puts the tag on a commit that already has the new
web/app/source.json. Each test runs in a throwaway git repo with stand-ins for npx and gh on PATH: nothing deploys,
nothing is published, nothing touches the network."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
import plistlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, "tools"), os.path.join(ROOT, "native")]
import mkdeb  # noqa: E402
import selfrepo  # noqa: E402

# Logs each call (its directory, its arguments, and whether web/app/build.json is there) and answers whoami.
FAKE_NPX = r"""#!/usr/bin/env bash
{ echo "cwd=$PWD"; echo "args=$*"; [ -f ../web/app/build.json ] && echo "build.json=$(cat ../web/app/build.json)"; } >> "$FAKE_NPX_LOG"
case " $* " in
  *" whoami "*) [ -n "${FAKE_NPX_LOGGED_IN:-}" ] && echo "You are logged in with an OAuth Token" || echo "You are not authenticated." ;;
  *" deploy "*) exit "${FAKE_NPX_DEPLOY_RC:-0}" ;;
esac
"""

# gh for a real release run: the owner's token, then a release that exists once `release create` ran.
FAKE_GH = r"""#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_DIR/log"
case "$1 $2" in
  "auth token") echo tok ;;
  "api user") echo RyanAHayden ;;
  "release view")
    [ -f "$FAKE_GH_DIR/created" ] || { echo "release not found" >&2; exit 1; }
    printf 'true\niFizBox.ipa\niFizBox.deb\nPackages\nPackages.gz\nRelease\nsource.json\n' ;;
  "release create") touch "$FAKE_GH_DIR/created" ;;
  *) echo "fake gh: unexpected $*" >&2; exit 9 ;;
esac
"""


def git(cwd, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.org", *args], cwd=cwd,
                          check=True, capture_output=True, text=True).stdout.strip()


def copy_in(repo, *paths):
    for p in paths:
        os.makedirs(os.path.join(repo, os.path.dirname(p)), exist_ok=True)
        shutil.copy2(os.path.join(ROOT, p), os.path.join(repo, p))


def fake_bin(tmp, name, text):
    bindir = os.path.join(tmp, "bin")
    os.makedirs(bindir, exist_ok=True)
    path = os.path.join(bindir, name)
    with open(path, "w") as f:
        f.write(text)
    os.chmod(path, 0o755)
    return bindir


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("IFIZBOX_", "GIT_")) and k != "GH_TOKEN"}
    env.update({"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.org",
                "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.org"})
    env.update(extra)
    return env


@unittest.skipUnless(shutil.which("git"), "no git")
class Deploy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q", "-b", "main")
        copy_in(self.repo, "native/brand.env", "native/VERSION", "tools/buildinfo.sh", "tools/deploy.sh",
                "worker/wrangler.ifizbox.toml")
        with open(os.path.join(self.repo, ".gitignore"), "w") as f:
            f.write("web/app/build.json\n")
        os.makedirs(os.path.join(self.repo, "web/app"))
        with open(os.path.join(self.repo, "web/app/index.html"), "w") as f:
            f.write("tagged\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "release")
        self.tagged = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "tag", "v9.9.9")
        # main moves on after the tag, and the checkout holds a file git doesn't track: neither may reach the site
        with open(os.path.join(self.repo, "web/app/index.html"), "w") as f:
            f.write("after the tag\n")
        git(self.repo, "commit", "-q", "-am", "later work")
        with open(os.path.join(self.repo, "web/app/stray.ipa"), "w") as f:
            f.write("x")
        self.log = os.path.join(self.tmp, "npx.log")
        self.path = fake_bin(self.tmp, "npx", FAKE_NPX) + os.pathsep + os.environ["PATH"]

    def deploy(self, *args, **env):
        return subprocess.run([os.path.join(self.repo, "tools/deploy.sh"), *args], cwd=self.repo, capture_output=True,
                              text=True, timeout=60,
                              env=clean_env(PATH=self.path, FAKE_NPX_LOG=self.log, **env))

    def calls(self):
        try:
            with open(self.log) as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def test_deploys_the_tagged_commit(self):
        r = self.deploy("v9.9.9")
        self.assertEqual(r.returncode, 0, r.stderr)
        log = self.calls()
        self.assertRegex(log, r"args=--yes wrangler@[0-9.]+ deploy -c wrangler.ifizbox.toml\n")
        self.assertNotIn("--dry-run", log)
        cwd = re.search(r"cwd=(.*)\n", log).group(1)
        self.assertTrue(cwd.endswith("/w/worker"), cwd)  # a temporary worktree, not this checkout
        self.assertFalse(os.path.exists(cwd))  # removed afterwards
        info = json.loads(re.search(r"build.json=(.*)\n", log).group(1))
        self.assertEqual(info["commit"], self.tagged[:len(info["commit"])])
        self.assertEqual(info["files"], ["index.html"])  # no stray.ipa
        self.assertIn("now runs v9.9.9", r.stdout)
        self.assertFalse(os.path.exists(os.path.join(self.repo, "web/app/build.json")))
        self.assertNotIn(".git/worktrees/w", git(self.repo, "worktree", "list"))

    def test_source_only_tag_counts_the_built_commit(self):
        # release.sh --tag-source tags the built commit plus web/app/source.json: build.json names the built commit,
        # so the site's build number and commit match the release's apps
        built = git(self.repo, "rev-parse", "v9.9.9")
        git(self.repo, "checkout", "-q", "--detach", built)
        with open(os.path.join(self.repo, "web/app/source.json"), "w") as f:
            f.write("{}\n")
        git(self.repo, "add", "web/app/source.json")
        git(self.repo, "commit", "-q", "-m", "source")
        git(self.repo, "tag", "v9.9.10")
        git(self.repo, "checkout", "-q", "main")
        r = self.deploy("v9.9.10")
        self.assertEqual(r.returncode, 0, r.stderr)
        info = json.loads(re.search(r"build.json=(.*)\n", self.calls()).group(1))
        self.assertEqual(info["commit"], built[:len(info["commit"])])
        self.assertEqual(info["build"], git(self.repo, "rev-list", "--count", built))
        self.assertEqual(info["files"], ["index.html", "source.json"])  # the tag's files all the same

    def test_other_tag_counts_the_tag(self):
        r = self.deploy("v9.9.9")
        self.assertEqual(r.returncode, 0, r.stderr)
        info = json.loads(re.search(r"build.json=(.*)\n", self.calls()).group(1))
        self.assertEqual(info["build"], git(self.repo, "rev-list", "--count", "v9.9.9"))
        self.assertEqual(info["commit"], self.tagged[:len(info["commit"])])

    def test_dry_run(self):
        r = self.deploy("v9.9.9", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("deploy -c wrangler.ifizbox.toml --dry-run\n", self.calls())
        self.assertIn("dry run", r.stdout)

    def test_wrangler_fails(self):
        r = self.deploy("v9.9.9", FAKE_NPX_DEPLOY_RC="1")
        self.assertEqual(r.returncode, 1)
        self.assertIn("wrangler deploy of v9.9.9 failed", r.stderr)

    def test_no_such_tag(self):
        r = self.deploy("v1.2.3")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no tag v1.2.3", r.stderr)
        self.assertEqual(self.calls(), "")

    def test_usage(self):
        for args in ((), ("9.9.9",), ("v9.9",), ("v9.9.9", "--force")):
            r = self.deploy(*args)
            self.assertEqual(r.returncode, 1, args)
            self.assertEqual(self.calls(), "")

    def test_check_auth(self):
        r = self.deploy("--check-auth", FAKE_NPX_LOGGED_IN="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("whoami -c wrangler.ifizbox.toml", self.calls())
        r = self.deploy("--check-auth")
        self.assertEqual(r.returncode, 1)
        self.assertIn("wrangler isn't logged in", r.stderr)


BUILD = os.path.join(ROOT, "native", "build")


with open(os.path.join(ROOT, "native", "VERSION")) as _f:
    VERSION = _f.read().strip()


def ipa_version(path):
    with zipfile.ZipFile(path) as z:
        plist = next(n for n in z.namelist() if n.endswith(".app/Info.plist") and n.count("/") == 2)
        return plistlib.loads(z.read(plist)).get("CFBundleShortVersionString")


def deb_version(path):
    """The .deb's Version without its -<build>, as release.sh compares it."""
    return mkdeb.control_fields(selfrepo.control_text(path)).get("Version", "").split("-")[0]


def unpublishable(build, version):
    """Why release.sh can't publish the native build in `build` as `version`, or None. A slot without the native
    toolchain skips the build, so what an earlier task left there can be missing or of another version."""
    for name, read in (("iFizBox.ipa", ipa_version), ("iFizBox.deb", deb_version)):
        try:
            found = read(os.path.join(build, name))
        except Exception as e:  # missing or half-written: nothing to publish either way
            return "no native build to publish: native/build/%s unreadable (%s)" % (name, type(e).__name__)
        if found != version:
            return "stale native build: native/build/%s is %s, native/VERSION is %s" % (name, found, version)
    return None


class Unpublishable(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def build(self, ipa, deb):
        with zipfile.ZipFile(os.path.join(self.tmp, "iFizBox.ipa"), "w") as z:
            z.writestr("Payload/x.app/Info.plist", plistlib.dumps({"CFBundleShortVersionString": ipa}))
        root, debian = os.path.join(self.tmp, "root"), os.path.join(self.tmp, "debian")
        os.makedirs(root, exist_ok=True)
        os.makedirs(debian, exist_ok=True)
        with open(os.path.join(debian, "control"), "w") as f:
            f.write("Package: x\nVersion: %s-6016\n" % deb)
        mkdeb.build(root, debian, os.path.join(self.tmp, "iFizBox.deb"))

    def test_matching_build(self):
        self.build("1.0.7", "1.0.7")
        self.assertIsNone(unpublishable(self.tmp, "1.0.7"))

    def test_stale_deb(self):
        self.build("1.0.7", "1.0.3")
        self.assertEqual(unpublishable(self.tmp, "1.0.7"),
                         "stale native build: native/build/iFizBox.deb is 1.0.3, native/VERSION is 1.0.7")

    def test_stale_ipa(self):
        self.build("1.0.3", "1.0.7")
        self.assertIn("iFizBox.ipa is 1.0.3", unpublishable(self.tmp, "1.0.7"))

    def test_missing_or_broken(self):
        self.assertIn("iFizBox.ipa unreadable", unpublishable(self.tmp, "1.0.7"))
        self.build("1.0.7", "1.0.7")
        with open(os.path.join(self.tmp, "iFizBox.deb"), "wb") as f:
            f.write(b"half")
        self.assertIn("iFizBox.deb unreadable", unpublishable(self.tmp, "1.0.7"))


UNPUBLISHABLE = unpublishable(BUILD, VERSION)


@unittest.skipIf(not shutil.which("git") or UNPUBLISHABLE, UNPUBLISHABLE or "no git")
class TagSource(unittest.TestCase):
    """A real release.sh run (fake gh, a local bare repo as origin) with --tag-source: the tag's commit is the built
    commit plus the new web/app/source.json, and main is left alone."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = os.path.join(self.tmp, "repo")
        self.origin = os.path.join(self.tmp, "origin.git")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q", "-b", "main")
        copy_in(self.repo, "native/brand.env", "native/brand.py", "native/mkdeb.py", "native/mkipa.py",
                "native/launch_check.py", "native/carfile.py", "tools/release.sh", "tools/stray-check.sh",
                "tools/sync-piracy-list.py", "tools/selfrepo.py", "tools/altsource.py", "web/app/source.json",
                "web/app/core/piracy-list.js")
        self.version = VERSION
        copy_in(self.repo, "native/VERSION")
        with open(os.path.join(self.repo, ".gitignore"), "w") as f:
            f.write("__pycache__/\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "Version " + self.version)
        self.built = git(self.repo, "rev-parse", "HEAD")
        git(self.tmp, "init", "-q", "--bare", self.origin)
        git(self.repo, "remote", "add", "origin", self.origin)
        git(self.repo, "push", "-q", "origin", "main")
        self.gh = os.path.join(self.tmp, "gh")
        os.makedirs(self.gh)
        self.path = fake_bin(self.tmp, "gh", FAKE_GH) + os.pathsep + os.environ["PATH"]

    def piracy_current(self):
        """Saved Canister answers that match the committed piracy list, so the refresh changes nothing."""
        with open(os.path.join(ROOT, "web/app/core/piracy-list.js")) as f:
            js = f.read()
        sha, date = re.search(r'commit: "([0-9a-f]{40})", date: "([0-9-]+)"', js).groups()
        tree, commits = os.path.join(self.tmp, "tree.json"), os.path.join(self.tmp, "commits.json")
        with open(tree, "w") as f:
            json.dump({"truncated": False, "tree": [{"path": "configs/piracy-list/" + h, "type": "blob"}
                                                    for h in re.findall(r'^  "([^"]+)",$', js, re.M)]}, f)
        with open(commits, "w") as f:
            json.dump([{"sha": sha, "commit": {"committer": {"date": date + "T00:00:00Z"}}}], f)
        return "--tree %s --commits %s" % (tree, commits)

    def test_tag_has_the_new_source(self):
        history = os.path.join(self.tmp, "history")
        os.makedirs(history)
        notes = os.path.join(self.tmp, "notes.md")
        with open(notes, "w") as f:
            f.write("- A test release\n")
        r = subprocess.run([os.path.join(self.repo, "tools/release.sh"), "--tag-source", "--draft", "--dist", BUILD,
                            "--notes", notes], cwd=self.repo, capture_output=True, text=True, timeout=120,
                           env=clean_env(PATH=self.path, FAKE_GH_DIR=self.gh, IFIZBOX_RELEASE_HISTORY=history,
                                         IFIZBOX_PIRACY_SYNC_ARGS=self.piracy_current()))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        tag = "v" + self.version
        tagged = git(self.origin, "rev-parse", tag + "^{commit}")  # pushed to origin as a tag
        self.assertEqual(git(self.repo, "rev-parse", tag + "^"), self.built)  # on top of the built commit
        self.assertEqual(git(self.repo, "diff", "--name-only", self.built, tag), "web/app/source.json")
        source = json.loads(git(self.repo, "show", tag + ":web/app/source.json"))
        app = next(a for a in source["apps"] if a["bundleIdentifier"] == "com.ryha.ifizbox")
        self.assertEqual(app["versions"][0]["version"], self.version)
        self.assertIn("/releases/download/%s/iFizBox.ipa" % tag, app["versions"][0]["downloadURL"])
        self.assertEqual(git(self.origin, "rev-parse", "main"), self.built)  # main isn't pushed: publish.sh merges
        with open(os.path.join(self.gh, "log")) as f:
            create = next(l for l in f if l.startswith("release create"))
        self.assertIn("release create %s --repo RyanAHayden/iFizBox --target %s " % (tag, tagged), create)
        self.assertIn("merge %s into main" % tag, r.stdout)


if __name__ == "__main__":
    unittest.main()
