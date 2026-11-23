# B325: Lite tweak pages said "Can't Install Yet: needs mobilesubstrate"

## What I did

- `web/app/screens/browse.js`: new `pageDepReport(report, st, mode)`; the package page draws the Can't Install Yet /
  Before Installing groups from it. It returns null for a sideload tweak (`isSideloadTweak`), the report otherwise.
- Why the whole report is skipped, not just the substrate family (the brief's second option): a Tweak Source keeps
  only stanzas that pass `core/tweakfields.js injectableFromFields`, so every Depends group of a sideload tweak is
  already satisfiable by something Add to App bundles or drops (the hooking library, PreferenceLoader, firmware,
  cy+ names). Filtering only mobilesubstrate/ellekit/libhooker would have left "Needs preferenceloader … Add
  palera1n" (seen in the before shot). Firmware is the only other thing the report could say, and the page already
  says it: it judges the stanza itself (`compat(st, currentDevice())`), so an unmet range shows in the header mark and
  in Works On as "Not on iOS x / Made for iOS 15.0 or later" (the catalog's row mark is what's left out, not this).
  The Lite app has no dpkg status, so no conflicts either. So nothing in the report applies to injection.
  `core/deps.js` is unchanged.
- Spec review: it asked whether dropping the report loses the firmware warning (above: no; now pinned by a test),
  and for a test behind "plain tweaks aren't offered" (added). It also flagged the copied capture.mjs carrying
  B129's unused hooks and the string-match wiring test: kept, as journal tooling and the repo's usual wiring check
  (browse-addtoapp.test.js does the same).
- Plain jailbreak-repo tweaks in Lite: not offered at all. `catalog.js` loads APT sources in the sideload build only
  as Tweak Sources (`{ tweaks: true }`), and `core/catalog.js load` drops every stanza that isn't injectable, so a
  non-injectable tweak has no page there ("Package not found", as B182 already handles). No dep-problem wording is
  reachable for them, so nothing to change.
- `web/app/screens/browse-deps-lite.test.js`: a Lite fixture (Tweak Source loaded through the real catalog on an
  iOS 17 "none" device, no dpkg status) with `Depends: mobilesubstrate (>= 0.9), preferenceloader, firmware`: the
  catalog's report has the blocking mobilesubstrate problem, `pageDepReport` drops it in sideload mode and keeps it
  in the jailbreak build and for a non-injectable stanza; plus a wiring check on the page.

## Chromium shots

`capture.mjs` (copied from B129's, `--mode sideload`) adds a fixture Tweak Source at `https://repo.example.test/`
answered by the fake shell (`OFFLINE=1` keeps everything else off the network), then `script.json` adds it through
Sources > Add > Add Source and opens Lite Fixture's page.

- `before-main.png`: main: Can't Install Yet, "Needs mobilesubstrate 0.9 or later … Add ElleKit" and "Needs
  preferenceloader … Add palera1n".
- `after.png`: this branch: no dependency groups (`.deps-problem` count 0). The "couldn't be downloaded … 404" footer
  under Add to App… is the fixture having no .deb, not this change.

## Not verified

- On the iPhone 15 Pro (real Lite build): not run; the page is the same web code the Chromium shot drives through
  the fake sideload shell, and the change is a one-line gate.
