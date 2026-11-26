# T85a: new 4:5 video for r/jailbreak

## Result
- `jb-reddit-4x5.mp4`: 1080x1350, 39.7 s (2380 frames), 60 fps, H.264 High, no audio, 3.3 MB (under 20 MB, committed;
  `tools/test_sizeguard.py` has an allowlist line for it).
- `stills/contact-360.jpg`: the video at 360 px wide, one frame every 3 s. `stills/t14.jpg`: one full frame.
- Source: `marketing/video/jb-reddit.html` (the cut), `shots-jb-reddit.json` (the recording's script), `make.sh` (runs
  both after the Lite promo). Re-cut alone: `node marketing/video/render.mjs <out> jb-reddit-4x5.mp4 --h 1350 --page jb-reddit`.

## Flow
Title card 2.8 s (icon, name, "The package manager for your jailbreak"), the phone slides up, then one unbroken take
at 1x: Home, Sources, Add a source (types lamplight.example), the unknown-source prompt (Add & Trust), Search "dock",
Dockshade, Install, Confirm, the install, Complete. Then the phone slides down and the end card slides up.

## Decisions
- Slower than F290's showcase: the recording is 33 s with about 1.5-2.5 s of rest on every screen, typing at 5-7
  characters per second.
- Page changes are the app's own push slide because the recording is the app itself; the cut never cuts inside it,
  never speeds it up, and has no crossfade. Captions switch at the tap, with no fade. The title card and the end card
  move by sliding.
- The install took about 5 s in the fake world, so no wait needed trimming.
- 4:5 only, as the task says; no 9:16.

## Checked
- Stills of the cut at the title, the rise, and every step (sheet in this session), then ffprobe of the final MP4.

## Not verified
- Watching it in real time: smoothness was judged from stills and frame counts, not played.
- Whether a person likes the pace and captions.
- Posting to Reddit: nothing posted.
