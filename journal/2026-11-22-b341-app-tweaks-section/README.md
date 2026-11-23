# B341: Tweaks and App Tweaks on All Sources' Sections page and in Search's Section filter

User report: All Sections has no Tweaks or App Tweaks section.

## Why each was missing

- **Sideload build (the report):** the catalog keeps Tweak Sources (APT sources loaded with `{ tweaks: true }`,
  F302) out of All Sources on purpose (`inAll`), so `sections(ALL)` only ever saw the AltStore apps. No hidden
  section and no `JAILBREAK_CATEGORIES` filter was involved; the tweaks were simply never in the All Sources merge.
  Plain jailbreak tweaks (.deb installed by apt) can't be used in this build, so it gets no Tweaks section; it gets
  App Tweaks instead.
- **Jailbreak build:** nothing was missing in the code. `sections(ALL)` lists every package's Section, and
  `Tweak` already folds into `Tweaks` (sectionName, Cydia's Sections.plist). Checked in Chromium with a fake apt state
  holding a `Tweaks` and a `Tweak` package: Sections shows Tweaks (2) (`jb-sections.png`). App Tweaks
  (injecting into a signed app) is a sideload-only flow (signing.* is refused in the jailbreak build), so that build
  gets no App Tweaks section.

## What changed

- `core/sections.js`: `APP_TWEAKS = "App Tweaks"`; it belongs to Search's Tweaks group (`sectionGroup`).
- `core/catalog.js`: in the sideload build (`appsOnly` with Tweak Sources loaded), the Tweak Sources' injectable
  tweaks are merged (newest version wins) into an App Tweaks section under All Sources: `sections(ALL)` lists it
  (Section Visibility can hide it; Block, Hide by Author and Works on My Phone apply), `list(ALL, "App Tweaks")`
  lists them, `search(q, { section: "App Tweaks" | "group:Tweaks" })` searches them, and `package` / `history` /
  `deps` under All Sources find a tweak opened from there. All Packages and an unfiltered Search stay as before
  (apps only), as F302 decided.
- No screen change was needed: browse.js's Sections page and search.js's Section choice group both draw from
  `catalog.sections(ALL)`, and the section list already runs the sideload tweak check (`dropRefusedTweaks`).
- Test: `core/sections-b341.test.js` (both builds, hiding, Block, newest version, search, package page).

## Checked

- `node --test` on the new test, catalog.test.js, tweaks-apt.test.js, blocked.test.js: all pass.
- Chromium, fake bridge (`capture.mjs` from B129 plus a LOGFETCH log and a rewrite of https://127.0.0.1:8732 to
  the local http test repo):
  - jailbreak mode with a hand-made phone dir (one `deb https://repo.example/ ./` source, its Packages):
    `jb-sections.png`, Tweaks (2).
  - sideload mode, the local repo added as a Tweak Source through Sources > Add: `sl-sections.png` shows App Tweaks
    (5: two local, three from the default GitHub Tweak Sources), `sl-apptweaks.png` its list, and a tweak's page
    opened from it (`#/sources/*/section:App Tweaks/package:com.x.iglite`) loads with Add to App.

## Tried that failed

- First sideload runs: the default GitHub Tweak Sources answered HTTP 403 (GitHub API rate limit from this
  machine) and an added `http://127.0.0.1` source was turned into https, so App Tweaks had nothing; fixed in the
  test shell only (the URL rewrite), not in the app.

## Not verified

- Search's filter sheet was not shot in Chromium: it draws its Section rows from the same `catalog.sections(ALL)`
  that the Sections page shot shows, and the search side is covered by the unit test.
- Not tried on a phone: a web-only change, checkable in Chromium (AGENTS.md: phone only when Chromium can't check).
