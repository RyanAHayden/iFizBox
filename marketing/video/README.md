# Showcase video

`make.sh` makes the showcase video in one run: the recordings, then the cut.

    marketing/video/make.sh [OUT_DIR]     # default marketing/video/out (gitignored)

It writes `OUT_DIR/rec/` (the recordings), then `OUT_DIR/showcase-4x5.mp4` (1080x1350) and `OUT_DIR/showcase-9x16.mp4`
(1080x1920): 60 fps H.264, about 71 s, no sound. It then makes the promo clips, each in its own section below, as
`OUT_DIR/promo-*.mp4`.

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
  battery marks), the splash, the captions, the zooms and the end card. The background is the
  pinstripe ground of `web/app/ios6.css`, drawn at a 3x phone's size, with its text colours and emboss read from the
  same file. The name and domain come from `web/app/brand.js`.
- The splash (about 3 s) is the app icon, the name and one line. It is whole on the first frame, so that is the poster
  frame too. Then the icon opens into the no-jailbreak phone (`OPEN` in `video.html` is when).
- `MAP` in `video.html` is the timing: `LITE` and `JAIL`, each `{ from, to, cuts }`. Each recording plays at its own
  speed (1x) from mark to mark. Each cut `[from, to]` is in seconds of the recording and drops part of a wait on the
  install screen; nothing is sped up. If the recordings are made again with different timing, check the cuts.
- `say()` sets a caption.
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
| `video.html` | the cut as one page: the splash, the phones, the status bar, the captions (`say()`), the timing (`MAP`), the zooms and the end card |
| `promo.html` | the jailbreak promo clip as one page: captions, timing and end card, cut from `rec/promo.mp4` alone (`render.mjs --page promo`) |
| `shots-promo.json` | the promo recording's script: the jailbreak steps from the Changes badge through Upgrade, Confirm, the install, Complete and Theme |
| `promo-lite.html` | the sideload promo clip as one page: captions, speed segments and the status bar (no end card), cut from `rec/promo-lite.mp4` alone (`render.mjs --page promo-lite`) |
| `shots-promo-lite.json` | the sideload promo recording's script: Add Tweaks, the queue and Confirm, the signed install, the Installed days and Re-sign All |
| `jb-reddit.html` | the r/jailbreak clip as one page: the title card, the phone's slide in and out, the captions, and the end card, cut from `rec/jb-reddit.mp4` alone (`render.mjs --page jb-reddit`) |
| `shots-jb-reddit.json` | the r/jailbreak recording's script: jailbreak mode, adds the Lamplight source, searches "dock", and installs Dockshade through Confirm to the Complete page, with pauses so each screen reads |
| `promo-sideload.html` | the sideload-only clip as one page: a splash, the phone, the captions, the speed segments and the end card, cut from `rec/promo-sideload.mp4` alone (`render.mjs --page promo-sideload`) |
| `shots-promo-sideload.json` | the sideload-only recording's script: the certificate import, the Free Apple ID sign-in, sources and an install, a tweak, the update and Re-sign All |
| `take-free-apple-id.sh` | cuts a phone's screen recording of the Free Apple ID sign-in into `takes/`: `take-free-apple-id.sh RAW.mp4`; the Apple ID is covered, the status bar blanked, Apple's sign-in alert left out |
| `takes/` | the real footage the clips play: `free-apple-id.webm` (the sign-in, filmed on an iPhone) and its `free-apple-id.json` (parts and seconds) |
| `stubs/` | the sideload-only recording's stand-ins, served at `/__video/<file>`: `gsa.js` and `freeroute.js` (Apple's answers, stubbed, off screen), `pick.js` (the iOS Files picker sheet), `profile.js` (a provisioning profile made at the page's "now") |

Re-render one cut from the recordings already in `OUT_DIR`:

    node marketing/video/render.mjs marketing/video/out showcase-4x5.mp4 --h 1350
    node marketing/video/render.mjs marketing/video/out showcase-9x16.mp4 --h 1920

Draw stills at some seconds instead of a video (no re-recording; the output name is not used):

    node marketing/video/render.mjs marketing/video/out --h 1350 --still 3,10 --stills <dir>

Don't edit `make.sh` while it runs: `sh` reads a script as it goes.

## The promo clip

`promo.html` is a second timeline beside `video.html`, for the jailbreak clip: about 16 s, with the same phone, status
bar, captions and end card, drawn from one recording (`rec/promo.mp4`) with its own marks and cuts. Its script is
`shots-promo.json`, run in jailbreak mode by `make.sh`.

`make_state.py --promo` makes its world: Lamplight is already a source and four of its tweaks are installed one release
behind, so Changes has a badge of 4. The fake phone reports iOS 16.5 in jailbreak mode, so Theme offers iOS 6, 7 and 13
only; iOS 26 appears on iOS 26 or later.

Its cuts drop part of the install waits, as the showcase's do; nothing is sped up. The jump from Complete to Home skips
the app's "Loading" reload, so the Changes list in this world still shows the 4 upgrades after the install.

Cut it alone from the recording already in `OUT_DIR/rec/`:

    node marketing/video/render.mjs marketing/video/out promo-4x5.mp4 --h 1350 --page promo
    node marketing/video/render.mjs marketing/video/out promo-9x16.mp4 --h 1920 --page promo

`make.sh` makes both after the showcase cuts, as `OUT_DIR/promo-4x5.mp4` and `OUT_DIR/promo-9x16.mp4`, with its world
in `OUT_DIR/state-promo`.

## The Lite promo clip

`promo-lite.html` is the sideload build's promo clip, about 15.5 s, with captions and a status bar like
`promo.html`'s, and no end card. It is cut from one recording, `rec/promo-lite.mp4` (27.8 s), that is played through speed segments of 1.2x
to 2.6x: faster in the signing runs and the Settings walk. Its script is `shots-promo-lite.json`, run in sideload mode
by `capture.mjs` (rec name `promo-lite`) through the fake native bridge in `shell.mjs`.

The clip adds a tweak from a made-up APT repo, `driftwood.example`, in `make_state.py`. Its one tweak, Night Charts, is
in section Tweaks, and its description names Tidewell, so Add Tweaks lists it under Made for Tidewell. A tweak from a
source shows in Add Tweaks only when its name or description names an app the user has, or a verdict exists. The
script's `{"world": "aging"}` step makes a free certificate that signs for 7 days, and Kiteline (1.8) already signed
with 1 day left, so Re-sign All brings both apps to 7 days. `shell.mjs` takes the re-sign from the phone's record and
keeps the tweak names on the signed record.

The Signed Apps page and the Installed list do not redraw after a Re-sign run, so the script goes Back and opens Signed
Apps again before the last beat.

Cut it alone from the recording already in `OUT_DIR/rec/`:

    node marketing/video/render.mjs marketing/video/out promo-lite-4x5.mp4 --h 1350 --page promo-lite
    node marketing/video/render.mjs marketing/video/out promo-lite-9x16.mp4 --h 1920 --page promo-lite

`make.sh` makes both after the showcase and the jailbreak promo cuts, as `OUT_DIR/promo-lite-4x5.mp4` and
`OUT_DIR/promo-lite-9x16.mp4`.

## The r/jailbreak clip

`jb-reddit.html` is a third timeline page, about 40 s, for the jailbreak build. It is cut from one unbroken recording,
`rec/jb-reddit.mp4` (about 33 s, at 1x, with no cuts and no speed-up). Its script is `shots-jb-reddit.json`, run in
jailbreak mode by `capture.mjs`. The script adds the Lamplight source, searches "dock", and installs Dockshade through
Confirm to the Complete page, with slow pauses so each screen reads.

The pages change with the app's own push slide, because they are captured from the app. Nothing is cut or crossfaded
between them. The cut runs in this order:

- a title card (the icon, the name, and "The package manager for your jailbreak") for 2.8 s;
- the phone slides up, and one caption per step is switched at the tap, with no fades;
- the phone slides down, and the end card slides up.

It is made in 4:5 only: 1080x1350, 60 fps H.264, no sound. `make.sh` makes it after the Lite promo cut, as
`OUT_DIR/jb-reddit-4x5.mp4`. Cut it alone from the recording already in `OUT_DIR/rec/`:

    node marketing/video/render.mjs marketing/video/out jb-reddit-4x5.mp4 --h 1350 --page jb-reddit

## The sideload-only clip

`promo-sideload.html` is the sideload-only (Lite build) clip: 41.5 s, another timeline beside `video.html`,
`promo.html`, `promo-lite.html` and `jb-reddit.html`. It has three parts: a splash (the app icon, the name and "no jailbreak, no
computer"; the icon opens into the phone), then one recording, `rec/promo-sideload.mp4` (103 s raw), then an end card
(the name and the domain). The recording plays through speed segments: `SPEED` in `promo-sideload.html` gives, per
mark, how many times faster it plays up to the next mark (1x to 5x: waits fast, what is read slow), and `FASTER` (1.25)
multiplies all of them to fit the length.

The captions, in order: Import your own certificate / Or sign in with a free Apple ID / Install apps from AltStore
sources / Tweaks, signed on your iPhone / Updates, one tap / Re-sign All, before they expire.

Its script is `shots-promo-sideload.json`, run in sideload mode by `make.sh`. It starts on a fresh phone (`{"phone":
"fresh"}`: no certificate in the fake Keychain) or an aging one (`{"phone": "aging"}`: Kiteline signed 6 days ago):

- Settings > Installation & Signing > Certificate > Import Certificate. The iOS Files picker is drawn by `stubs/pick.js`
  as a sheet, with the app's own icons, steps and `select-files-light.jpg`. The .p12 fixture, a profile made at the
  page's "now" and a password file are put into the file input.
- Remove Certificate.
- Use a Free Apple ID. The sign-in the clip shows is a real one, filmed on an iPhone: `takes/free-apple-id.webm`, made by
  `take-free-apple-id.sh RAW.mp4` from the phone's screen recording (Apple ID covered, status bar blanked, Apple's
  sign-in alert left out). `promo-sideload.html` plays it from mark `free` to `free-done`.
  The recording still runs the stubbed sign-in, off screen, because the later steps need the certificate it imports:
  the script's `override` makes `capture.mjs` serve `stubs/gsa.js` and `stubs/freeroute.js` in place of
  `core/gsa.js` and `core/freeroute.js`; each re-exports the real module from `?real`. The Apple ID there is made up
  (`taylor@example.com`).
- Sources and Install Tidewell, then Add Tweaks (Night Charts).
- The update (a world update) with Upgrade.
- Signed Apps > Re-sign All.

`capture.mjs` gained the script key `override` and the key `liveKeyboard` (the keyboard follows focus through pauses),
the step `{"phone": ...}`, and the path `/__video/<file>`, which serves `stubs/`. `finger.js` has "@" on the email
field's "/" key and a number pad for code fields. `shell.mjs` answers `signing.import`, `signing.remove` and
`device.info`, and its phone status starts with no certificate when fresh. A Free Apple ID's certificate lasts 7 days;
an imported one lasts a year.

The recording's login uses no real Apple ID. The take is the only real sign-in, with its Apple ID covered.

Cut it alone from the recording already in `OUT_DIR/rec/`:

    node marketing/video/render.mjs marketing/video/out promo-sideload-4x5.mp4 --h 1350 --page promo-sideload
    node marketing/video/render.mjs marketing/video/out promo-sideload-9x16.mp4 --h 1920 --page promo-sideload

`make.sh` makes both after the r/jailbreak cut, as `OUT_DIR/promo-sideload-4x5.mp4` and
`OUT_DIR/promo-sideload-9x16.mp4`.
