"""The eras' app icons (Theme > App Icon > Eras): the globe redrawn in iOS 7's and iOS 13's own language, light and
dark. iOS 26's is the Glass icon (icon/glass.py), not drawn here.

  ios7        flat #1ad6fd to #1d62f0 tile (as iOS 7's Safari, Weather), white hairline globe
  ios7dark    black tile, the same hairline globe in iOS 7 blue
  ios13       white tile, a solid #007aff globe, white lines at SF regular weight
  ios13dark   #1c1c1e tile, a #0a84ff globe

Writes icon/era/<name>/<name>.svg (the master, flat and square: iOS masks the corners) and every size icon/themes/<theme>/
has: AppIcon{,Lite}{20x20,29x29,40x40,60x60}@{2x,3x}.png, AppIcon{,Lite}60x60.png and AppIcon{,Lite}1024.png. The
Lite build's carry the LITE sash, web/app/icons/sash-lite.png (tools/icons.sh), as the theme icons do.

    python3 native/icon/era/make.py      (needs rsvg-convert; commit what it writes, then icon/assets.sh)
"""
import base64
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SASH = os.path.join(ROOT, "web", "app", "icons", "sash-lite.png")

GRID = """<g clip-path="url(#c)"><g transform="rotate(-16 512 520)" fill="none" stroke="{ink}" stroke-width="{w}" stroke-linecap="round">
<ellipse cx="512" cy="520" rx="126.5" ry="234.6"/>
<path d="M305.7 393.0 Q512 459.3 718.3 393.0"/><path d="M270.7 521.8 Q512 588.1 753.3 521.8"/><path d="M311.9 641.4 Q512 707.7 712.1 641.4"/>
</g></g><circle cx="512" cy="520" r="230" fill="none" stroke="{ink}" stroke-width="{w}"/>"""


def svg(bg, globe_fill, ink, w, extra_defs="", over=""):
    globe = '<circle cx="512" cy="520" r="230" fill="%s"/>\n' % globe_fill if globe_fill else ""
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            'viewBox="0 0 1024 1024" width="1024" height="1024">\n'
            '<defs><clipPath id="c"><circle cx="512" cy="520" r="230"/></clipPath>%s</defs>\n'
            '<rect width="1024" height="1024" fill="%s"/>\n'
            '<g transform="translate(512 512) scale(1.45) translate(-512 -520)">\n%s%s</g>%s</svg>\n'
            % (extra_defs, bg, globe, GRID.format(ink=ink, w=w), over))


def grad(gid, top, bottom):
    return ('<linearGradient id="%s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/>'
            '<stop offset="1" stop-color="%s"/></linearGradient>' % (gid, top, bottom))


# name -> svg(...) arguments; alternates.ERAS lists the names (light, dark per era)
ICONS = {
    "ios7": ("url(#g7)", None, "#fff", 14, grad("g7", "#1ad6fd", "#1d62f0")),
    "ios7dark": ("#000", None, "#1d9bf6", 14, ""),
    "ios13": ("url(#g13)", "#007aff", "#fff", 24, grad("g13", "#fff", "#ececf1")),
    "ios13dark": ("#1c1c1e", "#0a84ff", "#fff", 24, ""),
}
SIZES = [(pt * s, "%dx%d@%dx" % (pt, pt, s)) for pt in (20, 29, 40, 60) for s in (2, 3)] + [(60, "60x60"), (1024, "1024")]


def sash_layer():
    with open(SASH, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return '<image width="1024" height="1024" xlink:href="data:image/png;base64,%s"/>' % data


def render(svg_text, px, out):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg_text)
    try:
        subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), f.name, "-o", out], check=True)
    finally:
        os.unlink(f.name)


def main():
    sash = sash_layer()
    for name, args in ICONS.items():
        d = os.path.join(HERE, name)
        os.makedirs(d, exist_ok=True)
        plain = svg(*args)
        with open(os.path.join(d, name + ".svg"), "w") as f:
            f.write(plain)
        lite = svg(*args, over=sash)
        for px, tag in SIZES:
            render(plain, px, os.path.join(d, "AppIcon%s.png" % tag))
            render(lite, px, os.path.join(d, "AppIconLite%s.png" % tag))
    print("era icons:", ", ".join(ICONS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
