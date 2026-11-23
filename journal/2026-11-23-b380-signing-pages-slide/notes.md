# B380: the pages inside Installation & Signing jumped instead of sliding

## Cause

Every way in opens the merged page as `#/home/settings/signing`, but its This iPhone, Signing Server, Install Apps With,
Pairing and Shortcuts rows link to `#/home/settings/installation/<sub>`, a sibling branch. So nav/stack.js sync treated
the move as a `replace`: no slide, in or back. The same happened between sub-pages (iPhone to Pairing) and under a mount.

The earlier concept check must have started on `settings/installation`, where those links are descendants and do slide.
Certificate and Apps (`settings/signing/…`) always slid, which is why it looked partial.

## Repro

iPhone 15 Pro, Lite 0.24.1, via Web Inspector, counting frames with `.page.is-moving`:

- Settings > Signing: 42
- This iPhone: 0, back: 0
- Signing Server: 0, back: 0
- Certificate: 117

Chromium (B300's probe.mjs with custom ways, starting from the `#/home` signing tile): 0 / 0 / 21.

## Fix

- `router.js` `mountLink`: a Settings link that is neither above nor below the page on screen mounts as `~settings`, a push.
- `router.js` `onSettings`: a Settings page that the topmost run of Settings pages already stands on is a pop to it.
  `settings/signing` and `settings/installation` count as one page.
- `router.js` `onSettings`: a link to the page already on screen under its other route walks its history entry off again
  (`history.back`), so Back isn't spent on it.
- `router.linked()` and `stack.js` `sync({linked})`: after a link that pops, entries no longer trust `history.back`,
  because the entry behind is the page that was left.
- `app.js` passes `linked` through (one line). `app.js` and `nav/stack.js` are outside the task's file list, but needed.
- `installroute.js` and `settings.js` needed no change: `goTo`, the fix rows, the status cell's action row and USE all go
  through the router.

## Tests

`signing-slide.test.js`:

- Every sub-page, from five starts and both routes, pushes and pops back.
- Sub-page to sub-page.
- Pop to another route, and the no-op case.

## After

- Chromium: 22 moving frames for This iPhone and Signing Server.
- iPhone 15 Pro with this branch's Lite build (0.25.0 4680, left installed): This iPhone, Signing Server, Certificate, and
  iPhone to Pairing all slide in and back, 41 to 84 frames each.

## Known behaviour (unchanged)

A web reload (or a killed web process) on a mounted page rebuilds the stack from the hash and shows Installation & Signing
once more behind it. This is the existing mount behaviour.

## Not verified

- On the phone, the real taps on USE, the fix rows and Pairing were not made. Link clicks and hash changes were driven over
  Web Inspector instead. Pairing was not opened, so as not to advertise a new pairing. Those share the same router path
  and are covered in `signing-slide.test.js`.
- The B357 test after pairing and the return from Shortcuts were not run. They redraw in place or go through `goTo`.
- The native tab bar (iOS 26 style) was not switched on.

## Spec review

Fixed: Settings' root linked from a mounted Signing page pops to it; the sibling push is limited to Installation &
Signing's pages (other Settings links as before). These two came after the phone run: checked with node tests only.
Kept: clearing `pushed` after a link-driven pop (Back would otherwise push the page just left). The reload duplicate
is the existing mount behaviour.
