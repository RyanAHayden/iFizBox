"""F258: the free route's computer setup command (tools/setup/). In the gate:

- the command's logic (core/, no dependencies): `cargo test --offline` (arguments, codes, the order of the steps,
  every failure's words and exit code, with fake USB and HTTP sides);
- the real command (cli/) still builds against core: `cargo check --offline --locked` when its crates are already on
  this machine (the first fetch needs the network, which the gate doesn't use);
- install.sh made from install.sh.in runs the downloaded command only when its SHA-256 matches, passes the code on,
  and refuses otherwise (a file:// download, a stand-in command);
- release.sh, the templates and the Worker (worker/src/setup.js SETUP_FILES) agree on the file names;
- no Rust source spells the product's name or domain (they come from native/brand.env through cli/build.rs)."""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "native"))
import brand  # noqa: E402

BIN = brand.NAME.lower() + "-setup"
DOMAIN = brand.BRAND["BRAND_DOMAIN"]
SUFFIXES = ["macos", "linux-x86_64", "linux-arm64", "windows-x64.exe", "windows-arm64.exe"]
# Shared across worktrees like native/sideload/idevice's cache, so a fresh checkout doesn't rebuild idevice
TARGET = os.environ.get("IFIZBOX_SETUP_TARGET", os.path.join(os.path.expanduser("~"), ".cache", "ifizbox", "setup-target"))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


def fill(template, sums):
    s = read(template)
    for k, v in {"NAME": brand.NAME, "DOMAIN": DOMAIN, "BIN": BIN, **sums}.items():
        s = s.replace("@%s@" % k, v)
    return s


@unittest.skipUnless(shutil.which("cargo"), "no cargo on this machine")
class Cargo(unittest.TestCase):
    def test_core_logic(self):
        r = subprocess.run(["cargo", "test", "--offline", "--quiet", "--manifest-path", os.path.join(HERE, "core", "Cargo.toml"),
                            "--target-dir", os.path.join(TARGET, "core")], capture_output=True, text=True, timeout=600)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-3000:])
        self.assertRegex(r.stdout, r"test result: ok\. \d+ passed")

    def test_cli_builds(self):
        m = os.path.join(HERE, "cli", "Cargo.toml")
        # "cli-rt", not "cli": that one holds build scripts that older checkouts compiled with env!("CARGO_MANIFEST_DIR"),
        # which cargo would reuse here (see BuildScript below) and which name a worktree that may be gone.
        r = subprocess.run(["cargo", "test", "--offline", "--locked", "--quiet", "--manifest-path", m, "--target-dir", os.path.join(TARGET, "cli-rt")],
                           capture_output=True, text=True, timeout=900)
        if r.returncode != 0 and re.search(r"--offline was specified|failed to download|failed to load source|can't checkout from", r.stderr):
            self.skipTest("the command's crates aren't on this machine (the first build needs the network): " + r.stderr.strip()[-300:])
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-3000:])


class BuildScript(unittest.TestCase):
    """The target dir is shared by every checkout, and cargo's hash for a build script leaves out the checkout's path:
    a build.rs older than the last compile reuses the binary another checkout built. So build.rs must not bake in
    a path at compile time (env!/option_env!/include_*!), or it reads files from a worktree that may be deleted."""

    def test_no_compile_time_paths(self):
        src = read("cli", "build.rs")
        code = "\n".join(line.split("//")[0] for line in src.splitlines())
        for m in ("env!", "option_env!", "include_str!", "include_bytes!", "include!"):
            self.assertNotIn(m, code, "cli/build.rs uses %s: read CARGO_MANIFEST_DIR with std::env::var at run time" % m)
        self.assertIn('std::env::var("CARGO_MANIFEST_DIR")', code)


class Names(unittest.TestCase):
    def test_placeholders_are_all_filled_by_release_sh(self):
        rel = read("release.sh")
        for t in ("install.sh.in", "install.ps1.in"):
            for ph in set(re.findall(r"@([A-Z0-9_]+)@", read(t))):
                self.assertIn("@%s@" % ph, rel, "%s: release.sh doesn't fill @%s@" % (t, ph))

    def test_worker_serves_what_release_makes(self):
        with open(os.path.join(ROOT, "worker", "src", "setup.js")) as f:
            js = f.read()
        files = set(re.findall(r'"([^"]+)"', re.search(r"SETUP_FILES = \[(.*?)\];", js, re.S).group(1)))
        self.assertEqual(files, {"install.sh", "install.ps1", "SHA256SUMS"} | {"%s-%s" % (BIN, s) for s in SUFFIXES})
        rel = read("release.sh")
        for s in SUFFIXES:
            self.assertIn("$bin-%s" % s, rel)
        for s in ("macos", "linux-x86_64", "linux-arm64"):
            self.assertIn("@BIN@-" + s, read("install.sh.in"))
        self.assertIn('"@BIN@-windows-$arch.exe"', read("install.ps1.in"))  # $arch: x64 or arm64

    def test_idevice_pin_is_the_apps(self):
        pin = re.search(r"(?m)^IDEVICE_COMMIT=([0-9a-f]{40})",
                        read("..", "..", "native", "sideload", "idevice", "pin.env")).group(1)
        revs = re.findall(r'rev = "([0-9a-f]+)"', read("cli", "Cargo.toml"))
        self.assertTrue(revs)
        self.assertEqual(set(revs), {pin})

    def test_rust_never_spells_the_name(self):
        name = re.compile(r"\b%s\b|%s" % (re.escape(brand.NAME), re.escape(DOMAIN)), re.I)
        for d in ("core", "cli"):
            for dp, _, fs in os.walk(os.path.join(HERE, d, "src")):
                for fn in fs:
                    with open(os.path.join(dp, fn)) as f:
                        for i, line in enumerate(f, 1):
                            self.assertIsNone(name.search(line), "%s:%d spells the name: %s" % (fn, i, line.strip()))


class InstallSh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        uname = subprocess.run(["uname", "-s"], capture_output=True, text=True).stdout.strip()
        arch = subprocess.run(["uname", "-m"], capture_output=True, text=True).stdout.strip()
        if uname == "Darwin":
            self.suffix, self.key = "macos", "SHA_MACOS"
        elif uname == "Linux" and arch in ("x86_64", "amd64"):
            self.suffix, self.key = "linux-x86_64", "SHA_LINUX_X86_64"
        elif uname == "Linux" and arch in ("aarch64", "arm64"):
            self.suffix, self.key = "linux-arm64", "SHA_LINUX_ARM64"
        else:
            self.skipTest("install.sh has no build for %s %s" % (uname, arch))
        self.bindir = os.path.join(self.tmp, "bin")
        os.mkdir(self.bindir)
        # a stand-in for the command: says it ran, with its arguments, and exits 3
        self.cmd = os.path.join(self.bindir, "%s-%s" % (BIN, self.suffix))
        with open(self.cmd, "w") as f:
            f.write('#!/bin/sh\necho "ran: $*"\nexit 3\n')
        with open(self.cmd, "rb") as f:
            self.sum = hashlib.sha256(f.read()).hexdigest()

    def run_script(self, sums, *args):
        script = os.path.join(self.tmp, "install.sh")
        all_sums = {k: "none" for k in ("SHA_MACOS", "SHA_LINUX_X86_64", "SHA_LINUX_ARM64", "SHA_WINDOWS_X64", "SHA_WINDOWS_ARM64")}
        all_sums.update(sums)
        with open(script, "w") as f:
            f.write(fill("install.sh.in", all_sums))
        env = {**os.environ, "IFIZBOX_SETUP_BASE": "file://" + self.bindir, "USBMUXD_SOCKET_ADDRESS": "127.0.0.1:27015"}
        return subprocess.run(["sh", script, *args], capture_output=True, text=True, timeout=60, env=env, stdin=subprocess.DEVNULL)

    def test_syntax(self):
        r = subprocess.run(["sh", "-n", os.path.join(HERE, "install.sh.in")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = subprocess.run(["bash", "-n", os.path.join(HERE, "release.sh")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    @unittest.skipUnless(shutil.which("curl") or shutil.which("wget"), "no curl or wget")
    def test_runs_the_command_when_the_sum_matches(self):
        r = self.run_script({self.key: self.sum}, "ABCD-2345")
        self.assertIn("ran: ABCD-2345", r.stdout, r.stderr)
        self.assertEqual(r.returncode, 3)  # the command's own exit code

    @unittest.skipUnless(shutil.which("curl") or shutil.which("wget"), "no curl or wget")
    def test_refuses_a_download_that_doesnt_match(self):
        r = self.run_script({self.key: "0" * 64})
        self.assertNotIn("ran:", r.stdout)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Nothing was run", r.stderr)

    @unittest.skipUnless(sys.platform == "linux" and (shutil.which("curl") or shutil.which("wget")), "Linux with curl or wget")
    def test_open_minis_needs_no_usbmuxd(self):
        # as a Linux without usbmuxd (this machine's own is hidden by renaming what the script looks for)
        s = fill("install.sh.in", {**{k: "none" for k in ("SHA_MACOS", "SHA_LINUX_X86_64", "SHA_LINUX_ARM64",
                                                          "SHA_WINDOWS_X64", "SHA_WINDOWS_ARM64")}, self.key: self.sum})
        for found in ("/var/run/usbmuxd", "/usr/sbin/usbmuxd", "command -v usbmuxd"):
            self.assertIn(found, s)
            s = s.replace(found, found + "-hidden")
        script = os.path.join(self.tmp, "install.sh")
        with open(script, "w") as f:
            f.write(s)
        env = {k: v for k, v in os.environ.items() if k != "USBMUXD_SOCKET_ADDRESS"}
        env["IFIZBOX_SETUP_BASE"] = "file://" + self.bindir

        def go(path):
            return subprocess.run(["sh", script, "ABCD-2345"], capture_output=True, text=True, timeout=60,
                                  env={**env, "PATH": path}, stdin=subprocess.DEVNULL)

        r = go(env["PATH"] if "PATH" in env else os.defpath)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("usbmuxd", r.stdout)
        minis = os.path.join(self.tmp, "minis")
        os.mkdir(minis)
        with open(os.path.join(minis, "minis-bonjour"), "w") as f:
            f.write("#!/bin/sh\n")
        os.chmod(os.path.join(minis, "minis-bonjour"), 0o755)
        r = go(minis + os.pathsep + os.environ.get("PATH", os.defpath))
        self.assertIn("ran: ABCD-2345", r.stdout, r.stderr)

    def test_no_build_for_this_computer(self):
        r = self.run_script({})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no build for this computer", r.stderr)


class InstallPs1(unittest.TestCase):
    def test_shape(self):
        s = read("install.ps1.in")
        self.assertNotRegex(s, r"(?m)^\s*exit\b")  # under iex, exit closes the window
        self.assertIn("27015", s)                  # Apple's driver is checked first
        self.assertIn("Get-FileHash -Algorithm SHA256", s)

    @unittest.skipUnless(shutil.which("pwsh"), "no PowerShell on this machine")
    def test_parses(self):
        with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False) as f:
            f.write(fill("install.ps1.in", {"SHA_WINDOWS_X64": "0" * 64, "SHA_WINDOWS_ARM64": "none"}))
        self.addCleanup(os.unlink, f.name)
        r = subprocess.run(["pwsh", "-NoProfile", "-Command",
                            "$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('%s',[ref]$null,[ref]$e) | Out-Null; $e.Count" % f.name],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.stdout.strip(), "0", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
