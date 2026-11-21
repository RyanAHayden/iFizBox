#!/usr/bin/env python3
"""Copy Canister's piracy list into web/app/core/piracy-list.js (F228; R23, journal/2026-11-18-r23-malware-list).

Canister (github.com/cnstr/manifests, MIT) keeps one empty file per piracy source under configs/piracy-list/; the
file name is the host. This reads the repo's git tree in one call, and the newest commit that touched the list,
and writes the hosts as a JS module that core/warnings.js falls back to after its own hand-written entries. Run it
before a release; the app itself never asks Canister or GitHub anything (the list ships with it).

    tools/sync-piracy-list.py                      # fetch from api.github.com, write the module
    tools/sync-piracy-list.py --tree t.json --commits c.json [--out path]   # from saved API answers (offline, tests)

Stdlib only. Hosts in NOT_COPIED stay out (see there). GH_TOKEN, when set, is sent as Authorization (the anonymous
API limit is 60 calls an hour, shared by everything on the machine).
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

REPO = "cnstr/manifests"
BRANCH = "main"
LIST_DIR = "configs/piracy-list/"
TREE_URL = f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1"
COMMITS_URL = f"https://api.github.com/repos/{REPO}/commits?path={LIST_DIR.rstrip('/')}&sha={BRANCH}&per_page=1"
OUT = Path(__file__).resolve().parent.parent / "web" / "app" / "core" / "piracy-list.js"

# Developers' own pages that Canister lists with no reason given (R23: all four came in with the 2021-12 "migrate
# manifests" import or a batch PR, and nothing in the repo says why). They may once have hosted cracks, or they may
# be mistakes; a warning in front of a well-known developer's repo would do more harm than good, so they stay out
# until someone finds a public reason for them.
NOT_COPIED = {
    "n3d1117.github.io",
    "autopear.github.io",
    "i0ntempest.github.io",
    "filippobiga.me",
}

# Hosts so many people share that a match on them would flag strangers. Canister doesn't list them; if it ever
# did, matching on them (core/warnings.js matches subdomains) would be wrong, so they are refused here too.
SHARED_SUFFIXES = {
    "github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "workers.dev", "herokuapp.com",
    "web.app", "firebaseapp.com", "blogspot.com", "000webhostapp.com", "com", "net", "org", "io", "me", "cn",
}

MIT_NOTICE = """MIT License

Copyright (c) 2022 Aerum LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

HOST = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$")


def api_headers(env=None):
    """Headers for api.github.com. With GH_TOKEN set (tools/release.sh exports the owner's), it goes out as
    Authorization: anonymous calls share a 60-an-hour limit per machine that other agents can use up (HTTP 403)."""
    env = os.environ if env is None else env
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "sync-piracy-list"}
    token = env.get("GH_TOKEN", "").strip()
    if token:
        headers["Authorization"] = "Bearer " + token
    return headers


def fetch_json(url):
    req = urllib.request.Request(url, headers=api_headers())
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def normal_host(name):
    """The host a manifest file name stands for (lower case, no www.), or None when it isn't a host."""
    h = name.strip().lower().rstrip(".")
    if h.startswith("www."):
        h = h[4:]
    return h if HOST.match(h) else None


def hosts_from_tree(tree):
    """(hosts kept, sorted; names skipped as not hosts; hosts left out by NOT_COPIED or SHARED_SUFFIXES)."""
    if tree.get("truncated"):
        raise SystemExit("sync-piracy-list: GitHub truncated the tree; the list would be incomplete")
    kept, bad, left = set(), [], []
    for item in tree.get("tree", []):
        path = item.get("path", "")
        if item.get("type") != "blob" or not path.startswith(LIST_DIR) or "/" in path[len(LIST_DIR):]:
            continue
        name = path[len(LIST_DIR):]
        h = normal_host(name)
        if not h:
            bad.append(name)
        elif h in NOT_COPIED or h in SHARED_SUFFIXES:
            left.append(h)
        else:
            kept.add(h)
    return sorted(kept), bad, sorted(left)


def last_commit(commits):
    c = commits[0] if isinstance(commits, list) and commits else {}
    sha = c.get("sha", "")
    date = ((c.get("commit") or {}).get("committer") or {}).get("date", "")[:10]
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not re.fullmatch(r"\d{4}-\d\d-\d\d", date):
        raise SystemExit("sync-piracy-list: no commit for the list in the API answer")
    return sha, date


def render(hosts, sha, date):
    notice = "\n".join(("// " + line).rstrip() for line in MIT_NOTICE.splitlines())
    lines = [
        "// Generated by tools/sync-piracy-list.py: don't edit, run the script (F228). Canister's piracy list, the hosts in",
        f"// github.com/{REPO} {LIST_DIR} at the commit below, minus the script's NOT_COPIED. core/warnings.js reads it after",
        "// its own entries; nothing here is fetched at runtime.",
        "//",
        "// The list is Canister's, under its MIT license:",
        "//",
        notice,
        "// SPDX-License-Identifier: MIT",
        "",
        f'export const PIRACY_LIST_SOURCE = {{ repo: "https://github.com/{REPO}", path: "{LIST_DIR.rstrip("/")}", commit: "{sha}", date: "{date}" }};',
        "",
        "export const PIRACY_HOSTS = [",
        *[f'  "{h}",' for h in hosts],
        "];",
        "",
    ]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tree", help="a saved answer of " + TREE_URL)
    ap.add_argument("--commits", help="a saved answer of " + COMMITS_URL)
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args(argv)
    tree = json.loads(Path(a.tree).read_text()) if a.tree else fetch_json(TREE_URL)
    commits = json.loads(Path(a.commits).read_text()) if a.commits else fetch_json(COMMITS_URL)
    hosts, bad, left = hosts_from_tree(tree)
    if not hosts:
        raise SystemExit("sync-piracy-list: no hosts found under " + LIST_DIR)
    sha, date = last_commit(commits)
    Path(a.out).write_text(render(hosts, sha, date))
    print(f"sync-piracy-list: {len(hosts)} hosts from {sha[:12]} ({date}) -> {a.out}")
    if left:
        print("  left out: " + ", ".join(left))
    if bad:
        print("  not hosts, skipped: " + ", ".join(bad), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
