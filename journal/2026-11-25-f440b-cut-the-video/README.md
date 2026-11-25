# F440b: cut the showcase video

The user watched the first cut (2026-11-25) and asked for our iOS style background, normal speed, and no constant
jailbroken-or-not subtitle. This is the second cut.

## Result
- `showcase-4x5.mp4` (10.5 MB, 1080x1350) and `showcase-9x16.mp4` (9.5 MB, 1080x1920) in `ref/f440b/` (gitignored),
  both 4282 frames, 71.4 s, ffprobe h264 at 60/1. Not in the journal: the size guard refuses new files over 1 MB.
- `stills/360-wide.jpg`: the 4:5 cut at 360 px wide, every 3 s.
- `stills/4x5.jpg` and `stills/9x16.jpg`: contact sheets, one frame per second, to check by eye.

## Flow
- Opening: two phones on Home, labelled No jailbreak and Jailbroken, under "iFizBox works with or without a jailbreak".
  Both fingers tap Sources; the no-jailbreak phone takes over. The labels stay in the opening only.
- No-jailbreak captions: Add a source / Find an app / Tap Install / And it's on the phone / New version? Tap Upgrade /
  Now it's up to date / Change how it looks /
  This is iOS 7 / iOS 13 / iOS 26 / And back to iOS 6.
- Jailbroken captions: Jailbroken? Add system tweaks / Swipe one to queue it / Add another, install both /
  Both installed. The first is a short caption, not a constant label.
- End card: the name, ifizbox.com, Free, GPL-3.0.

## Decisions
- "Tap Upgrade", not "Tap Update": the button says Upgrade.
- "system tweaks", because the Lite build also adds tweaks to apps, so "tweaks" alone would not tell the builds apart.
- Customize is Theme in the app, as in F440a.
- The jailbreak part starts on Search, since its Sources steps repeat the Lite ones.
- Normal speed: everything plays at 1x. Only cuts shorten the video, and they sit on the install screens, where log
  lines and the bar jump anyway: Lite 21.7-23.0 s and 33.0-35.5 s, jailbreak 23.3-24.4 s of each recording. At normal
  speed that makes 71 s; the user's normal-speed request overrides the 40-50 s target.
- Background: the iOS 6 style's pinstripe from `web/app/ios6.css`. Captions are retimed to the taps.
- Not split into parts, although the brief said so: the rest was three edits to one page, one render and one CONFIRM,
  and split parts would only start after the CONFIRM.
- The recordings were not captured again: unchanged, from F440a.
- Review page: the run page's /concept/F440b, both videos inside, packed to 5.7 and 5.6 MB. It is on claude.ai too, privately:
  https://claude.ai/artifact/MekJsYk1ejwn2QbWRAE6RR

## Failed
- The first stills of the recut failed because one `build()` call was left in `video.html`.
- Editing `make.sh` during its run made `sh` run the jailbreak capture twice. Harmless.
- Rendering before the mp4 was finished gave a truncated unpack. ffmpeg now runs with `-xerror` and `render.mjs` stops
  at the first error, so a short unpack can't pass for a whole one.

## Checked
- Stills through both cuts, from the finished MP4s.
- Captions and labels read at 360 px wide.

## Not verified
- The words inside the phone's own screen are not all readable at 360 px. The 4:5 zooms cover the key steps.
- How it plays on X or other sites: nothing posted.
- Whether a person likes it: asked by CONFIRM.
- Real-phone timing and fonts, as in F440a: Chromium's look-alike iOS 13 and 26 styles.
- Smoothness was judged from the stills and frame counts, not by watching the video in real time.
