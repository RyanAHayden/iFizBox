#!/usr/bin/env python3
# F381 harness: the real web/app stylesheets with each spinner's markup as the app builds it, per era and theme, shot
# by headless Chromium at deviceScaleFactor 3 (animations paused at frame 0), then the spinners cropped and zoomed 4x.
#   python3 journal/2026-11-23-f381-era-spinners/shots.py WEB_APP_DIR OUT_DIR      (needs Pillow and chromium)
import subprocess, sys
from pathlib import Path
from PIL import Image

APP, OUT = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
SHEETS = ["style.css", "ios6.css", "sources.css", "packages.css", "home.css", "altstore.css", "palettes.css",
          "ios7.css", "ios13.css", "ios26.css"]
BODY = """
<div class="row">
  <div class="hud-scrim" style="position:static;display:inline-grid;padding:0"><div class="hud"><span class="hud-spinner"></span><span class="hud-label">Reloading Data</span></div></div>
  <div class="cell-box"><div class="loading"><span class="loading-spinner"></span><span>Loading</span></div></div>
  <div class="badge-box"><span class="badge spinning"></span></div>
</div>
<div class="row">
  <div class="bar-box navbar"><span class="bar-button is-reloading"></span></div>
  <div class="pull-box cell-box"><div class="pull-clip on"><div class="pull-refresh refreshing"><div class="pull-inner"><span class="pull-arrow"></span><span class="pull-spinner"></span><span class="pull-text"><b class="pull-title">Refreshing...</b></span></div></div></div></div>
</div>
<div class="reload-bar" style="position:relative;transform:none;bottom:auto;left:auto;right:auto"><span class="reload-spinner"></span><span class="reload-text">Loading data</span></div>
"""
CSS = """
*, *::before, *::after { animation-play-state: paused !important; animation-delay: 0s !important; }
html, body { height: auto !important; overflow: visible !important; }
body { margin: 0; padding: 12px; width: 360px; background: #888 !important; }
.row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.cell-box { padding: 4px 10px; } html[data-theme="light"] .cell-box { background: #fff; } html[data-theme="dark"] .cell-box { background: #000; }
.hud-label { display: none; } .hud { --hud-w: 90px; --hud-pad: 16px; }
.badge-box { position: relative; width: 22px; height: 22px; }
.bar-box { position: relative; height: 44px; width: 70px; display: flex; align-items: center; justify-content: center; }
.pull-box { position: relative; width: 200px; height: 60px; padding: 0; }
.pull-box .pull-clip { inset: 0; } .pull-box .pull-refresh { height: 60px; transform: none; }
"""
ERAS, THEMES = ["ios6", "ios7", "ios13", "ios26"], ["light", "dark"]
for era in ERAS:
    for theme in THEMES:
        name = f"{era}-{theme}"
        links = "".join(f'<link rel="stylesheet" href="{(APP / s).as_uri()}">' for s in SHEETS)
        f = OUT / f"{name}.html"
        f.write_text(f'<!doctype html><html data-style="{era}" data-theme="{theme}"><head><meta charset="utf-8">{links}'
                     f'<style>{CSS}</style></head><body>{BODY}</body></html>')
        subprocess.run(["chromium", "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=3",
                        "--window-size=384,330", f"--screenshot={OUT / (name + '.png')}", f.as_uri()],
                       check=True, capture_output=True, timeout=60)
shots = {(e, t): Image.open(OUT / f"{e}-{t}.png").convert("RGB") for e in ERAS for t in THEMES}
w, h = shots["ios6", "light"].size
grid = Image.new("RGB", (w * 2, h * 4))
for i, (e, t) in enumerate(shots):
    grid.paste(shots[e, t], ((i % 2) * w, (i // 2) * h))
grid.save(OUT / "eras-3x.png")
# zoomed: each spinner cropped from the 3x shot (centres in 3x pixels, read off the layout above) and every pixel
# drawn 3x3; one row per era and theme: HUD, loading row, tab badge, Home's Reload, pull to refresh, reload bar
CROPS = [(171, 198, 66), (468, 198, 40), (866, 195, 40), (141, 465, 40), (420, 486, 40), (102, 678, 40)]
Z = 3
tiles = [[shots[k].crop((x - r, y - r, x + r, y + r)).resize((2 * r * Z, 2 * r * Z), Image.NEAREST) for x, y, r in CROPS]
         for k in shots]
zw, zh = sum(t.width for t in tiles[0]) + 8 * len(CROPS), max(t.height for t in tiles[0]) + 8
zoom = Image.new("RGB", (zw, zh * len(tiles)), (190, 0, 0))
for row, ts in enumerate(tiles):
    x = 0
    for t in ts:
        zoom.paste(t, (x, row * zh + (zh - 8 - t.height) // 2))
        x += t.width + 8
zoom.save(OUT / "eras-zoomed.png")
print("wrote", OUT / "eras-3x.png", OUT / "eras-zoomed.png")
