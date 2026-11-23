#!/usr/bin/env python3
"""Build a UI concept page: the real web/app, live, in a phone frame, as one self-contained HTML file for the
Artifact tool (.claude/skills/concept/SKILL.md says how concepts are made).

    python3 tools/concept/build.py -o concept.html [--app web/app] [--before main | --before none]
                                   [--start '#/sources'] [--title 'More Sources'] [--note 'What changed']
                                   [--mode jailbreak|sideload|site] [--device iphone-16]

--app is the web/app with the concept in it (default: this checkout's); --before is the git ref the before/after
toggle compares with (default main, read with `git archive` from --app's repo; `none` drops the toggle). The page
runs the app in an iframe (srcdoc) beside plain controls: theme (Light Classic by default, every palette), device
size, mode (jailbroken app, Lite sideload app, website) and before/after.

How it fits the Artifact's rules (CSP: no host but a few CDNs, nothing fetched): the app's modules are bundled into
one inline script (tools/concept/esm.py), its CSS and JSON go in as text and its images as data: URIs, and
tools/concept/shell.js stands in for the phone: a fake native bridge or the site's /api/fetch, answered from
tools/concept/sample.py's sample sources, an in-memory localStorage, safe areas per device. The file has no
<html>/<head>/<body> of its own (the Artifact tool wraps it); `--standalone` adds them, for a browser or a test.
Stdlib only.
"""
import argparse
import base64
import io
import json
import re
import subprocess
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import esm  # noqa: E402
import sample  # noqa: E402

ROOT = HERE.parents[1]
MAX_BYTES = 16 * 1024 * 1024
ASSET_MAX = 150 * 1024  # bigger images (the 1024 px icons, og.png) aren't drawn by any screen
ASSET_SKIP = ("icons/launch/", "icons/themes/")
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif"}

# CSS points; sa: the portrait safe areas iOS reports to a full-screen web view; top bar: what sits in the status bar
DEVICES = [
    {"id": "iphone-se", "name": "iPhone SE", "w": 375, "h": 667, "sa": {"top": 20, "right": 0, "bottom": 0, "left": 0},
     "cutout": "none", "radius": 0, "home": "button"},
    {"id": "iphone-14", "name": "iPhone 14", "w": 390, "h": 844, "sa": {"top": 47, "right": 0, "bottom": 34, "left": 0},
     "cutout": "notch", "radius": 47, "home": "bar"},
    {"id": "iphone-16", "name": "iPhone 15 / 16", "w": 393, "h": 852, "sa": {"top": 59, "right": 0, "bottom": 34, "left": 0},
     "cutout": "island", "radius": 55, "home": "bar"},
    {"id": "iphone-17-pro-max", "name": "iPhone 17 Pro Max", "w": 440, "h": 956, "sa": {"top": 62, "right": 0, "bottom": 34, "left": 0},
     "cutout": "island", "radius": 62, "home": "bar"},
    {"id": "ipad-mini", "name": "iPad mini", "w": 744, "h": 1133, "sa": {"top": 24, "right": 0, "bottom": 20, "left": 0},
     "cutout": "none", "radius": 21, "home": "bar", "ipad": True},
]
MODES = [{"id": "jailbreak", "name": "Jailbroken"}, {"id": "sideload", "name": "Lite"}, {"id": "site", "name": "Website"}]

SAFE_AREA = re.compile(r"env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)")


def css_for_frame(text):
    """env(safe-area-inset-*) -> var(--sa-*): an iframe has no safe areas of its own; shell.js sets them per device."""
    return SAFE_AREA.sub(lambda m: f"var(--sa-{m.group(1)}, {m.group(2).strip() if m.group(2) else '0px'})", text)


# A mouse over the phone is a finger (tools/concept/touch.js): no hover, :active only while the finger is down and
# not panning (touch.js sets .concept-active), and the media queries a phone answers. touch.js's matchMedia does
# the same for script.
TOUCH_CSS = [
    (re.compile(r":active(?![\w-])"), ".concept-active"),
    (re.compile(r":hover(?![\w-])"), ":not(*)"),
    (re.compile(r"\(\s*(?:any-)?(?:hover\s*:\s*hover|pointer\s*:\s*fine)\s*\)"), "(max-width: 0px)"),
    (re.compile(r"\(\s*(?:any-)?(?:hover\s*:\s*none|pointer\s*:\s*coarse|hover|pointer)\s*\)"), "(min-width: 0px)"),
]


def touch_css(text):
    for rx, to in TOUCH_CSS:
        text = rx.sub(to, text)
    return text


def script_safe(js):
    """Text that can sit inside an inline <script>: no "</script" or "<!--" in it (both kept equivalent in JS)."""
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.I).replace("<!--", "<\\!--")


def json_safe(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


# ---- reading a web/app tree (a folder, or a git ref)

def tree_from_dir(app):
    out = {}
    for p in sorted(Path(app).rglob("*")):
        if p.is_file():
            out[p.relative_to(app).as_posix()] = p.read_bytes()
    return out


def tree_from_git(repo, ref, sub="web/app"):
    raw = subprocess.run(["git", "-C", str(repo), "archive", "--format=tar", ref, sub], capture_output=True, check=True).stdout
    out = {}
    with tarfile.open(fileobj=io.BytesIO(raw)) as tar:
        for m in tar.getmembers():
            if m.isfile():
                out[m.name[len(sub) + 1:]] = tar.extractfile(m).read()
    return out


def is_module(path):
    return (path.endswith(".js") and not path.startswith(("vendor/", "node_modules/"))
            and not re.search(r"\.test(-helper)?\.js$|test-helper\.js$", path) and path not in ("theme-boot.js", "era-css.js"))


def split_tree(tree):
    """{modules: {path: text}, files: {path: text}, assets: {path: data URI}, html, boot}"""
    modules, files, assets = {}, {}, {}
    for path, data in tree.items():
        suffix = Path(path).suffix.lower()
        if is_module(path):
            modules[path] = data.decode("utf-8")
        elif suffix == ".css":
            files[path] = touch_css(css_for_frame(data.decode("utf-8")))
        elif suffix == ".json" and "/" not in path:
            files[path] = data.decode("utf-8")
        elif suffix in IMAGE_TYPES and path.startswith(("icons/", "img/")) and not path.startswith(ASSET_SKIP) and len(data) <= ASSET_MAX:
            assets[path] = f"data:{IMAGE_TYPES[suffix]};base64,{base64.b64encode(data).decode()}"
    return {"modules": modules, "files": files, "assets": assets,
            "html": frame_html(tree["index.html"].decode("utf-8")), "boot": tree["theme-boot.js"].decode("utf-8")}


def frame_html(html):
    """web/app/index.html as the iframe's document: stylesheets as <style> slots the frame page fills, the module
    script out (the bundle goes in <!--concept-body-->), the shell first in <head> (<!--concept-head-->), no links
    to files the iframe can't load (manifest, icons, launch images)."""
    html = re.sub(r'\s*<link rel="(?:manifest|icon|apple-touch-icon|apple-touch-startup-image)"[^>]*>', "", html)
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', r'<style data-concept-for="\1"></style>', html)
    html = html.replace('<script src="theme-boot.js"></script>', "<!--concept-boot-->")
    # C69: era-css.js writes the era stylesheets in the apps (a fake bridge here too); the frame has the slots always
    html = html.replace('<script src="era-css.js"></script>', "".join(f'<style data-concept-for="{f}"></style>' for f in ("ios7.css", "ios13.css", "ios26.css")))
    html = re.sub(r'\s*<script type="module" src="app.js"></script>', "", html)
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <!--concept-head-->', 1)
    html = html.replace("</body>", "<!--concept-body-->\n</body>", 1)
    for mark in ("<!--concept-head-->", "<!--concept-boot-->", "<!--concept-body-->"):
        if mark not in html:
            raise SystemExit(f"concept: index.html changed shape: no place for {mark}")
    return html


_THUMBS = None


def app_icon_thumbs():
    """{"appicon/<icon>.png": data URI}: the 180 px app icons the native shell serves as appicon/<icon>.png (native/
    build.sh AppIconThumbs), which Theme > App Icon's thumbnails and Home's header load. The jailbreak build's (no
    LITE sash), from this checkout's native/icon (alternates.py thumbs)."""
    global _THUMBS
    if _THUMBS is None:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable, str(ROOT / "native/icon/alternates.py"), "thumbs", tmp], check=True)
            _THUMBS = {f"appicon/{p.name}": "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
                       for p in sorted(Path(tmp).glob("*.png"))}
    return _THUMBS


def pack(tree):
    """A version of the app as the page carries it: each module wrapped for the registry (esm.py)."""
    parts = split_tree(tree)
    parts["assets"].update(app_icon_thumbs())
    wrapped, _ = bundle_modules(parts["modules"])
    return {"modules": wrapped, "files": parts["files"], "assets": parts["assets"], "html": parts["html"],
            "boot": script_safe(parts["boot"])}


def bundle_modules(modules):
    script, infos = esm.bundle(modules, "app.js")  # checks the whole graph
    wrapped = {p: script_safe(esm.wrap(p, *esm.transform(modules[p], p))) for p in modules}
    return wrapped, infos


def diff(after, before):
    """Before as the entries that differ from after (null: not in before)."""
    out = {"html": before["html"] if before["html"] != after["html"] else None,
           "boot": before["boot"] if before["boot"] != after["boot"] else None}
    for key in ("modules", "files", "assets"):
        a, b = after[key], before[key]
        out[key] = {p: v for p, v in b.items() if a.get(p) != v}
        out[key].update({p: None for p in a if p not in b})
    return out


def palettes(app_modules):
    """Theme > Light and Theme > Dark's options, read from core/settings.js."""
    js = app_modules.get("core/settings.js", "")
    out = {}
    for key in ("lightTheme", "darkTheme"):
        m = re.search(r'key:\s*"%s".*?options:\s*\[(.*?)\]\s*,\s*\n\s*footer' % key, js, re.S)
        opts = re.findall(r'value:\s*"([^"]+)",\s*label:\s*"([^"]+)"', m.group(1)) if m else []
        out[key] = [{"value": v, "label": l} for v, l in opts]
    if not out["lightTheme"] or not out["darkTheme"]:
        raise SystemExit("concept: couldn't read the theme lists from core/settings.js")
    out["styles"] = styles(js, out)
    return out


def styles(js, lists):
    """Theme > Style's eras, read from core/settings.js: the style setting's options (its `default` first in the
    Theme menu, with the lightTheme/darkTheme lists as its themes) and STYLE_PALETTES (an era's own theme per tone).
    Each: {value, label, default, own, themes: {light: [{value, label}], dark: [...]}} (own: the era has its own
    themes, not the lists, so the frame stores no lightTheme/darkTheme pick for it). An era's theme is labelled as the
    same value is in the theme lists (oled: OLED Black), else by its value capitalised (white: White)."""
    m = re.search(r'key:\s*"style".*?default:\s*"([^"]+)".*?options:\s*\[(.*?)\]\s*,', js, re.S)
    if not m:
        raise SystemExit("concept: couldn't read Theme > Style's eras from core/settings.js")
    default, opts = m.group(1), re.findall(r'value:\s*"([^"]+)",\s*label:\s*"([^"]+)"', m.group(2))
    own = {}
    pm = re.search(r"STYLE_PALETTES\s*=\s*\{(.*?)\}\s*;", js, re.S)
    for era, body in re.findall(r'(\w+)\s*:\s*\{([^{}]*)\}', pm.group(1) if pm else ""):
        own[era] = dict(re.findall(r'(light|dark)\s*:\s*"([^"]+)"', body))
    known = {o["value"]: o["label"] for o in lists["lightTheme"] + lists["darkTheme"]}
    out = []
    for value, label in opts:
        if value in own:
            if set(own[value]) != {"light", "dark"}:
                raise SystemExit(f"concept: STYLE_PALETTES.{value} in core/settings.js needs a light and a dark theme")
            themes = {t: [{"value": p, "label": known.get(p, p[:1].upper() + p[1:])}] for t, p in own[value].items()}
        else:
            themes = {"light": lists["lightTheme"], "dark": lists["darkTheme"]}
        out.append({"value": value, "label": label, "default": value == default, "own": value in own, "themes": themes})
    if not any(s["default"] for s in out):
        raise SystemExit("concept: Theme > Style's default isn't one of its options in core/settings.js")
    out.sort(key=lambda s: not s["default"])  # stable: the default era first, the rest in the app's order
    return out


def build(app=None, before="main", start="", title="Concept", note="", mode="jailbreak", device="iphone-16",
          standalone=False):
    app = Path(app or ROOT / "web/app").resolve()
    after_tree = tree_from_dir(app)
    after = pack(after_tree)
    before_diff = None
    if before and before != "none":
        repo = subprocess.run(["git", "-C", str(app), "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                              check=True).stdout.strip()
        sub = app.relative_to(repo).as_posix()
        before_diff = diff(after, pack(tree_from_git(repo, before, sub)))
        if not any(before_diff[k] for k in ("modules", "files", "assets")) and not before_diff["html"] and not before_diff["boot"]:
            before_diff = {"same": True}
    modules = {p: t.decode("utf-8") for p, t in after_tree.items() if is_module(p)}
    meta = {
        "title": title, "note": note, "start": start, "mode": mode, "device": device, "before": before if before_diff else None,
        "devices": DEVICES, "modes": MODES, "palettes": palettes(modules),
        "net": sample.net(app), "apt": sample.apt(), "names": sample.names(app),
        "domain": domain(app),
        "version": (ROOT / "native/VERSION").read_text().strip() if (ROOT / "native/VERSION").exists() else "1.0",
        "shell": script_safe((HERE / "shell.js").read_text(encoding="utf-8") + "\n" + (HERE / "touch.js").read_text(encoding="utf-8")),
        "runtime": script_safe(esm.RUNTIME),
    }
    page = (HERE / "frame.html").read_text(encoding="utf-8")
    page = page.replace("{{TITLE}}", html_escape(title))
    data = (f'<script type="application/json" id="concept-meta">{json_safe(meta)}</script>\n'
            f'<script type="application/json" id="concept-after">{json_safe(after)}</script>\n'
            f'<script type="application/json" id="concept-before">{json_safe(before_diff)}</script>\n')
    page = page.replace("<!--{{DATA}}-->", data)
    if standalone:
        page = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n'
                + page + "\n</body></html>\n")
    return page


def domain(app):
    """brand.js's DOMAIN (the website's address in the Safari bar): the name lives in one place (AGENTS.md)."""
    m = re.search(r'export const DOMAIN = "([^"]+)"', (Path(app) / "brand.js").read_text(encoding="utf-8"))
    return m.group(1) if m else ""


def html_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("-o", "--out", required=True, help="the page to write (.html)")
    ap.add_argument("--app", help="the web/app with the concept in it (default: this checkout's)")
    ap.add_argument("--before", default="main", help="git ref for the before/after toggle, or none (default main)")
    ap.add_argument("--start", default="", help="the route the phone opens on, e.g. '#/sources'")
    ap.add_argument("--title", default="Concept", help="the concept's name, shown above the phone")
    ap.add_argument("--note", default="", help="one or two lines on what the concept changes")
    ap.add_argument("--mode", default="jailbreak", choices=[m["id"] for m in MODES], help="the mode it opens in")
    ap.add_argument("--device", default="iphone-16", choices=[d["id"] for d in DEVICES], help="the device it opens on")
    ap.add_argument("--standalone", action="store_true", help="a full HTML document (for a browser or a test)")
    a = ap.parse_args(argv)
    try:
        page = build(a.app, a.before, a.start, a.title, a.note, a.mode, a.device, a.standalone)
    except esm.BundleError as e:
        sys.exit(f"concept: can't bundle web/app:\n{e}")
    size = len(page.encode("utf-8"))
    if size > MAX_BYTES:
        sys.exit(f"concept: the page is {size / 1e6:.1f} MB, over the Artifact's 16 MB")
    Path(a.out).write_text(page, encoding="utf-8")
    print(f"concept: wrote {a.out} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
