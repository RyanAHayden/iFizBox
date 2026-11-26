# T85: promo clip for jailbreakers

## Result

- A ~16 s promo clip for jailbreakers, no splash: the jailbreak build is on screen from the first frame. Home with the
  Changes tab badge (4), tap Changes (4 upgrades listed), swipe Dockshade to queue, tap Upgrade (4), the Confirm sheet,
  Confirm, the install progress (apt-style rows), Complete, then Theme: iOS 7, iOS 13, back to iOS 6, and the end card
  (icon, iFizBox, ifizbox.com, Free GPL-3.0).
- Captions in the band: "Updates, with a badge", "Swipe to queue", "Then confirm", "Installing", "Done", "Pick your
  look", "iOS 7", "iOS 13", "Or classic iOS 6".
- `promo-4x5.mp4`: 1080x1350, 1.6 MB. `promo-9x16.mp4`: 1080x1920, 2.2 MB. Both H.264 High, yuv420p, 60 fps, 971 frames,
  16.18 s, no audio. Both are in this folder (under the 20 MB cap, so committed).
- `stills/promo-4x5-t<seconds>.jpg`: six frames of the 4:5 cut at the key beats.
- Source: `marketing/video/` (README there). `make.sh` makes both files into its OUT_DIR.

## How it's built

- `marketing/video/promo.html` is a second timeline beside `video.html`: one recording, its marks and its cuts.
- `marketing/video/shots-promo.json` is the recording's capture script.
- `make_state.py --promo` makes the made-up world: Lamplight is already a source, and 4 of its tweaks are installed one
  release behind, so Changes has a badge of 4.
- `render.mjs --page promo` cuts `promo.html` from `rec/promo.mp4` alone.
- `make.sh` now also makes `OUT_DIR/promo-4x5.mp4` and `OUT_DIR/promo-9x16.mp4` (state in `OUT_DIR/state-promo`).
- The capture is the same fake-bridge Chromium route as the showcase. The fake phone reports iOS 16.5 in jailbreak mode,
  so Theme offers three styles (iOS 6, 7, 13). iOS 26 only appears on iOS 26 or later, which is why "the three themes"
  are 6, 7, 13.
- Cuts: 5.6 s of the install waits are dropped (the progress bars jump, nothing is sped up). The jump from the Complete
  page to Home skips the app's "Loading" reload, so the made-up world's Changes list would still show the 4 upgrades
  after the install, because the fake apt status does not refresh it.

## Posts

The X post (278 characters, with the URL counted as 23):

```text
Jailbroken? iFizBox is a free package manager with the classic iOS 6 look, for rootless jailbreaks (iOS 15+). Updates show as a badge on Changes, swipe a tweak to queue it, tap Confirm. Looks: iOS 6, 7 or 13. Open source (GPL-3.0). Add https://ifizbox.com/repo/ to Sileo or Zebra.
```

The r/jailbreak title:

```text
iFizBox: a free, open-source package manager with the iOS 6 look, for rootless jailbreaks (iOS 15+)
```

The r/jailbreak body:

```text
I've been building iFizBox, a package manager for modern jailbroken iPhones with the classic iOS 6 look. It's free and open source (GPL-3.0).

What it does:

- Browse APT repos and AltStore sources in one catalog, and search across all of them.
- Changes lists what's new and what you can upgrade. The tab shows a badge with the number of upgrades.
- Swipe a row to queue it, then Confirm. Confirm shows the whole queue first (what gets downloaded and what changes), and the install runs through apt.
- Background upgrade checks, and Shortcuts.
- Installs IPAs without signing (AppSync Unified).
- Three looks: iOS 6 (the default), iOS 7 and iOS 13, each with Light and Dark. On iOS 26 or later there's an iOS 26 look too.

How to get it: rootless jailbreaks, iOS 15 and later (iphoneos-arm64). Add this repo in Sileo or Zebra:

https://ifizbox.com/repo/

Or tap Home > "Jailbroken? Install iFizBox" on https://ifizbox.com, or `apt-get install ./iFizBox.deb` from the GitHub releases. It then updates itself like any other package.

Website: https://ifizbox.com
Source and releases: https://github.com/RyanAHayden/iFizBox
Discord: https://discord.gg/3XASvpjbgp

The video shows the sideload build first (for phones without a jailbreak), then the jailbreak app from Search on. It's inspired by the classic iOS 6 package manager and isn't affiliated with it or its author.

Feedback and bug reports are welcome, here or on GitHub.
```

Video choice: X gets the promo clips. Reddit gets the existing 40 s showcase 4x5 in `journal/2026-11-20-f290-showcase-video/`.

The posts are not stored in the repo; the runner shows them to the person. The posts never use the old project's name as ours.

Claims checked against `README.md` and the app: rootless iOS 15+ (iphoneos-arm64); the repo `https://ifizbox.com/repo/` for Sileo and Zebra; the Changes tab badge; swipe to queue; Confirm lists downloads and modifications and the install runs through apt; background upgrade checks and Shortcuts; IPAs install without signing (AppSync Unified); styles iOS 6, 7, 13 with Light and Dark, and iOS 26 on iOS 26 or later; GPL-3.0.

## Checks

- `ffprobe` on both MP4s: as in Result above, no audio stream.
- Contact sheet of the 9:16 cut at 1 fps: the captions match the screen at each beat, and the first frame is the app.
- Push check: n/a.
- `https://sign.ifizbox.com/api/push` answered `enabled:true` today, so the showcase's Push beat no longer needs its caveat.

## Tried and failed

- Showing the Changes list after the install: stale (see the cuts above).
- A 2-swipe queue: cut to one swipe plus Upgrade (4) to fit 15 s.
- A first cut was 29 s, because the recording's real waits are longer than `--shots` mode.
- The Return-to-iFizBox button does not exist in the jailbreak build; the finish button is Restart SpringBoard.

## Not verified

- Not uploaded to X or Reddit (not asked, and not allowed).
- Not watched on a real phone.
- The Artifact page (https://claude.ai/artifact/TCQpUb4DMCxkJqtKaF7vP5): the publisher refuses a file it cannot read whole (the first tries, with 5 MB, 450 KB and 90 KB of embedded video, failed), so the players hold tiny previews (144x256 and 176x220, 10 fps, 17 KB each) and the full-size files are download links. The previews, the Copy buttons and the download links were not tried in the claude.ai viewer.
- `make.sh` was not run end to end (about 15 minutes); its new promo lines are the same commands run by hand, and `sh -n` passes.
- The GitHub raw download links work only after this branch is merged to main.
- X's own processing of the clip.
