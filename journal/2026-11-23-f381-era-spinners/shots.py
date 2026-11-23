#!/usr/bin/env python3
# F381 harness: the real web/app stylesheets, each spinner element as the app builds it, per era and theme; 3x shots.
import subprocess, sys
from pathlib import Path

APP = Path("/home/ryha/runs/iFizBox/s4/web/app")
OUT = Path(sys.argv[1])
SHEETS = ["style.css", "ios6.css", "sources.css", "packages.css", "home.css", "altstore.css", "palettes.css",
          "ios7.css", "ios13.css", "ios26.css"]
BODY = """
<div class="row">
  <div class="hud-scrim" style="position:static;display:inline-grid;padding:0"><div class="hud"><span class="hud-spinner"></span><span class="hud-label">Reloading Data</span></div></div>
  <div class="cell-box"><div class="loading"><span class="loading-spinner"></span><span>Loading</span></div></div>
  <div class="badge-box"><span class="badge spinning"></span></div>
  <div class="bar-box navbar"><span class="bar-button is-reloading"></span></div>
</div>
<div class="reload-bar" style="position:relative;transform:none;bottom:auto;left:auto;right:auto"><span class="reload-spinner"></span><span class="reload-text">Loading data</span></div>
"""
CSS = """
*, *::before, *::after { animation-play-state: paused !important; animation-delay: 0s !important; }
html, body { height: auto !important; overflow: visible !important; }
body { margin: 0; padding: 12px; width: 360px; background: #888 !important; }
.cell-box { padding: 4px 10px; } html[data-theme="light"] .cell-box { background: #fff; } html[data-theme="dark"] .cell-box { background: #000; }
.hud-label { display: none; } .hud { --hud-w: 90px; --hud-pad: 16px; }
.badge-box { background: transparent; }
.row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.badge-box { position: relative; width: 22px; height: 22px; }
.bar-box { position: relative; height: 44px; width: 70px; display: flex; align-items: center; justify-content: center; }
"""
for era in ["ios6", "ios7", "ios13", "ios26"]:
    for theme in ["light", "dark"]:
        name = f"{era}-{theme}"
        links = "".join(f'<link rel="stylesheet" href="file://{APP / s}">' for s in SHEETS)
        html = (f'<!doctype html><html data-style="{era}" data-theme="{theme}"><head><meta charset="utf-8">{links}'
                f'<style>{CSS}</style></head><body>{BODY}</body></html>')
        f = OUT / f"{name}.html"
        f.write_text(html)
        subprocess.run(["chromium", "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=3",
                        "--window-size=384,260", f"--screenshot={OUT / (name + '.png')}", f"file://{f}"],
                       check=True, capture_output=True, timeout=60)
        print(name)
