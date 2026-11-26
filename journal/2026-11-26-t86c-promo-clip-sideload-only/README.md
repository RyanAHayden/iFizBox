# T86c: sideload-only promo clip

## Result
- `promo-sideload-4x5.mp4`: 1080x1350, 11.4 MB. `promo-sideload-9x16.mp4`: 1080x1920, 16.6 MB.
- Both: H.264 High, yuv420p, 60 fps, 6417 frames, 106.95 s, no audio. Played at real time (1x), no speed-up.
- Stills checked: `stills/promo-sideload-4x5-t5.png`, `stills/promo-sideload-4x5-t12.png`, `stills/promo-sideload-4x5-t25.png`.
  These stills are from the earlier cut at x1.25 speeds, not the real-time clip, so their timings do not match the current video.
- The X/r/sideloaded post text is T86a's and is untouched here.

## How it's built
Cut from one Lite recording with `promo-sideload.html`, run with `make.sh`. See `../../marketing/video/README.md`,
"The sideload-only clip".

## What failed and was fixed
- The keyboard had no "@" and no digits. Added to `finger.js`: "@" on the email field's "/" key, a number pad for code fields.
- The Home tab keeps the Certificate page open, so the script needs Back before the next tap.
- "Upgrade (2)" appeared when Kiteline was aged before the update. Fixed by aging it afterwards.
- Stills-mode mark times are not real times; a real recording is about 3x longer.
- The first speeds gave a 50 s clip; then every segment was x1.25 (41.5 s). Now every segment is 1x (real time, 106.95 s).

## Not verified
- The Free Apple ID login is simulated: a made-up ID (`taylor@example.com`) and stubbed Apple answers. It was NOT
  filmed on the iPhone 15 with the real ID from `~/.config/ifizbox-appleid`. The cut comes from a virtual-clock Chromium
  recording at 402x874 pt, and a real Apple login (SRP, anisette, a 2FA code only the person can give) cannot run on
  that clock. It would also show a real Apple ID on screen.
- Not recorded on the released 1.0.3 build on a phone. The recording is this commit's web/app with a fake native
  bridge, and its app version label reads 1.0.3.
- The two clips were checked by stills only. No person has played them.
- 4:5 has no zoom, so small text is about 1.28x.
