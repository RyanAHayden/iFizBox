# T86: promo clip for sideloaders

## Result

- A ~15.5 s promo clip for the Lite build (no jailbreak, no computer). Frame 1 is the app, on Tidewell's Details page:
  no splash, no end card. Then Add Tweaks > ADD on Night Charts, Installed > Queue > Confirm, the phone signs Tidewell
  with the tweak, the Installed list shows the days left, Home > Settings > Installation & Signing > Signed Apps >
  Re-sign All > Confirm, and Signed Apps again with both apps at 7 days.
- Captions in the band: "Pick a tweak from a repo", "Signed on your iPhone", "Days left on every app", "Re-sign All,
  before they expire", "No computer. No jailbreak."
- The clip: H.264 High, yuv420p, 60 fps, 929 frames, 15.483 s, no audio stream.

| File | What it is |
|---|---|
| `promo-lite-4x5.mp4` | 1080x1350, 1.7 MB |
| `promo-lite-9x16.mp4` | 1080x1920, 2.5 MB |
| `stills/promo-lite-4x5-t0.jpg`, `-t2.5`, `-t6`, `-t10`, `-t14` | five frames of the 4:5 cut at the key beats |

- Source: `marketing/video/` (README there). `make.sh` makes both MP4s into its OUT_DIR.

## How it's built

- One recording of 27.8 s, `promo-lite` (`shots-promo-lite.json`, run by `capture.mjs` in sideload mode, with the fake
  native bridge in `shell.mjs`). The cut is `marketing/video/promo-lite.html` (`render.mjs --page promo-lite`): the
  recording is played through speed segments, 1.2x to 2.6x, faster in the signing runs and the Settings walk. The
  captions sit in the band, on the same pinstripe ground and status-bar strip as `video.html`.
- The made-up world (`make_state.py`) has a third APT repo, `driftwood.example`, with one tweak, Night Charts 1.0, in
  section Tweaks. Its description names Tidewell, so Add Tweaks lists it under Made for Tidewell. The .deb files are real
  (ar, control.tar.gz and data.tar.gz holding a placeholder dylib and a filter plist). The four Lamplight tweaks have
  .deb files too, built for any app.
- `shell.mjs` takes a Re-sign from the phone's record (`signing.prepare` with `record`) and keeps the tweak names on the
  signed record. The script's `{"world": "aging"}` step makes a free certificate that signs for 7 days, and Kiteline
  (1.8) already signed with 1 day left. Re-sign All in that world gives 7 days for both.
- `make.sh` runs the promo clip after the showcase and the jailbreak promo, as `OUT_DIR/promo-lite-4x5.mp4` and
  `OUT_DIR/promo-lite-9x16.mp4`.

## Posts

The X post (about 250 characters; video: the 9:16 or 4:5 clip):

```text
Tweaks without a jailbreak, signed on your phone.

iFizBox Lite injects tweaks from Havoc or BigBoss into an app and signs it on the iPhone with your own certificate. No computer. Re-sign before expiry, push alerts for updates.

All in the iOS 6 look -> ifizbox.com
```

The r/sideloaded post (video: the existing 40 s 4:5 showcase, `journal/2026-11-20-f290-showcase-video/showcase-4x5.mp4`).

Title:

```text
iFizBox Lite: sign apps and inject tweaks on the phone, no computer, no jailbreak
```

Body:

```text
iFizBox Lite signs apps on the iPhone itself, with your own certificate. No computer, no jailbreak.

- AltStore sources, plus tweaks from APT repos (Havoc, BigBoss) injected into the apps you sign. ElleKit is bundled, and paid Havoc tweaks work with your repo account.
- Your own .deb, .dylib or .framework works too, and the tweaks stay through re-signs.
- Days left on every app, Re-sign All, and push alerts for app updates.
- All of it in the iOS 6 look.

Try it: open ifizbox.com in Safari, add your certificate in Settings > Signing, then tap Home > Install iFizBox Lite. (The website alone can also sign and install apps in the browser.)

Source: github.com/RyanAHayden/iFizBox (GPL-3.0)
```

Claims checked against `README.md` (Havoc, BigBoss, ElleKit, paid tweaks with the Havoc account, own .deb/.dylib/.framework,
tweaks stay when re-signed) and the app. "Settings > Signing" is the website's wording (in the app it is Settings >
Installation & Signing > Certificate); the steps are done on the website.

- Delivery: one Needs-you item with one Artifact page: small 108x192 and 144x180 previews at 8 fps inline, and the full
  MP4s as GitHub raw download links:
  `https://raw.githubusercontent.com/RyanAHayden/iFizBox/main/journal/2026-11-26-t86-promo-clip-sideload/promo-lite-9x16.mp4`
  and `.../promo-lite-4x5.mp4`, and
  `https://raw.githubusercontent.com/RyanAHayden/iFizBox/main/journal/2026-11-20-f290-showcase-video/showcase-4x5.mp4`.
  Copy buttons on each text block.

## Checks

- `ffprobe` on both MP4s: h264 High, yuv420p, 60/1, 929 frames, 15.483 s, no audio stream.
- Contact sheet at 1 fps: the captions match the screen at each beat, the first frame is the app, and the end shows both
  apps at 7 days.

## Tried and failed

- A tweak from a source shows in Add Tweaks only when its name or description names an app the user has (or a verdict
  exists). The existing Lamplight tweaks never showed, which is why the repo is driftwood.example.
- The Signed Apps page and the Installed list do not redraw after a Re-sign run: they showed 1 day after it. So the clip
  ends by going Back and opening Signed Apps again.
- The Installed row's "1 Tweak" pill is not drawn on Tidewell in the recording (the subtitle is cut at the end by the
  date, though the record does carry the tweak), so the clip does not show the tweak count.
- The first cut was 25 s. The runs were sped up to fit.
- A first `promo.html` name clashed with the jailbreak promo's page, so this one is `promo-lite.html`. Main was merged
  into the branch.

## Not verified

- Not uploaded to X or Reddit.
- Not watched on a real phone.
- The Artifact page's previews, Copy buttons and download links were not tried in the claude.ai viewer.
- The GitHub raw links work only after the branch is merged to main.
- `make.sh` was not run end to end; its new lines are the same commands run by hand.
- The fake bridge's Re-sign All path is a stand-in; the real phone's signing was not run.
- X's own processing of the clip.
