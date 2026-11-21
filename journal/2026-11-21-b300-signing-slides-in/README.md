# B300: Installation & Signing slides in from every way in

User 2026-11-21: "the signing page still pops in instead of sliding".

## What I found

app.js slides a page in only when nav/stack.js `sync` calls the route change a `push`. Probed each way into
Installation & Signing in headless Chromium as the sideload app (a fake `ifizboxNative` with `mode: "sideload"`, the
smoke.mjs pattern: CDP mouse taps, each frame's `.page.is-moving` transform recorded, mid-slide screenshots):

| way in | before the fix |
|---|---|
| Home's Signing Needs Setup tile (`#/home` → `#/home/settings/signing`) | slides |
| Home > Settings > Installation & Signing row | slides |
| Why's Set Up Signing | slides |
| Install's Set Up Signing (signing/device.js `firstInstallCheck` → `openRoute`) from Home, Settings, Installed tab | slides |
| **Install's Set Up Signing from Home's Install IPAs tile** (`#/home/~installed/myipas`) | **no slide** |

The last one: `openRoute` sets the hash to `#/home/settings/signing`. router.js `mountLink` returned null for a link
from a page mounted on Home (`~installed`) to a Home page ("back to the tab's own pages (Home > About)"), so the route
stayed `#/home/settings/signing`; the stack dropped the mounted Install IPAs page and added Signing in one go, which
is a `replace`, drawn without any slide. The same held for any link from a mounted page to a Home page not under it.
The same happens with a sign failure's "open Signing" (signing/route.js, library.js `go(["signing"])`) from that page.

## The fix

router.js `mountLink`: from a route with a mount on Home, a link to a Settings sub-page mounts it as `~settings`
(`#/home/~installed/myipas/~settings/signing`, the shape other tabs already use), and a link to any other Home page
that the route doesn't stand on mounts `~home` on top (F143's "mount the tab again"). Both are pushes; Back pops back
to Install IPAs; B39's return to the page Install was tapped on is a pop down the same stack. Links up to a page the
route stands on are still pops (checked before).

router.test.js line 274 asserted the old null for `home/~installed/myipas/apps` → `home/about`; it now expects the
push (the old value was the bug).

New `web/app/signing-slide.test.js`: from ten starting pages (Home, Settings, Why, a guide, Home's Install IPAs and
its sub-page, Home's More Sources, Installed's Install IPAs, a Sources package page, Changes), both
`#/home/settings/signing` and `#/home/settings/installation` are a push whose page is the merged page
(`opensMerged` on the mounted route), and Back returns to where it started.

Knock-on, fixed here: installroute.js `onPairPage` compared the raw hash with `#/home/settings/installation/pair`, so
the Pairing page under a mount counted as "left the page" (its hashchange listener ends the pairing). It now compares
the mounted route (`isPairHash`, tested). That was already wrong from the Installed tab's Install IPAs
(`#/installed/myipas/~settings/…`); the new Home route would have made it wrong there too.

## Chromium check

`probe.mjs` here (`node probe.mjs web/app`): reloads per way in, taps with CDP mouse events, and records the
`.page.is-moving` transform every frame. `before.txt` (main's web/app) vs `after.txt` (this branch): "home > install
IPAs tile > set up" and "install redirect from home/~installed/myipas" went from 0 moving frames to 22 (x 390 → 0);
the other nine ways in slide in both.

## Tried / dead ends

- First suspect from the brief: the merged page drawn by a redraw or `replace`. Not so: `drawMain` builds the page
  synchronously, Home's tile and Settings' row are plain pushes and slide (screenshots mid-slide show the page drawn).
- The probe's first version used `Page.navigate` to a hash on the same document, which is a hash link, not a fresh
  load: it accidentally produced the mounted start (`#/home/settings/~installed/myipas`) that showed the bug.

## Not verified

- The real iPhone 15 Pro (Lite): not run. Chromium with the sideload bridge reproduces the route and the stack
  change, which is all this fix touches (no native, signing or WebKit-only behaviour), so per AGENTS.md the phone
  isn't needed. The user's exact path to the pop-in is inferred (the only way in that didn't slide); if they meant
  another one it would need their steps.
