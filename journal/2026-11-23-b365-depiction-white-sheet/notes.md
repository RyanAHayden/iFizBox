# B365: the Depiction row opens a blank white sheet

## What changed

`openHtmlDepiction` (web/app/screens/browse.js) now fetches the depiction first (through the proxy on the site, through
the shell's `net.fetch` in the app), shows "Loading Depiction" meanwhile, and `depictionView` picks one of three views:

- **refused**: the host forbids framing (`X-Frame-Options` other than ALLOWALL, or a CSP `frame-ancestors` that leaves
  our origin out; `frame-ancestors` wins when both are sent). The sheet says "<host> doesn't let its depiction open
  inside iFizBox." with an **Open in Safari** row (`window.open`, which the shell's LinkOut sends to Safari).
- **static**: the page's own HTML as srcdoc with scripts off (with `<base>`): an http page on the https site (as
  before), or a page whose scripts load in CORS mode (`type="module"` or `crossorigin`) and which has server-rendered
  text (40+ characters). In the sandbox's opaque origin those scripts can't load from a host that doesn't send
  `Access-Control-Allow-Origin` for `null`, so scripts off gives the same page with nothing left to blank it. Havoc's
  depictions (Next.js, module chunks with `crossorigin`) take this path.
- **live**: everything else loads from its own URL with scripts on, as before (jQuery-era depictions read `location`).

A failed fetch shows its error and the same Open in Safari row. The sandbox never gets `allow-same-origin` (the
bridge rule); the test checks that too.

## Findings

- Havoc (`https://havoc.app/depiction/aerial`) sends no `X-Frame-Options`; its module chunks
  (`/_next/static/chunks/*.js`, `crossorigin`) get no `Access-Control-Allow-Origin`, with or without `Origin: null`,
  so in our sandbox they never load. In Chromium the old live frame still showed the server HTML. The HTML is the
  same for iPhone, Safari and desktop user agents.
- Chariz sends `x-frame-options: deny` and a CSP with `frame-ancestors cydia.saurik.com` (even on its 302).
- The site's `/api/fetch` drops upstream headers, so on the site a refusing host still loads live and stays white.
  Filed as F383 (the proxy passes the framing headers on under its own names).

## Tried and dropped

- Reproducing the white sheet in WebKit on this desktop: Playwright's WebKit build (`~/.cache/ms-playwright/webkit-2370`,
  playwright-core 1.64.0 in the scratchpad) won't start: `libicudata.so.74` is missing on this Arch box.
- Chromium `--screenshot` with `--virtual-time-budget`: cross-origin frames came out white or not, at random
  (a frame added after load, a port another slot's server already held). A real-time CDP screenshot
  (scratchpad `shot.mjs`: navigate, wait 8-9 s, `Page.captureScreenshot`) was reliable. With it, all four cases
  show in the real sheet (nav/sheet.js + the app's CSS): Havoc as static srcdoc (banner, header, screenshots),
  a plain page live, Chariz-style headers on the Open in Safari view, and a 404 on the error + Open in Safari view.

## Not verified

- **The iOS WebKit white sheet itself.** It doesn't reproduce in Chromium (the old code shows Havoc there), and WebKit
  won't run on this machine (above). The static view runs no scripts at all, so whatever blanked Havoc's page on the
  phone has nothing left to run, but nobody has seen it on a phone yet. A phone check (iPhone 15 Pro, Lite build,
  `tools/ui-15.sh`) was skipped: the fix is web-only and its views were checked in Chromium. Worth a look the next
  time a 15 task runs: open Aerial (Havoc) > Depiction.
- The full app route (Package page > Depiction row with real sources): checked through `openHtmlDepiction` called
  directly with a fake backend in the real sheet, not by tapping through the app.
- The site path for refusing hosts: still white there until F383 (it needs the Worker's `/api/fetch`, outside this
  task's files; the site is no worse than before).
- No runtime "did it go blank" check for live pages: a sandboxed cross-origin frame can't be inspected, so a timeout
  has nothing to measure. The static view is chosen up front instead, from the HTML.

## Spec review

Fixed: every `frame-ancestors` policy has to let us in (not just the first), `corsScripts` no longer matches
`module`/`crossorigin` inside another attribute's value, and the test now draws the sheet on the fake DOM (refused,
failed, static, live; no `allow-same-origin`) instead of reading the source. Kept as designed: refused before static
(the host's choice is respected rather than worked around with srcdoc), and the fetch before a live load (the views
need the HTML and the headers).
