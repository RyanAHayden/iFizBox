"""Concept F371: era app icons (iOS 7, iOS 13; light and dark), the iFizBox globe redrawn in each era's language.
Writes <out>/<name>.svg and .png (180 px). Flat squares: iOS masks the corners."""
import subprocess, sys, os

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

GRID = """<g clip-path="url(#c)"><g transform="rotate(-16 512 520)" fill="none" stroke="{ink}" stroke-width="{w}" stroke-linecap="round">
<ellipse cx="512" cy="520" rx="126.5" ry="234.6"/>
<path d="M305.7 393.0 Q512 459.3 718.3 393.0"/><path d="M270.7 521.8 Q512 588.1 753.3 521.8"/><path d="M311.9 641.4 Q512 707.7 712.1 641.4"/>
</g></g><circle cx="512" cy="520" r="230" fill="none" stroke="{ink}" stroke-width="{w}"/>"""

def svg(bg, globe_fill, ink, w, extra_defs=""):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs><clipPath id="c"><circle cx="512" cy="520" r="230"/></clipPath>{extra_defs}</defs>
<rect width="1024" height="1024" fill="{bg}"/>
<g transform="translate(512 512) scale(1.45) translate(-512 -520)">
{f'<circle cx="512" cy="520" r="230" fill="{globe_fill}"/>' if globe_fill else ''}
{GRID.format(ink=ink, w=w)}</g></svg>"""

ICONS = {
    # iOS 7: flat, thin lines, the era's sky-to-blue gradient tile (as its Safari, Weather), white hairline globe
    "ios7": svg("url(#g7)", None, "#fff", 14,
                '<linearGradient id="g7" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1ad6fd"/><stop offset="1" stop-color="#1d62f0"/></linearGradient>'),
    # iOS 7 on OLED Black: black tile, the same hairline globe in iOS 7 blue
    "ios7-dark": svg("#000", None, "#1d9bf6", 14),
    # iOS 13: white tile, a solid system-blue globe, white lines at SF regular weight
    "ios13": svg("url(#g13)", "#007aff", "#fff", 24,
                 '<linearGradient id="g13" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#ececf1"/></linearGradient>'),
    # iOS 13 dark: the dark-mode grey tile, the dark-mode blue globe
    "ios13-dark": svg("#1c1c1e", "#0a84ff", "#fff", 24),
}

for name, s in ICONS.items():
    p = os.path.join(out, name + ".svg")
    open(p, "w").write(s)
    subprocess.run(["rsvg-convert", "-w", "180", "-h", "180", p, "-o", os.path.join(out, name + ".png")], check=True)
print("ok", list(ICONS))
