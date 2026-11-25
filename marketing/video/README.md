# Showcase video

`make.sh` makes the showcase video in one run: the recordings, then the cut.

    marketing/video/make.sh [OUT_DIR]     # default marketing/video/out (gitignored)

It writes `OUT_DIR/rec/` (the recordings), then `OUT_DIR/showcase-4x5.mp4` (1080x1350) and `OUT_DIR/showcase-9x16.mp4`
(1080x1920): 60 fps H.264, about 50 s, no sound.

Needs node 22+, python3, chromium and ffmpeg. No network and no phone: the world is made up (`.example` hosts, names
and icons invented in `make_state.py`), and the app's native bridge is answered in Node by `shell.mjs`.

## The recordings

One continuous session of each build, at 60 fps, 804x1748 (402x874 CSS px at 2x): the Lite build (`lite.mp4`, run with
`--mode sideload`) and the jailbreak build (`jailbreak.mp4`, `--mode jailbreak`). Each writes `rec/<name>.mp4`, with a
`.json` (the marks, the page's look through time and the touches) and a `.txt` (the words on screen at each mark). The
cut is made from these.

The status-bar strip (the top 62 px, the safe-area inset `capture.mjs` sets) is left empty in the recordings, for the
cut to draw.

For a quick check, `node capture.mjs <url> <outdir> <script> --state <dir> --shots` writes one PNG per mark and per
`shot` step without recording video, and `--upto <mark>` stops after that mark. The step list (taps, typing, swipes,
marks, world updates) is in `capture.mjs`'s header.

## The cut

`render.mjs` cuts the recordings with `video.html`, a page drawn on a virtual clock: each frame is `render(t)`, stepped
1/60 s at a time and piped into ffmpeg.

- `render.mjs` unpacks the recordings' frames into `OUT_DIR/frames/` (about 0.5 GB; it can be deleted, and is unpacked
  again when a recording is newer). It serves the repo and `OUT_DIR` on 127.0.0.1, and stops at the first unpack error.
- `video.html` draws the phones (a plain rounded frame, no device artwork, and the status bar: 12:30 and the signal and
  battery marks), the captions, the zooms and the end card. The name and domain come from `web/app/brand.js`.
- `MAP` in `video.html` is the timing: for the `LITE` and `JAIL` tables, each stretch between two marks and the seconds
  the video takes to reach the next one. Some stretches are played faster than the recording. A recording is never cut
  within a build.
- `say()` sets a caption and `build()` the grey line under it that names the build (No jailbreak, Jailbroken).
- The zooms close in on the one phone for the key steps. They are for 4:5 only; 9:16 shows the whole phone.

| File | What it does |
|---|---|
| `make.sh` | the whole run: the made-up world, the app's own icons, a local server on 127.0.0.1, both captures, then both cuts |
| `make_state.py` | the made-up world: AltStore and APT sources, a dpkg status, the update a script can lay over it |
| `capture.mjs` | web/app in headless Chromium with the fake bridge, on the virtual clock; the touches come from `tools/concept/touch.js` |
| `shell.mjs` | the fake native shell: the bridge's answers from the made-up world, with the install and sign waits on the virtual clock |
| `clock.js` | the page's time: Date, timers and animations stand still until `capture.mjs` ticks one frame |
| `finger.js` | what the recording shows of the person holding the phone: a soft touch dot and a plain keyboard |
| `shots-lite.json`, `shots-jailbreak.json` | each recording's script: the steps, in the order `capture.mjs`'s header lists them |
| `render.mjs` | the cut's renderer: unpacks the frames, serves the page, steps its clock and pipes the frames to ffmpeg (H.264, 60 fps, no audio) |
| `video.html` | the cut as one page: the phones, the status bar, the captions (`say()`, `build()`), the timing (`MAP`), the zooms and the end card |

Re-render one cut from the recordings already in `OUT_DIR`:

    node marketing/video/render.mjs marketing/video/out showcase-4x5.mp4 --h 1350
    node marketing/video/render.mjs marketing/video/out showcase-9x16.mp4 --h 1920

Draw stills at some seconds instead of a video (no re-recording; the output name is not used):

    node marketing/video/render.mjs marketing/video/out --h 1350 --still 3,10 --stills <dir>

Don't edit `make.sh` while it runs: `sh` reads a script as it goes.
