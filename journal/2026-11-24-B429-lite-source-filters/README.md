# B429: Lite source filters

## What
- Cause: Chariz's Packages lists the same version twice, an `iphoneos-arm` stanza then an `iphoneos-arm64` one.
  `core/catalog.js` load kept the first and App Tweaks Only judged only that one, so it hid YouGroupSettings 1.0.11,
  Return YouTube Dislike 1.14.2 and Return YouTube Music Dislike 1.2.3. All three have a working verdict in
  `tweak-index.json`. That was not intended: the F382 rule is "has an iphoneos-arm64 build".
- Fixed in `core/catalog.js`: the flags of same-version builds combine. The candidate stanza is unchanged, since that
  is the one the Tweak Index checked.
- Decision, not changed: Glint and betterAlarm stay hidden on purpose (B391, the user's ask). They are
  iphoneos-arm64, so the cause is the no-verdict, no-mention rule, not App Tweaks Only. R45's note guessed wrong.
- Decision, fixed in `device.js` and `screens/browse.js`: the Works on My Phone switch on a source's page set the global
  `worksOnMyPhone`. That is not intended, since F382 gives each source its own. `device.js` filterRow now takes a key,
  and `browse.js` passes the source's.
- Spec review: in Lite the switch had no effect on a Tweak Source, so its page no longer shows it; the empty note names
  Filters too. The rootful candidate .deb is accepted (core/tweakfields.js TWEAK_ARCHES) and is the one the index checked.
- The empty note on a source page in sideload no longer blames Works on My Phone, which never judges a Tweak Source's
  tweaks.
- Files: `web/app/core/catalog.js`, `web/app/device.js`, `web/app/screens/browse.js`, test in
  `web/app/core/sourcefilters.test.js`. `web/app/screens/sources.js` (named on the task) needed no change.

## Checked
- Real Chariz Packages (2026-11-24) and the shipped `tweak-index.json`, in node: default filters list 0 before, 3 after.
- Chromium, sideload mode, with F382's `capture.mjs` and `check.json` (this folder), real Chariz Packages served on
  127.0.0.1:8749. The source page shows 4. Nothing is signed, so this count came from that fake source, whose key the
  Tweak Index does not cover: the mention rule. The switch stored `{source: fit false}`, `worksOnMyPhone` stayed
  untouched, All Sources' switch stayed on, and Filters said Custom for that source.
  This Lite run was before the switch was taken off Lite's Tweak Source pages.
- Chromium, jailbreak build (`capture.mjs --native <fake phone dir>` listing the same repo, `check.json` as it is now): the
  source's switch stores its own `fit`, `worksOnMyPhone` stays unset, All Sources' switch stays on, Filters says Custom.

## Not verified
- Lite's source page without the switch was not drawn again after that change.
- On the iPhone 15 (web-only change; Chromium covers it).
- The new empty note, which was not drawn in Chromium.
- Toggling back leaves a stored `fit: true` for that source, so it stays pinned on if All Sources is later turned off.
  This is the same as Manage > Filters.
- Manage > Filters in Lite still has Works on My Phone on a Tweak Source, where it has no effect.

## Failed
- Nothing of note, apart from a stray `cat` in one shell command that hung on stdin until it was killed.
