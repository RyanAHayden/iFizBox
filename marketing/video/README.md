# Showcase recordings

`make.sh` records the app for the showcase video. It makes recordings only: one continuous session of each build, at
60 fps, 804x1748 (402x874 CSS px at 2x), of the Lite build (`lite.mp4`) and the jailbreak build (`jailbreak.mp4`). Each
recording comes with a `.json` (the marks, the page's look through time and the touches) and a `.txt` (the words on
screen at each mark). The cut is made from these.

    marketing/video/make.sh [OUT_DIR]     # default marketing/video/out (gitignored); writes OUT_DIR/rec/

Needs node 22+, python3, chromium and ffmpeg. No network and no phone: the world is made up (`.example` hosts, names
and icons invented in `make_state.py`), and the app's native bridge is answered in Node by `shell.mjs`.

| File | What it does |
|---|---|
| `make.sh` | the whole run: the made-up world, the app's own icons, a local server on 127.0.0.1, then both captures |
| `make_state.py` | the made-up world: AltStore and APT sources, a dpkg status, the update a script can lay over it |
| `capture.mjs` | web/app in headless Chromium with the fake bridge, on the virtual clock; the touches come from `tools/concept/touch.js` |
| `shell.mjs` | the fake native shell: the bridge's answers from the made-up world, with the install and sign waits on the virtual clock |
| `clock.js` | the page's time: Date, timers and animations stand still until `capture.mjs` ticks one frame |
| `finger.js` | what the recording shows of the person holding the phone: a soft touch dot and a plain keyboard |
| `shots-lite.json`, `shots-jailbreak.json` | each recording's script: the steps, in the order `capture.mjs`'s header lists them |

The Lite recording runs `--mode sideload`, the jailbreak one `--mode jailbreak`. Each writes `rec/<name>.mp4`,
`rec/<name>.json` and `rec/<name>.txt`.

For a quick check, `node capture.mjs <url> <outdir> <script> --state <dir> --shots` writes one PNG per mark and per
`shot` step without recording video, and `--upto <mark>` stops after that mark.

The step list (taps, typing, swipes, marks, world updates) is in `capture.mjs`'s header.

`video.html` and `render.mjs` are the previous video's page and renderer. `make.sh` doesn't run them, and they can't find
the shots of these recordings. The new cut replaces them.

The status-bar strip (the top 62 px, the safe-area inset `capture.mjs` sets) is left empty in the recordings, for the
cut to draw.
