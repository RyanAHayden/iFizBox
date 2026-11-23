---
name: concept
description: Make a UI concept for this repo — a proposed screen or change shown to the user before it's built — as a live Artifact of the real web/app (taps, pages and sheets work) in a phone frame, with theme, device, mode and before/after controls. Use whenever you're asked for a concept, mockup, prototype, "show me what X would look like", or a UI proposal for approval.
---

# UI concepts

A concept is the real app with the change made, not a picture of it. You change the actual screen code in a scratch
worktree, `tools/concept/build.py` packs that `web/app` into one self-contained page (the app running live in a
phone frame, beside controls for theme, device, mode and before/after against main), and you publish the page with
the Artifact tool and send the link. Never hand-copy the app's CSS or HTML into a mockup: it drifts from the app
on the first glance and teaches the user nothing about how the change will really behave.

## The look rules (read AGENTS.md's look-and-feel section first)

A concept is held to the same rules as shipped code, because approved concepts get built as they are:

- iOS 6 is the base style. Build the change from what `web/app/ios6.css` already draws: bar buttons (`.bar-button`),
  the App Store price button (`.price-btn`, as FREE in Browse and My IPAs), grouped tables, segmented controls,
  switches, sheets and alerts (`nav/alert.js`, `nav/sheet.js`; `alert/confirm/prompt` don't work in the Artifact,
  the app's own alerts are DOM and do). No new visual styles: no new gradients, glows, highlights or bottom lines.
  A control the app doesn't have yet is drawn the way `ios6.css` draws its neighbours (sampled from the 4S's UIKit
  art, `ref/4s/artwork/`), and its dark-theme rules come with it (every palette in `palettes.css`).
- Icons: row tiles from `web/app/icons/rowicons.js` (add a tile there if a row needs a new one, same style),
  Cydia's section icons in `web/app/icons/sections/`. No Apple artwork, no system icons, no emoji, no SF Symbols.
- Group footers, wording and layout follow AGENTS.md (hints) and the screens beside the one you change. The name
  comes from `brand.js`, never spelled out.
- Only the screens the concept is about change; everything else is main as it is.

The controls outside the phone are plain page UI; leave them as the tool draws them.

## Making one (cheaply)

1. A scratch worktree on a throwaway branch, never the main checkout and never your task branch:

       git worktree add -b concept/<short-name> "$SCRATCH/concept-<short-name>" main

   (`$SCRATCH`: your session's scratchpad.) Concept code is not task code: don't commit it to a `task/*` branch.
2. Change the real screen code there (`web/app/screens/*.js`, `*.css`, `icons/rowicons.js`, `core/*`), only as much
   as the concept needs to show live: the new page, rows and buttons, with sample data where the real data would
   need a server. Tests aren't needed for a concept.
3. Build the page from that worktree, using the tool from your own checkout:

       python3 tools/concept/build.py --app "$SCRATCH/concept-<short-name>/web/app" \
         --title "More Sources" --note "Sources > More Sources replaces Recommended" \
         --start '#/sources' -o "$SCRATCH/more-sources.html"

   `--before main` (the default) adds the before/after toggle against main; `--mode jailbreak|sideload|site` and
   `--device iphone-se|iphone-14|iphone-16|iphone-17-pro-max|ipad-mini` pick what it opens on (light Classic theme
   by default; every palette is in the Theme menu). The Theme menu also lists the eras of Theme > Style (iOS 6, the
   default, with its Light and Dark lists; then each other era with its own themes, e.g. iOS 7 · Light · White),
   read from `core/settings.js` (the style setting's options and `STYLE_PALETTES`), so an era added to the app
   shows up with no change to the tool. The build fails loudly if a module can't be bundled or an import
   names something that isn't exported.
   The iOS 26 style in the frame is an approximation: it has no native bars, menus, alerts or switch, since the fake
   bridge reports `app.info` ios "26.0" so the style is offered and the look-alikes draw instead.
4. Check it in headless Chromium (needs `chromium`; about a minute):

       python3 tools/concept/build.py ... --standalone -o "$SCRATCH/check.html"
       node tools/concept/check.mjs "$SCRATCH/check.html" --modes jailbreak,sideload,site --route '#/sources' --shots "$SCRATCH/shots"

   `--themes` takes the Theme menu's values: `light:classic,dark:gunmetal` (the default) for iOS 6, and
   `<era>:<tone>:<theme>` for another era (`ios7:light:white,ios7:dark:oled`); it checks the app's `data-style`,
   `data-theme` and `data-palette` match. A concept that touches an era's CSS (`ios7.css`) checks that era too.
   It runs under a CSP like the Artifact viewer's and fails on any error, CSP refusal or request, window error
   events included (ResizeObserver's loop warning is one). At each device and theme it also drags a list by mouse
   on `--drag-route` (default `#/home/credits`, a page long enough to scroll on every device; `none` skips it): the
   pressed row's state, a touch seen by the app, the list following and gliding on, the rubber band at the top, a
   swipe back from the left edge; then it changes the device and back. Look at the shots.
5. Publish the non-standalone file with the Artifact tool (`icon: "phone"`, a short title like "More Sources Live",
   a one-line description), and send the user the link. To revise, rebuild to the same path and publish it again:
   same file path, same URL.
6. Delete the scratch worktree and branch when the concept is approved or dropped.

## How it works (when something doesn't)

- `tools/concept/esm.py` bundles every module into one inline script (the Artifact's CSP allows no other host and
  no fetches): each module is an async function run inside `with (imports)` so imports stay live bindings;
  `import()` and `import.meta.url` (`concept://app/<path>`) go through the registry. Default imports/exports
  aren't supported (the app has none).
- `tools/concept/shell.js` runs first in the phone's iframe (a srcdoc): a fake `ifizboxNative` in the jailbroken
  and Lite modes (native/bridge.js's shape, `data-shell="app"` as App.swift sets it), the site's `/api/fetch`
  in Website mode, both answered from `tools/concept/sample.py`'s sample sources (repo fixtures; an unknown source
  answers a made-up empty one); an in-memory localStorage seeded with the theme as the app stores Theme's picks
  (`ifizbox.style` for the era, which theme-boot.js puts on `html[data-style]`, `ifizbox.appearance` for the tone,
  and `ifizbox.lightTheme`/`darkTheme` in an era that uses those lists); images as data: URIs; safe areas
  per device (`env(safe-area-inset-*)` becomes `var(--sa-*)` at build time); an iPhone or iPad user agent.
- The mouse is a finger inside the phone (`tools/concept/touch.js`, after shell.js), as in Chromium's device mode:
  the app gets pointer events with `pointerType: "touch"` and touch events, never the mouse, so its touch code
  runs (pressed rows, long press, swipe back, swipe to delete, pull to refresh, switches). A drag past 10 px pans
  the nearest scroller the element's `touch-action` allows, with momentum and a rubber band at the ends; the
  pointer gets `pointercancel` then, as a browser's would. A tap ends in the compatibility mouse events and a
  click. `:active` in the app's CSS becomes `.concept-active` (set while the finger is down and not panning),
  `:hover` matches nothing and `(hover)`/`(pointer)` media queries answer as a phone (build.py `touch_css`,
  touch.js's `matchMedia`); the cursor is a round touch dot. Text fields keep the mouse's native focus and caret.
  The mouse wheel still scrolls natively.
- Changing the device loads a fresh app at the new size, on the same page (frame.html `load()` swaps in a new
  iframe): resizing the running app set off `nav/slide.js`'s ResizeObserver into "ResizeObserver loop completed
  with undelivered notifications". An open sheet or scroll position doesn't survive a device change.
- Calls the fake bridge doesn't know answer null, as in `tools/readme_shots.py`'s capture route. If a concept needs
  data the sample hasn't got, add it to `sample.py` (fixtures only, nothing fetched) rather than faking it in screen
  code.
- The page must stay under 16 MB (the build checks); a concept usually adds kilobytes to the ~5.5 MB base.
