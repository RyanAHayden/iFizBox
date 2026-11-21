"""The concept page's sample data: what the app finds on its fake phone (tools/concept/shell.js).

Everything comes from fixtures already in the repo, so the page needs no network and no device:

- the jailbreak app's apt state: native/fake/fixture's sources.list.d and dpkg status (the node tests' fake phone),
  plus Chariz; each repo's Release and Packages come from native/fake/fixture/remote and web/app/core/fixtures;
- AltStore sources: web/app/core/fixtures/sources/*.json at the URLs of the real sources they were taken from,
  and the site's own source (web/app/source.json) at /repo/source.json.

A source the sample hasn't got answers a made-up empty one (shell.js netAnswer), named after core/recommended.js's
entry when it has one, so adding a recommended source in a concept works.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "native/fake/fixture"
SRC = ROOT / "web/app/core/fixtures/sources"


def _text(p):
    return Path(p).read_text(encoding="utf-8")


# URL -> fixture file (relative to the repo)
ALTSTORE = {
    "https://apps.altstore.io/": SRC / "altstore-classic.json",
    "https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json": SRC / "feather.json",
    "https://github.com/LiveContainer/LiveContainer/releases/download/1.0/apps.json": SRC / "livecontainer.json",
    "https://community-apps.sidestore.io/sidecommunity.json": SRC / "sidestore-community.json",
    "https://stikdebug.xyz/index.json": SRC / "stikstore.json",
    "https://alt.getutm.app": SRC / "trollapps-utm.json",
}

APT = {
    "https://apt.procurs.us/dists/1800/Release": FIX / "remote/lists/apt.procurs.us_dists_1800_Release",
    "https://apt.procurs.us/dists/1800/main/binary-iphoneos-arm64/Packages":
        FIX / "remote/lists/apt.procurs.us_dists_1800_main_binary-iphoneos-arm64_Packages",
    "https://havoc.app/Release": FIX / "remote/lists/havoc.app_._InRelease",
    "https://havoc.app/Packages": FIX / "remote/lists/havoc.app_._Packages",
    "https://concept.sample/repo/Release": SRC / "concept-tweaks-Release",
    "https://concept.sample/repo/Packages": SRC / "concept-tweaks-Packages",
    "https://repo.chariz.com/Release": SRC / "apt-flat-Release",
    "https://repo.chariz.com/Packages": SRC / "apt-flat-Packages",
}

CHARIZ_LIST = "# Chariz, flat\ndeb https://repo.chariz.com/ ./\n"


def net(app_dir):
    """URL -> {type, text} for the shell's net.fetch and the site's /api/fetch."""
    out = {}
    for url, p in ALTSTORE.items():
        out[url] = {"type": "application/json", "text": _text(p)}
    for url, p in APT.items():
        out[url] = {"type": "text/plain", "text": _text(p)}
    own = Path(app_dir) / "source.json"
    dom = re.search(r'export const DOMAIN = "([^"]+)"', (Path(app_dir) / "brand.js").read_text(encoding="utf-8"))
    if own.exists() and dom:
        out[f"https://{dom.group(1)}/repo/source.json"] = {"type": "application/json", "text": own.read_text(encoding="utf-8")}
    return out


def apt():
    """{sources: [{path, text}], status: text} as the shell's apt.sources and apt.dpkgStatus answer them."""
    d = FIX / "prefix/etc/apt/sources.list.d"
    sources = [{"path": "/var/jb/etc/apt/sources.list.d/" + p.name, "text": _text(p)}
               for p in sorted(d.iterdir()) if p.suffix in (".list", ".sources")]
    sources.append({"path": "/var/jb/etc/apt/sources.list.d/chariz.list", "text": CHARIZ_LIST})
    return {"sources": sources, "status": _text(FIX / "prefix/var/lib/dpkg/status")}


def names(app_dir):
    """core/recommended.js's sources: URL -> {name, jailbreak}, for the made-up answers."""
    out = {}
    js = (Path(app_dir) / "core/recommended.js")
    if not js.exists():
        return out
    for m in re.finditer(r'\{\s*kind:\s*"source",\s*name:\s*"([^"]+)",[^}]*?\burl:\s*"([^"]+)"([^}]*)\}', js.read_text(encoding="utf-8")):
        out[m.group(2)] = {"name": m.group(1), "jailbreak": "jailbreak: true" in m.group(3)}
    return out


if __name__ == "__main__":
    print(json.dumps({"net": sorted(net(ROOT / "web/app")), "apt": [s["path"] for s in apt()["sources"]]}, indent=1))
