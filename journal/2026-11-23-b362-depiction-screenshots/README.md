# B362: Preview misses a developer's depiction pictures

Report: a package's Details page missed screenshots its developer's depiction shows (Aerial, jp.uzra.aerial, on
Havoc's source).

## Reproduction

- Havoc's Aerial stanza has a SileoDepiction (`https://havoc.app/package/aerial/depiction.json`) with a
  DepictionScreenshotsView of four extensionless `media.havoc.app` images.
- Headless Chromium, `capture.mjs` (from the b129 journal) against `node worker/node.mjs` on 127.0.0.1:
  - Jailbreak build (fake bridge, hand-made phone dir with a `havoc.list` and Havoc's real Packages): all four in
    Preview.
  - Sideload build (Havoc added as a Tweak Source through Sources > Add; `app.json`, `sideload.json`): all four.
  - The website cannot add jailbreak sources ("iFizBox adds app sources here"), so it has no Havoc package pages
    (`site.json`).
- iPhone 15 Pro (Lite, iOS 27), through `pymobiledevice3 webinspector cdp` and `phone-eval.mjs`: the gallery image
  settled ready for all four, the Sileo path gave four, and Aerial's page showed Preview with all four
  (screenshot taken). The Sileo JSON path works on current builds; the miss did not reproduce there.
- Chromium cannot say whether real WebKit decodes these 4320x7680 extensionless JPEGs. The phone run shows they
  load there.

## Cause

On the HTML path (`html-shots.mjs`), Havoc's HTML depiction (`https://havoc.app/depiction/aerial`, Next.js) serves
every screenshot as an extensionless `media.havoc.app/<id>?w=3840&q=75`, with a srcset in widths. `isScreenshotUrl`
tested for a file extension, so all of them were dropped and `htmlShots` returned 0.

Chariz's HTML depiction (`chariz.com/buy/deck`) gave its 12 pictures plus the author's avatar
(`img.chariz.cloud/user/profile-image/...?s=32`).

Second cause: a package with a SileoDepiction never looked at its HTML Depiction for pictures (`browse.js` passed
`html: null`). A Sileo depiction without screenshots, or one that failed to load, showed none even when the HTML page
had them.

Sampling: 29 of 30 Havoc Sileo depictions have screenshots through DepictionScreenshotsView. carbridgelegacy has none
in either form. Chariz's deck JSON is fine.

## Fix

- `core/previews.js isScreenshotUrl`: an extensionless URL counts when its `<img>` had a srcset with width
  descriptors (`htmlImgs` sets `responsive`), or its query has image-CDN resize keys (`w`, `width`, `h`, `height`,
  `q`, `quality`, `fm`, `format`, `fit`, `auto`, `dpr`). A `w`/`width`/`h`/`height` under 120 is an icon. Next.js
  `/_next/image?url=` is judged by the wrapped URL. Paths containing `profile-image`, `picture` or `photo` are avatars.
- `screens/browse.js drawPreviews` always passes the HTML depiction. `loadPreviews` still prefers the Sileo/APT
  pictures and falls back to the page only when those are empty.
- Tests in `core/previews.test.js`: Aerial's real JSON and HTML shape (trimmed), and `isScreenshotUrl` cases.

## Checked after the fix

- `htmlShots` gives Aerial's four and Chariz's deck twelve, with no avatar.
- Chromium, jailbreak fake bridge with Aerial's SileoDepiction removed from the stanza (`html-only.json`): all four
  from the HTML page.

## Scripts in this folder

- `capture.mjs`: headless Chromium capture from a step list (copied from b129), at the iPhone 18 Pro's screen size.
  `--native <phone dir>` renders the jailbreak build with a fake bridge answering apt from that phone dir.
- `app.json` (jailbreak), `sideload.json` (sideload, Havoc added through Sources > Add) and `site.json` (website):
  step lists that search for Aerial and capture its Preview.
- `html-only.json`: jailbreak build, Aerial's page with the SileoDepiction removed, so only the HTML page can supply
  pictures.
- `html-shots.mjs`: runs `htmlShots` on saved depiction HTML and prints every `<img>` and the pictures it keeps.
- `phone-eval.mjs`: evaluates one expression in the app's web view on the USB iPhone through the webinspector CDP port.

## Not verified

- Which page or source, and which build, the user saw Aerial without screenshots on. Aerial's Sileo path showed
  them everywhere it was tried (Chromium on both builds, the 15 Pro). If it still happens, the source and build are
  needed.
- The HTML fallback on a real phone: checked in Chromium only. It runs the same web code, with no WebKit-specific step.
- Depiction HTML shapes of other developers beyond Havoc and Chariz.
