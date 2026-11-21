#!/usr/bin/env python3
"""iFizBox's own AltStore source (I7): web/app/source.json, the package page iFizBox's default sources show for the
app itself (first in web/app/app-sources.json, as "/repo/source.json"; core/appoffer.js APP_SOURCE_URL). F178: published at
https://<BRAND_DOMAIN>/repo/source.json (SOURCE_URL; the Worker's /repo route serves the latest release's copy),
beside iFizBox's APT repo at https://<BRAND_DOMAIN>/repo/.

  tools/altsource.py update VERSION IPA [DATE] [--notes FILE] [--minimum X.Y.Z]
        point the source at release vVERSION's iFizBox.ipa (its size from IPA), newest first in versions[], the
        versions already listed kept below it (at most KEEP; F180: only those whose IPA is iFizBox.ipa), with the
        notes' first lines as its description
  tools/altsource.py check                       the source is well formed and names a release tag of its own version

tools/release.sh runs `update` when it publishes a release, so the source keeps naming the newest IPA. F72: this is
the sideload app's and the site's built-in source (web/app/core/essential.js). --minimum sets the app's
"minimumVersion", iFizBox's own field (other AltStore clients ignore it): a running iFizBox older than that must
upgrade before anything else.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "native"))
from brand import BRAND, NAME  # noqa: E402  (F170: native/brand.env)
SOURCE = os.path.join(ROOT, "web", "app", "source.json")
REPO = f"https://github.com/{BRAND['BRAND_GITHUB_REPO']}"
# F178: the source and its icon at the site (brand.env BRAND_DOMAIN): the Worker's /repo/source.json answers with the
# latest release's source.json (the deployed web/app/source.json when GitHub fails), and web/app/icons/ are the
# site's own assets.
SITE = f"https://{BRAND['BRAND_DOMAIN']}"
SOURCE_URL = f"{SITE}/repo/source.json"
ICON_URL = f"{SITE}/icons/icon-180.png"
BUNDLE_ID = BRAND["BRAND_BUNDLE_ID"]
MIN_OS = "15.0"  # native/mkipa.py's MinimumOSVersion
KEEP = 20  # versions[] entries kept (newest first)
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def ipa_url(version):
    return f"{REPO}/releases/download/v{version}/{NAME}.ipa"


def is_own_ipa(entry):
    """F180: a versions[] entry whose downloadURL is its release's {NAME}.ipa. The releases before v0.9.4 carry
    the IPA under the old name; `update` drops those entries (no old asset names, user 2026-11-18)."""
    return str(entry.get("downloadURL")) == ipa_url(entry.get("version"))


def note_text(version, notes=None):
    """The version's description: the notes' first lines (Markdown bullets and headings off), then the link."""
    link = f"Release notes: {REPO}/releases/tag/v{version}"
    lines = []
    for raw in (notes or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("<!--"):
            continue
        lines.append(re.sub(r"^[-*+]\s+", "", line))
        if len(lines) >= 4:
            break
    return "\n".join(lines + [link]) if lines else f"{NAME} {version}. {link}"


def build(version, size, date, notes=None, minimum=None, previous=()):
    """The whole source for release vVERSION; `previous`: the versions[] entries already published (kept below)."""
    if minimum is not None and not VERSION_RE.match(minimum):
        raise ValueError(f"minimum must be X.Y.Z, not {minimum!r}")
    newest = {
        "version": version,
        "date": date,
        "localizedDescription": note_text(version, notes),
        "downloadURL": ipa_url(version),
        "size": size,
        "minOSVersion": MIN_OS,
    }
    older = [v for v in previous if isinstance(v, dict) and v.get("version") != version and is_own_ipa(v)][:KEEP - 1]
    app = app_entry([newest] + older)
    if minimum:
        app["minimumVersion"] = minimum
    return source_entry(app)


def source_entry(app):
    return {
        "name": NAME,
        "identifier": BUNDLE_ID,
        "subtitle": "A package manager with the iOS 6 look",
        "description": f"{NAME}'s own source: the {NAME} app for iPhones without a jailbreak.",
        "sourceURL": SOURCE_URL,
        "iconURL": ICON_URL,
        "website": REPO,
        "tintColor": "#37a94a",
        "apps": [app],
        "news": [],
    }


def app_entry(versions):
    return {
        "name": NAME,
        "bundleIdentifier": BUNDLE_ID,
        "developerName": "Ryan Hayden",
        "subtitle": "Packages and apps with the iOS 6 look",
        "localizedDescription": (
            f"{NAME} lists apps from AltStore-style sources and, on a jailbroken iPhone, tweaks and themes from "
            "APT repos, with the iOS 6 look. The app signs apps on your iPhone with your own certificate (no "
            "server) and scrolls at 120Hz. Free and open source (GPL-3.0-or-later)."),
        "iconURL": ICON_URL,
        "tintColor": "#37a94a",
        "category": "utilities",
        "screenshots": screenshots(),
        "versions": versions,
    }


# The app page's gallery: the README's phone-framed shots (docs/img/web-*.png and jb-*.png, each with its caption
# in the picture), in README order, none of its cropped pictures (crop-*.png). Listed in the source so the app page
# never falls back to the README's images (web/app/core/previews.js readmeShots). raw.githubusercontent.com loads
# from the phone; the site doesn't serve docs/. A fixed list, not read from the README at run time (release tests
# run this from a partial copy of the repo); tools/test_altsource.py keeps it equal to the README and docs/img.
SHOTS_BASE = f"https://raw.githubusercontent.com/{BRAND['BRAND_GITHUB_REPO']}/HEAD/docs/img/"
SHOT_NAMES = (
    "jb-home.png", "jb-package.png", "jb-log.png", "web-home.png", "web-sources.png", "web-app.png",
    "web-changes.png", "jb-sources.png", "web-search.png", "web-installed-manage.png", "web-myipas.png",
    "web-theme.png", "web-manage.png", "web-settings.png", "web-signing.png", "jb-installed.png",
)
SHOT_SIZE = (588, 1254)  # every phone-framed shot's PNG size


def screenshots():
    width, height = SHOT_SIZE
    return [{"imageURL": SHOTS_BASE + name, "width": width, "height": height} for name in SHOT_NAMES]


def rebrand(data):
    """The published source with today's name and descriptions (F170, native/brand.py sync); versions[] and
    minimumVersion as they are: old release notes keep the name they shipped under."""
    app = (data.get("apps") or [{}])[0]
    fresh = app_entry(app.get("versions") or [])
    if "minimumVersion" in app:
        fresh["minimumVersion"] = app["minimumVersion"]
    out = source_entry(fresh)
    out["news"] = data.get("news", [])
    return out


def check(data):
    """Problems with a loaded source, as a list of strings (empty when it's fine)."""
    problems = []
    apps = data.get("apps") if isinstance(data, dict) else None
    if not isinstance(apps, list) or len(apps) != 1:
        return ["one app expected"]
    app = apps[0]
    if data.get("sourceURL") != SOURCE_URL:
        problems.append(f"sourceURL is not {SOURCE_URL}")
    if app.get("bundleIdentifier") != BUNDLE_ID:
        problems.append(f"bundleIdentifier is not {BUNDLE_ID}")
    versions = app.get("versions") or []
    if not versions:
        return problems + ["no versions"]
    v = versions[0]
    # F180a: exactly that release's {NAME}.ipa (every release from v0.9.4 carries it under that name).
    if str(v.get("downloadURL")) != ipa_url(v.get("version")):
        problems.append(f"downloadURL is not release v{v.get('version')}'s {NAME}.ipa")
    if not isinstance(v.get("size"), int) or v["size"] <= 0:
        problems.append("size is not a positive number of bytes")
    if v.get("minOSVersion") != MIN_OS:
        problems.append(f"minOSVersion is not {MIN_OS}")
    if "minimumVersion" in app and not VERSION_RE.match(str(app["minimumVersion"])):
        problems.append("minimumVersion is not X.Y.Z")
    return problems


def write(data, path=SOURCE):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def main(argv):
    if len(argv) >= 3 and argv[0] == "update":
        opts, rest = {}, []
        it = iter(argv[1:])
        for a in it:
            if a in ("--notes", "--minimum", "--source"):
                opts[a] = next(it, None)
            else:
                rest.append(a)
        version, ipa = rest[0], rest[1]
        date = rest[2] if len(rest) > 2 else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        path = opts.get("--source") or SOURCE
        notes = None
        if opts.get("--notes"):
            with open(opts["--notes"]) as f:
                notes = f.read()
        try:
            with open(path) as f:
                previous = json.load(f)["apps"][0].get("versions") or []
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            previous = []
        try:
            data = build(version, os.path.getsize(ipa), date, notes=notes, minimum=opts.get("--minimum"),
                         previous=previous)
        except ValueError as e:
            print(f"altsource: {e}", file=sys.stderr)
            return 1
        write(data, path)
        print(f"{path}: v{version}")
        return 0
    if argv == ["check"]:
        with open(SOURCE) as f:
            problems = check(json.load(f))
        for p in problems:
            print(p, file=sys.stderr)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
