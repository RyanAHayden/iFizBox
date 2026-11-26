"""Size guard for files in the repo: a file over 1 MB that git tracks (or would track: untracked and not ignored)
fails the gate, unless its path is on the allowlist below.

Every commit stays in .git for ever, so one big screenshot or video costs every clone. Journal media goes to ref/
(gitignored) or is downscaled first: a PNG at phone size, a short clip as a GIF/WebM under 1 MB, a trace trimmed.

Run alone: `python3 tools/test_sizeguard.py --list` prints the offenders (exit 1) or nothing (exit 0).
"""
import fnmatch
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 1024 * 1024

# Built or binary files that are big by nature and have to be in the repo.
ALLOW = [
    "web/app/vendor/zsign/*",  # zsign as WebAssembly, built by tools/build-zsign-wasm.sh
    "native/icon/*",  # Assets.car / AssetsLite.car and the 1024 px app icons
    "web/app/icons/*",  # the website's icons and launch images
    "plan/*.md",  # agent-runner's task list and its DONE log, which only grow
    "journal/2026-11-26-t85-promo-clip-jailbreak/promo-*.mp4",  # the two clips to post (3.8 MB); the download links point here
    "journal/2026-11-26-t86-promo-clip-sideload/promo-lite-*.mp4",  # the two sideload clips to post (4.3 MB)
]

# Already in history before the guard: they cost nothing more where they are, and removing them from the tip saves
# no space in .git. Don't add to this list: shrink the new file or keep it in ref/.
GRANDFATHERED = {
    "journal/F1/trace.json.gz",
    "journal/2026-11-20-f290-showcase-video/showcase-4x5.mp4",
    "journal/2026-11-20-f290-showcase-video/showcase-9x16.mp4",
}


def allowed(path):
    return path in GRANDFATHERED or any(fnmatch.fnmatchcase(path, pat) for pat in ALLOW)


def candidates(root):
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True, capture_output=True,
    ).stdout
    return sorted({p for p in out.decode("utf-8", "surrogateescape").split("\0") if p})


def oversized(root, limit=LIMIT):
    """(size, path) of every tracked or trackable file over `limit` bytes that isn't allowed."""
    bad = []
    for path in candidates(root):
        full = Path(root) / path
        try:
            st = os.lstat(full)
        except FileNotFoundError:  # deleted in the work tree, not yet committed
            continue
        if not os.path.isfile(full) or os.path.islink(full):
            continue
        if st.st_size > limit and not allowed(path):
            bad.append((st.st_size, path))
    return bad


def report(bad):
    lines = [f"  {size / 1048576:.1f} MB  {path}" for size, path in bad]
    return ("files over 1 MB (move journal media to ref/ or downscale it; a build output that must be committed "
            "goes on ALLOW in tools/test_sizeguard.py):\n" + "\n".join(lines))


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t"})


class SizeGuard(unittest.TestCase):
    def test_repo_has_no_new_big_files(self):
        bad = oversized(ROOT)
        self.assertFalse(bad, report(bad) if bad else "")

    def test_grandfathered_paths_still_exist(self):
        # Once one is gone, drop it from the list so the name can't be reused for a new big file.
        tracked = set(candidates(ROOT))
        self.assertFalse(GRANDFATHERED - tracked, "remove from GRANDFATHERED in tools/test_sizeguard.py")

    def _repo(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        git(d.name, "init", "-q")
        return Path(d.name)

    def test_fake_2mb_file_fails(self):
        repo = self._repo()
        (repo / "journal" / "x").mkdir(parents=True)
        (repo / "journal" / "x" / "clip.mp4").write_bytes(b"\0" * (2 * LIMIT))
        (repo / "small.png").write_bytes(b"\0" * 1000)
        # Untracked but not ignored: `done` would commit it, so it counts.
        self.assertEqual(oversized(repo), [(2 * LIMIT, "journal/x/clip.mp4")])
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "big")
        self.assertEqual(oversized(repo), [(2 * LIMIT, "journal/x/clip.mp4")])

    def test_ignored_allowed_and_exact_limit_pass(self):
        repo = self._repo()
        (repo / ".gitignore").write_text("ref/\n")
        (repo / "ref").mkdir()
        (repo / "ref" / "clip.mp4").write_bytes(b"\0" * (2 * LIMIT))
        (repo / "web/app/vendor/zsign").mkdir(parents=True)
        (repo / "web/app/vendor/zsign/zsign.wasm").write_bytes(b"\0" * (2 * LIMIT))
        (repo / "edge.bin").write_bytes(b"\0" * LIMIT)
        self.assertEqual(oversized(repo), [])

    def test_allow_patterns_do_not_reach_lookalikes(self):
        self.assertTrue(allowed("native/icon/Assets.car"))
        self.assertFalse(allowed("journal/native/icon/Assets.car"))
        self.assertFalse(allowed("journal/F1/other.json.gz"))


if __name__ == "__main__":
    if sys.argv[1:] == ["--list"]:
        found = oversized(ROOT)
        if found:
            print(report(found), file=sys.stderr)
        sys.exit(1 if found else 0)
    unittest.main()
