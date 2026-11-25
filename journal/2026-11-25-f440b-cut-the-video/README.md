# F440b: cut the showcase video

## Result
- `showcase-4x5.mp4` (8.9 MB, 1080x1350) and `showcase-9x16.mp4` (7.5 MB, 1080x1920) in `ref/f440b/` (gitignored), both
  2985 frames, 49.75 s, ffprobe h264 at 60/1. Not in the journal: the size guard refuses new files over 1 MB.
- `stills/360-wide.jpg`: the 4:5 cut at 360 px wide, every 3 s.
- `stills/4x5.jpg` and `stills/9x16.jpg`: contact sheets, one frame per second, to check by eye.

## Flow
- Opening: two phones on Home, labelled No jailbreak and Jailbroken, under "iFizBox works with or without a jailbreak".
  Both fingers tap Sources; the no-jailbreak phone takes over.
- No-jailbreak captions: Add a source / Find an app / Tap Install / And it's on the phone / New version? Tap Upgrade /
  Now it's up to date / Change how it looks /
  This is iOS 7 / iOS 13 / iOS 26 / And back to iOS 6.
- Jailbroken captions: Jailbroken? Add system tweaks / Swipe one to queue it / Add another, install both /
  Both installed.
- End card: the name, ifizbox.com, Free, GPL-3.0.

## Decisions
- "Tap Upgrade", not "Tap Update": the button says Upgrade.
- "system tweaks", because the Lite build also adds tweaks to apps, so "tweaks" alone would not tell the builds apart.
- Customize is Theme in the app, as in F440a.
- Recordings are never cut within a build; some stretches are played faster (`MAP` in `video.html`).
- The jailbreak part starts on Search, since its Sources steps repeat the Lite ones.

- The build's name stays under the captions, so a viewer who joins late knows which phone it is; the status bar is drawn
  because the recordings leave it empty.
- Review page: the run page's /concept/F440b, both videos inside, packed to 3.6 and 3.3 MB. claude.ai refused a copy (too
  big for its one-shot).

## Failed
- Editing `make.sh` during its run made `sh` run the jailbreak capture twice. Harmless.
- Rendering before the mp4 was finished gave a truncated unpack. ffmpeg now runs with `-xerror` and `render.mjs` stops
  at the first error, so a short unpack can't pass for a whole one.

## Checked
- Stills through both cuts.
- Captions and labels read at 360 px wide.

## Not verified
- The words inside the phone's own screen are not all readable at 360 px. The 4:5 zooms cover the key steps.
- How it plays on X or other sites: nothing posted.
- Whether a person likes it: asked by CONFIRM.
- Real-phone timing and fonts, as in F440a: Chromium's look-alike iOS 13 and 26 styles.
- Smoothness was judged from the stills and frame counts, not by watching the video in real time.
