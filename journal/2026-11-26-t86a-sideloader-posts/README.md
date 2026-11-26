# T86a: Sideloader posts page

## Result
- The T86 Artifact page (same URL, https://claude.ai/artifact/9n5ZYu6bfeZPwHSVXRgnQC) now has the T86c clips:
  9:16 (16.6 MB) and 4:5 (11.4 MB) from `journal/2026-11-26-t86c-promo-clip-sideload-only/`, as 8 fps previews
  (108x192, 144x180) plus raw.githubusercontent.com download links (work once merged to main).
- X text and r/sideloaded title and body say "your own certificate or a free Apple ID"; one Copy button per block.
- r/sideloaded now uses the new 4:5 clip (106.95 s) instead of the 40 s showcase.

## Rework: real time
- The user found the clip far too sped up. Every SPEED and FASTER in `marketing/video/promo-sideload.html` is now 1.
- Tightened pauses in `marketing/video/shots-promo-sideload.json`: picker 1700->1300, importing 1600->1200,
  certificate Expires 1200->800, swipe 900->600, second Add & Trust 2500->1500, final 1800->1200. Re-recorded:
  103.4 s -> 100.85 s raw.
- Re-rendered 4:5 and 9:16: 106.95 s each, 60 fps, 11.4 MB and 16.6 MB, into
  `journal/2026-11-26-t86c-promo-clip-sideload-only/` (replacing the earlier files).
- Checked 1x: raw recording frames at 30, 60 and 85 s match output frames at +2.8 s (same app state; the offset is the splash).
- Page https://claude.ai/artifact/9n5ZYu6bfeZPwHSVXRgnQC re-published with 8 fps previews and the new sizes.

## Not verified
- Not played on a phone; Copy buttons not tried in the Artifact viewer (same script as the earlier page).
- The download links 404 until this work is on main.
- The clip's Free Apple ID login is simulated (see T86c journal); F445 films the real one.
- The 107 s clip is a little over the 100 s guide.
