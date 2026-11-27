# B508: My IPAs' Sign Options on a free Apple ID's profile: no Keep Bundle ID switch, none saved

## What I did
- `web/app/screens/myipas.js`, `renderOptions`: asks `pinnedProfile` from `signing/freeappid.js` before drawing and
  keeps the answer as `appIdOnly` in the page's edits. On a free Apple ID's profile (free, not wildcard) the Keep
  Bundle ID switch and its footer are not drawn.
- `web/app/screens/myipas.js`, `saveOptions`: with no switch (`appIdOnly`), `keepBundleId` is sent only when the
  IPA's options already had a boolean saved; otherwise the key is left out. Other profiles send the switch as before.
- `web/app/myipas-pinned.test.js` (new): 3 tests on the fake DOM. No switch or footer and no key sent on a free
  profile; a saved choice goes back as it was; other profiles keep the switch and save it.

## Checks
- The first run of the new test died with "location is not defined": Save leaves the page and reads `location`
  afterwards. The test now sets `globalThis.location`. Re-run: 3/3 pass (`node --test` in `web/app`).

## Found, not fixed (filed as a follow-up)
- The native shell's `native/sign/SignOptions.swift` `init(json:)` defaults `keepBundleID` to true. When
  `library.options` gets no `keepBundleId`, it stores true, and `Library.json` then reports it as a saved choice. So
  the web change alone does not stop a choice applying under another profile. Filed for the native side.
- The Install As footer on a free profile still says "A new bundle ID installs a second copy", but a typed bundle ID
  makes no second copy there (`docs/signing.md`, "Per-app profiles"). Custom Install's sheet already dropped that
  offer in B505. Filed as a low-priority follow-up.

## Not verified
- Not seen on a phone or in Chromium: checked only with node tests on the fake DOM.
- The native behaviour above is read from the code, not run.
