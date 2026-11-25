# F440a: record the app for the showcase video

## Result
- `lite.mp4` (53.2 s, 3192 frames) and `jailbreak.mp4` (28.3 s, 1700 frames) in `ref/f440a/` (gitignored, over the 1 MB cap; `marketing/video/make.sh` makes them again), both 60 fps at 804x1748, with
  `lite.json` / `jailbreak.json` (marks, look, touches) and `lite.txt` / `jailbreak.txt` (words on screen at each mark).
- `stills/lite.jpg` and `stills/jailbreak.jpg`: contact sheets of the recordings, to check by eye.

## Flow
- **Lite:** Home > Sources > Add > harbor.example > Add & Trust > Search tide > Tidewell > Install > Confirm > run on
  This iPhone > Return > Changes, pull to refresh > Upgrade (1) > Confirm > run > Home > Theme > iOS 7, 13, 26, Home,
  back, iOS 6 > Home.
- **Jailbreak:** add lamplight.example, search dock, swipe Softdock to queue, Dockshade > Install > Confirm > run to
  Restart SpringBoard.
- The part called Customize in the request is labelled Theme (Style rows) in the current app, so the script taps Theme.

## How
- In-page virtual clock (`clock.js`): nothing moves until `capture.mjs` ticks a frame, so no frame is dropped or
  stretched.
- The finger is driven by `tools/concept/touch.js`, which turns the mouse into the page's touches. `finger.js` draws the
  touch dot and a generic keyboard, since Chromium has none.

## Decisions
- F290's real repos are replaced by made-up ones on `.example` hosts.
- `shots-web.json` is removed: the recordings are of the two builds only.
- Installs use This iPhone, because the Signing Server route needs an iOS prompt we don't fake.
- Match Theme is off: on a phone the Lite build shows an iOS alert on icon change.
- The default Tweak Source, YTMusicUltimate, is left out: it is someone's real project.

## Checked
- ffmpeg per-frame difference scan: the only single-frame cuts are the app's own instant ones (tab switches, era
  switches).
- Contact sheets looked at. Labels are the app's real DOM text (the `.txt` files).

## Not verified
- The iOS 26 style in Chromium uses look-alike bars, a drawn switch, and non-Apple fonts for iOS 13 and 26. The phone
  has the native ones.
- Real-phone timing of downloads and installs: faked and shortened.
- The finger-visible keyboard is ours, not iOS's.
