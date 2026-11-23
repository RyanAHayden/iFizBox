"""T6: tools/release.sh names the assets the way F61's self-update looks for them (web/app/core/selfupdate.js
parseRelease/debFor), and refuses a build whose version isn't native/VERSION. Dry runs only: nothing is published
and nothing touches the network."""
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "native"))
import mkdeb  # noqa: E402
import mkipa  # noqa: E402

SCRIPT = os.path.join(ROOT, "tools", "release.sh")
with open(os.path.join(ROOT, "native", "VERSION")) as f:
    VERSION = f.read().strip()


class Release(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.dist = os.path.join(self.tmp, "dist")
        os.makedirs(self.dist)

    def fake_build(self, deb_version, ipa_version):
        """A iFizBox.deb and iFizBox.ipa just real enough to name: they fail mkdeb/mkipa's checks, which a dry run
        only reports."""
        root, debian = os.path.join(self.tmp, "root"), os.path.join(self.tmp, "debian")
        os.makedirs(os.path.join(root, "var/jb/Applications/iFizBox.app"))
        os.makedirs(debian)
        with open(os.path.join(root, "var/jb/Applications/iFizBox.app/x"), "wb") as f:
            f.write(b"x")
        with open(os.path.join(debian, "control"), "w") as f:
            f.write("Package: com.ryha.ifizbox\nVersion: %s\nArchitecture: iphoneos-arm64\n"
                    "Installed-Size: @SIZE@\n" % deb_version)
        mkdeb.build(root, debian, os.path.join(self.dist, "iFizBox.deb"), mtime=0)
        app = os.path.join(self.tmp, "iFizBox.app")
        os.makedirs(app)
        with open(os.path.join(app, "Info.plist"), "wb") as f:
            plistlib.dump({"CFBundleShortVersionString": ipa_version, "CFBundleIdentifier": "com.ryha.ifizbox"}, f)
        mkipa.build(app, os.path.join(self.dist, "iFizBox.ipa"), mtime=0)

    def dry_run(self, *extra, env_extra=None, notes_file=True):
        notes = os.path.join(self.tmp, "notes.md")
        with open(notes, "w") as f:
            f.write("- A test release\n")
        env = {k: v for k, v in os.environ.items()
               if k not in ("IFIZBOX_RELEASE_REPO", "IFIZBOX_PIRACY_SYNC_ARGS", "IFIZBOX_RELEASE_HISTORY",
                            "IFIZBOX_RELEASE_NOTES_DIR")}
        # T47's stray-file check looks at an empty checkout, so a leftover in this one's web/app/ doesn't fail these
        # (tools/test_stray_check.py tests that check)
        clean = os.path.join(self.tmp, "clean")
        if not os.path.isdir(clean):
            subprocess.run(["git", "init", "-q", clean], check=True)
        env["IFIZBOX_STRAY_ROOT"] = clean
        env.update(env_extra or {})
        args = ["--notes", notes] if notes_file else []
        return subprocess.run([SCRIPT, "--dry-run", "--dist", self.dist, *args, *extra], cwd=ROOT,
                              env=env, capture_output=True, text=True, timeout=60)

    def test_notes_from_release_notes_files(self):
        """D27: without --notes, the notes are one bullet per release-notes/*.md (README.md left out), then the
        footer; not the commit subjects."""
        self.fake_build("%s-7" % VERSION, VERSION)
        notesdir = os.path.join(self.tmp, "release-notes")
        os.makedirs(notesdir)
        for name, text in (("F1.md", "Apps install straight from a source's page.\n"),
                           ("B2.md", "Search no longer\nskips packages with long names.\n"),
                           ("README.md", "How to write these.\n")):
            with open(os.path.join(notesdir, name), "w") as f:
                f.write(text)
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--out", out, notes_file=False, env_extra={"IFIZBOX_RELEASE_NOTES_DIR": notesdir})
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(out, "notes.md")) as f:
            lines = f.read().splitlines()
        self.assertEqual(lines[:3], ["- Search no longer skips packages with long names.",
                                     "- Apps install straight from a source's page.", ""])
        self.assertNotIn("How to write these.", "\n".join(lines))
        self.assertIn("rootless jailbreak build", lines[-1])
        self.assertIn("  - Apps install straight from a source's page.", r.stdout)

    def test_notes_without_files_skip_commits(self):
        """D27: with no release-notes files, the default notes are one plain line, never the commit subjects."""
        self.fake_build("%s-7" % VERSION, VERSION)
        empty = os.path.join(self.tmp, "none")
        os.makedirs(empty)
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--out", out, notes_file=False, env_extra={"IFIZBOX_RELEASE_NOTES_DIR": empty})
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(out, "notes.md")) as f:
            notes = f.read()
        self.assertTrue(notes.startswith("Smaller fixes and improvements.\n\n"), notes)
        self.assertNotIn("\n- ", notes)
        self.assertIn("rootless jailbreak build", notes)

    def assets(self, out):
        line = next(l for l in out.splitlines() if l.startswith("release: assets: "))
        return line[len("release: assets: "):].split()

    def test_asset_names(self):
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.assets(r.stdout),
                         ["iFizBox.ipa", "iFizBox.deb", "com.ryha.ifizbox_%s-7_iphoneos-arm64.deb" % VERSION,
                          "Packages", "Packages.gz", "Release", "source.json"])
        self.assertIn("RyanAHayden/iFizBox v%s " % VERSION, r.stdout)
        self.assertIn("nothing published", r.stdout)
        self.assertNotIn("is not native/VERSION", r.stderr)

    @unittest.skipUnless(shutil.which("node"), "no node")
    def test_selfupdate_finds_them(self):
        """The names the script prints, fed to selfupdate.js as a GitHub release, give an IPA and the arm64 .deb."""
        self.fake_build("%s-7" % VERSION, VERSION)
        names = self.assets(self.dry_run().stdout)
        release = {"tag_name": "v" + VERSION, "body": "- x", "html_url": "https://example.invalid/r",
                   "assets": [{"name": n, "browser_download_url": "https://example.invalid/" + n} for n in names]}
        js = ("import { parseRelease, debFor } from %s;\n"
              "const r = parseRelease(%s);\n"
              "console.log(JSON.stringify({ v: r.version, ipa: r.ipa, arm64: debFor(r, 'iphoneos-arm64'),"
              " none: debFor(r, 'iphoneos-arm64e') }));"
              % (json.dumps("file://" + os.path.join(ROOT, "web/app/core/selfupdate.js")), json.dumps(release)))
        out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        got = json.loads(out.stdout)
        base = "https://example.invalid/"
        self.assertEqual(got["v"], VERSION)
        self.assertEqual(got["ipa"], base + "iFizBox.ipa")
        self.assertEqual(got["arm64"], base + "com.ryha.ifizbox_%s-7_iphoneos-arm64.deb" % VERSION)
        self.assertIsNone(got["none"])  # the rootless build is never offered to a roothide (arm64e) phone

    def test_version_mismatch_reported(self):
        self.fake_build("0.0.1-7", "0.0.1")
        r = self.dry_run()
        self.assertEqual(r.returncode, 0, r.stderr)  # a dry run reports; a real run would stop
        self.assertIn("is not native/VERSION %s" % VERSION, r.stderr)
        self.assertIn("a real run would stop here", r.stderr)


    def test_repo_and_source(self):
        """F72: the APT repo files (Packages naming the Debian-named .deb beside it, hashes that match, the minimum
        field) and the AltStore source with the new version first and the old ones kept."""
        import gzip
        import hashlib
        self.fake_build("%s-7" % VERSION, VERSION)
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--minimum", VERSION, "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        debname = "com.ryha.ifizbox_%s-7_iphoneos-arm64.deb" % VERSION
        with open(os.path.join(out, "Packages")) as f:
            packages = f.read()
        self.assertIn("Package: com.ryha.ifizbox\n", packages)
        self.assertIn("Filename: v%s/%s\n" % (VERSION, debname), packages)  # B73: the release's own asset
        self.assertIn("X-iFizBox-Minimum-Version: %s\n" % VERSION, packages)
        with open(os.path.join(self.dist, "iFizBox.deb"), "rb") as f:
            deb = f.read()
        self.assertIn("SHA256: %s\n" % hashlib.sha256(deb).hexdigest(), packages)
        with open(os.path.join(out, "Packages.gz"), "rb") as f:
            self.assertEqual(gzip.decompress(f.read()).decode(), packages)
        with open(os.path.join(out, "Release")) as f:
            release = f.read()
        self.assertIn("Origin: iFizBox\n", release)
        self.assertIn("Architectures: iphoneos-arm64\n", release)
        self.assertIn("X-iFizBox-Minimum-Version: %s\n" % VERSION, release)
        self.assertIn(" %s %d Packages\n" % (hashlib.sha256(packages.encode()).hexdigest(), len(packages)), release)
        self.assertIn("releases/latest/download/", r.stdout)
        self.assertIn("apt repo: https://ifizbox.com/repo/", r.stdout)  # B17
        with open(os.path.join(out, "source.json")) as f:
            src = json.load(f)
        with open(os.path.join(ROOT, "web", "app", "source.json")) as f:
            before = json.load(f)
        app = src["apps"][0]
        self.assertEqual(app["minimumVersion"], VERSION)
        self.assertEqual(app["versions"][0]["version"], VERSION)
        self.assertTrue(app["versions"][0]["localizedDescription"].startswith("A test release\n"))
        # altsource.KEEP caps versions[]: once the source is full, the oldest entry drops off. F180: entries whose IPA
        # isn't <NAME>.ipa (the releases before it) drop off too.
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import altsource
        old = [v["version"] for v in before["apps"][0]["versions"]
               if v["version"] != VERSION and altsource.is_own_ipa(v)][:altsource.KEEP - 1]
        self.assertEqual([v["version"] for v in app["versions"][1:]], old)
        # A dry run never writes the repo's own source.json.
        with open(os.path.join(ROOT, "web", "app", "source.json")) as f:
            self.assertEqual(json.load(f), before)

    def test_minimum_checked(self):
        self.fake_build("%s-7" % VERSION, VERSION)
        self.assertNotEqual(self.dry_run("--minimum", "1.2").returncode, 0)
        self.assertNotEqual(self.dry_run("--minimum", "99.0.0").returncode, 0)

    def test_other_arch_rides_along(self):
        self.fake_build("%s-7" % VERSION, VERSION)
        other = "com.ryha.ifizbox_%s-7_iphoneos-arm64e.deb" % VERSION
        shutil.copy(os.path.join(self.dist, "iFizBox.deb"), os.path.join(self.dist, other))
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(other, self.assets(r.stdout))
        with open(os.path.join(out, "Packages")) as f:
            self.assertIn("Filename: v%s/%s\n" % (VERSION, other), f.read())

    def test_repo_keeps_older_releases(self):
        """B73: Packages names the older releases' .debs too (from IFIZBOX_RELEASE_HISTORY here, GitHub in a real run),
        each under its own tag, so Downgrade lists them; a dry run without it says it read none."""
        self.fake_build("%s-7" % VERSION, VERSION)
        hist = os.path.join(self.tmp, "hist", "v0.0.1")
        os.makedirs(hist)
        with open(os.path.join(hist, "Packages"), "w") as f:
            f.write("Package: com.ryha.ifizbox\nVersion: 0.0.1-3\nArchitecture: iphoneos-arm64\n"
                    "Filename: com.ryha.ifizbox_0.0.1-3_iphoneos-arm64.deb\nSize: 3\nSHA256: ab\n")
        out = os.path.join(self.tmp, "out")
        r = self.dry_run("--out", out, env_extra={"IFIZBOX_RELEASE_HISTORY": os.path.join(self.tmp, "hist")})
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(os.path.join(out, "Packages")) as f:
            packages = f.read()
        self.assertIn("Filename: v%s/com.ryha.ifizbox_%s-7_iphoneos-arm64.deb\n" % (VERSION, VERSION), packages)
        self.assertIn("Filename: v0.0.1/com.ryha.ifizbox_0.0.1-3_iphoneos-arm64.deb\n", packages)
        self.assertIn("apt repo versions: %s-7 0.0.1-3\n" % VERSION, r.stdout)
        r = self.dry_run("--out", out)
        self.assertIn("older releases not read", r.stdout)

    def piracy_answers(self, sha, hosts):
        """Saved cnstr/manifests API answers for tools/sync-piracy-list.py: the list's tree and its newest commit."""
        tree = os.path.join(self.tmp, "tree.json")
        commits = os.path.join(self.tmp, "commits.json")
        with open(tree, "w") as f:
            json.dump({"truncated": False,
                       "tree": [{"path": "configs/piracy-list/" + h, "type": "blob"} for h in hosts]}, f)
        with open(commits, "w") as f:
            json.dump([{"sha": sha, "commit": {"committer": {"date": "2099-01-02T00:00:00Z"}}}], f)
        return {"IFIZBOX_PIRACY_SYNC_ARGS": "--tree %s --commits %s" % (tree, commits)}

    def test_piracy_list_not_fetched_by_default(self):
        """T11: a plain dry run makes no network call; it names the committed copy's Canister commit."""
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout, r"release: piracy list: Canister [0-9a-f]{12} \(\d{4}-\d\d-\d\d\), not checked")

    def test_piracy_list_older_warned(self):
        """T11: --sync-piracy compares with Canister's newest commit and warns; the repo's copy stays as it is."""
        import re
        piracy = os.path.join(ROOT, "web", "app", "core", "piracy-list.js")
        with open(piracy) as f:
            before = f.read()
        hosts = re.findall(r'^  "([^"]+)",$', before, re.M)
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run("--sync-piracy", env_extra=self.piracy_answers("ab" * 20, hosts + ["new.example.org"]))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("older than its newest piracy-list commit abababababab (2099-01-02)", r.stderr)
        self.assertIn("a real run would refresh", r.stderr)
        with open(piracy) as f:
            self.assertEqual(f.read(), before)

    def test_piracy_list_current(self):
        """T11: the same commit and hosts as the committed copy: no warning."""
        import re
        with open(os.path.join(ROOT, "web", "app", "core", "piracy-list.js")) as f:
            js = f.read()
        sha, date = re.search(r'commit: "([0-9a-f]{40})", date: "([0-9-]+)"', js).groups()
        env = self.piracy_answers(sha, re.findall(r'^  "([^"]+)",$', js, re.M))
        with open(env["IFIZBOX_PIRACY_SYNC_ARGS"].split()[-1], "w") as f:
            json.dump([{"sha": sha, "commit": {"committer": {"date": date + "T00:00:00Z"}}}], f)
        self.fake_build("%s-7" % VERSION, VERSION)
        r = self.dry_run("--sync-piracy", env_extra=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("warning", r.stderr)
        self.assertIn("release: piracy list: Canister %s (%s), current" % (sha[:12], date), r.stdout)


FAKE_GH = r"""#!/usr/bin/env bash
# A stand-in for gh: answers from files in $FAKE_GH_DIR and logs every call (with the GH_TOKEN it saw).
echo "GH_TOKEN=${GH_TOKEN:-} $*" >> "$FAKE_GH_DIR/log"
case "$1 $2" in
  "auth token")
    [ "$3" = --user ] || [ "$3" = -u ] || { echo "fake gh: active account" ; exit 0; }
    [ -f "$FAKE_GH_DIR/token-$4" ] || { echo "no account found for $4" >&2; exit 1; }
    cat "$FAKE_GH_DIR/token-$4" ;;
  "api user")
    [ -f "$FAKE_GH_DIR/login-$GH_TOKEN" ] || { echo "HTTP 401: Bad credentials" >&2; exit 1; }
    cat "$FAKE_GH_DIR/login-$GH_TOKEN" ;;
  "release view")
    [ -f "$FAKE_GH_DIR/view" ] || { echo "release not found" >&2; exit 1; }
    cat "$FAKE_GH_DIR/view" ;;
  *) echo "fake gh: unexpected $*" >&2; exit 9 ;;
esac
"""


class Server:
    """A local web server: `routes` maps a path to (status, headers, body), or to a function returning one."""

    def __init__(self, routes):
        import http.server
        import threading
        self.routes = routes
        self.hits = {}
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                path = self.path.split("?")[0]
                outer.hits[path] = outer.hits.get(path, 0) + 1
                r = outer.routes.get(path, (404, {}, b"not found"))
                if self.headers.get("User-Agent", "").startswith("Python-urllib"):
                    r = (403, {}, b"forbidden")  # like Cloudflare in front of the real site
                status, headers, body = r() if callable(r) else r
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v.replace("BASE", outer.base))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.base = "http://127.0.0.1:%d" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class Publish(unittest.TestCase):
    """T33: the account a real run publishes as (a fake gh on PATH), the checks after publishing, and the live check of
    https://<domain>/repo/ (a local web server). Nothing here touches GitHub or the network."""

    OWNER = "RyanAHayden"
    REPO = "RyanAHayden/iFizBox"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.fake = os.path.join(self.tmp, "gh")
        bindir = os.path.join(self.tmp, "bin")
        os.makedirs(self.fake)
        os.makedirs(bindir)
        gh = os.path.join(bindir, "gh")
        with open(gh, "w") as f:
            f.write(FAKE_GH)
        os.chmod(gh, 0o755)
        self.path = bindir + os.pathsep + os.environ.get("PATH", "")

    def write(self, name, text):
        with open(os.path.join(self.fake, name), "w") as f:
            f.write(text)

    def log(self):
        try:
            with open(os.path.join(self.fake, "log")) as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def run_release(self, *args, env_extra=None, timeout=60):
        env = {k: v for k, v in os.environ.items()
               if k not in ("GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "IFIZBOX_RELEASE_REPO")
               and not k.startswith("IFIZBOX_LIVE_") and not k.startswith("IFIZBOX_RELEASE_")}
        env.update({"PATH": self.path, "FAKE_GH_DIR": self.fake})
        env.update(env_extra or {})
        return subprocess.run([SCRIPT, *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)

    def logged_in(self):
        """gh knows the active pull-only account and the owner; the owner's token is the one that works."""
        self.write("token-FIZL0", "tok-fizl0\n")
        self.write("token-" + self.OWNER, "tok-owner\n")
        self.write("login-tok-fizl0", "FIZL0\n")
        self.write("login-tok-owner", self.OWNER + "\n")

    # (1) the token pick

    def test_token_from_owner_account(self):
        self.logged_in()
        r = self.run_release("--check-auth")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("publishing as %s (gh auth token --user %s)" % (self.OWNER, self.OWNER), r.stdout)
        log = self.log()
        self.assertIn("auth token --user %s\n" % self.OWNER, log)
        self.assertIn("GH_TOKEN=tok-owner api user", log)  # gh's later calls run with the owner's token
        self.assertNotIn("tok-fizl0", log)

    def test_owner_not_logged_in(self):
        self.write("token-FIZL0", "tok-fizl0\n")
        r = self.run_release("--check-auth")
        self.assertEqual(r.returncode, 1)
        self.assertIn("gh has no login for %s, who owns %s: run 'gh auth login'" % (self.OWNER, self.REPO), r.stderr)

    def test_token_of_someone_else(self):
        self.write("token-" + self.OWNER, "tok-fizl0\n")
        self.write("login-tok-fizl0", "FIZL0\n")
        r = self.run_release("--check-auth")
        self.assertEqual(r.returncode, 1)
        self.assertIn("belongs to FIZL0", r.stderr)

    def test_gh_token_from_environment_wins(self):
        self.logged_in()
        r = self.run_release("--check-auth", env_extra={"GH_TOKEN": "tok-env"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("GH_TOKEN from the environment", r.stdout)
        self.assertNotIn("auth token", self.log())

    def test_owner_follows_release_repo(self):
        self.logged_in()
        self.write("token-someone", "tok-someone\n")
        self.write("login-tok-someone", "someone\n")
        r = self.run_release("--check-auth", env_extra={"IFIZBOX_RELEASE_REPO": "someone/fork"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("auth token --user someone\n", self.log())

    # (2) the release is really up

    ASSETS = ["iFizBox.ipa", "iFizBox.deb", "com.ryha.ifizbox_9.8.7-1_iphoneos-arm64.deb", "Packages", "Packages.gz",
              "Release", "source.json"]

    def github(self, latest_tag):
        """github.com's latest/download redirect to a tag's asset, and the asset itself."""
        base = "/%s/releases" % self.REPO
        s = Server({
            base + "/latest/download/iFizBox.ipa":
                (302, {"Location": "BASE%s/download/%s/iFizBox.ipa" % (base, latest_tag)}, b""),
            base + "/download/%s/iFizBox.ipa" % latest_tag: (200, {}, b"PK\x03\x04ipa"),
        })
        self.addCleanup(s.close)
        return s

    def verify(self, server, timeout="0"):
        return self.run_release("--verify-release", "9.8.7", env_extra={
            "GH_TOKEN": "tok-env", "IFIZBOX_RELEASE_WEB": server.base,
            "IFIZBOX_RELEASE_VERIFY_TIMEOUT": timeout, "IFIZBOX_RELEASE_VERIFY_INTERVAL": "0.2"})

    def test_release_up(self):
        self.write("view", "false\n" + "\n".join(self.ASSETS) + "\n")
        s = self.github("v9.8.7")
        r = self.verify(s)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("release view v9.8.7 --repo %s" % self.REPO, self.log())
        self.assertIn("/releases/download/v9.8.7/iFizBox.ipa (200)", r.stdout)
        self.assertIn("v9.8.7 is up on GitHub", r.stdout)
        self.assertEqual(s.hits.get("/%s/releases/download/v9.8.7/iFizBox.ipa" % self.REPO), 1)

    def test_release_lacks_asset(self):
        self.write("view", "false\n" + "\n".join(a for a in self.ASSETS if a != "source.json") + "\n")
        r = self.verify(self.github("v9.8.7"))
        self.assertEqual(r.returncode, 1)
        self.assertIn("release v9.8.7 on %s lacks source.json" % self.REPO, r.stderr)

    def test_latest_is_older_release(self):
        self.write("view", "false\n" + "\n".join(self.ASSETS) + "\n")
        r = self.verify(self.github("v9.8.6"), timeout="1")
        self.assertEqual(r.returncode, 1)
        self.assertIn("doesn't resolve to v9.8.7's iFizBox.ipa: it answers 302 -> ", r.stderr)
        self.assertIn("/download/v9.8.6/iFizBox.ipa", r.stderr)

    def test_latest_asset_missing(self):
        self.write("view", "false\n" + "\n".join(self.ASSETS) + "\n")
        s = self.github("v9.8.7")
        del s.routes["/%s/releases/download/v9.8.7/iFizBox.ipa" % self.REPO]
        r = self.verify(s)
        self.assertEqual(r.returncode, 1)
        self.assertIn("which answers 404", r.stderr)

    def test_draft_not_checked_as_latest(self):
        self.write("view", "true\n" + "\n".join(self.ASSETS) + "\n")
        s = self.github("v9.8.6")
        r = self.verify(s)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("is a draft", r.stdout)
        self.assertEqual(s.hits, {})

    # (2b) the site serves it

    def site(self, versions, debs, up_after=0):
        """https://<domain>/repo/: source.json and Packages; with up_after, they list 9.8.7 only from that many
        requests of source.json on (a deploy landing while it polls)."""
        def source():
            vs = (["9.8.7"] if s.hits["/repo/source.json"] > up_after else []) + versions
            return 200, {"Content-Type": "application/json"}, json.dumps({"apps": [
                {"bundleIdentifier": "com.example.other", "versions": [{"version": "9.8.7"}]},
                {"bundleIdentifier": "com.ryha.ifizbox", "versions": [{"version": v} for v in vs]}]}).encode()

        def packages():
            ds = (["9.8.7-12"] if s.hits["/repo/source.json"] > up_after else []) + debs
            body = "Package: other.pkg\nVersion: 9.8.7\n\n" + "".join(
                "Package: com.ryha.ifizbox\nVersion: %s\nArchitecture: iphoneos-arm64\n\n" % d for d in ds)
            return 200, {}, body.encode()
        s = Server({"/repo/source.json": source, "/repo/Packages": packages})
        self.addCleanup(s.close)
        return s

    def live(self, server, timeout):
        return self.run_release("--verify-live", "9.8.7", env_extra={
            "IFIZBOX_LIVE_BASE": server.base, "IFIZBOX_LIVE_TIMEOUT": timeout, "IFIZBOX_LIVE_INTERVAL": "0.1"})

    def test_live_up(self):
        r = self.live(self.site(["9.8.6"], ["9.8.6-11"]), "5")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("/repo/source.json: versions 9.8.7 9.8.6", r.stdout)
        self.assertIn("/repo/Packages: com.ryha.ifizbox 9.8.7-12 9.8.6-11", r.stdout)
        self.assertIn("9.8.7 is up", r.stdout)
        self.assertEqual(self.log(), "")  # no gh, no token needed

    def test_live_waits_for_deploy(self):
        s = self.site(["9.8.6"], ["9.8.6-11"], up_after=3)
        r = self.live(s, "30")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("release: live: waiting: ", r.stderr)
        self.assertIn("(no 9.8.7)", r.stderr)
        self.assertGreaterEqual(s.hits["/repo/source.json"], 4)

    def test_live_not_up_fails(self):
        """Other packages and apps at 9.8.7 don't count: only iFizBox's own entries."""
        r = self.live(self.site(["9.8.6"], ["9.8.6-11"], up_after=10 ** 6), "1")
        self.assertEqual(r.returncode, 1)
        self.assertIn("/repo/source.json: versions 9.8.6 (no 9.8.7)", r.stderr)
        self.assertIn("/repo/Packages: com.ryha.ifizbox 9.8.6-11 (no 9.8.7)", r.stderr)
        self.assertIn("9.8.7 is NOT up after 1s", r.stderr)

    def test_live_site_down_fails(self):
        s = self.site([], [])
        base = s.base
        s.close()
        r = self.run_release("--verify-live", "9.8.7", env_extra={
            "IFIZBOX_LIVE_BASE": base, "IFIZBOX_LIVE_TIMEOUT": "0.5", "IFIZBOX_LIVE_INTERVAL": "0.1"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("URLError", r.stderr)
        self.assertIn("NOT up", r.stderr)

    def test_bad_version(self):
        r = self.run_release("--verify-live", "1.2")
        self.assertEqual(r.returncode, 1)
        self.assertIn("takes X.Y.Z", r.stderr)


if __name__ == "__main__":
    unittest.main()
