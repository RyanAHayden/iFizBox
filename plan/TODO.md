# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **F443** Installed (jailbreak app): the Install IPAs and Apps rows above the package list are much taller than the other rows. Merge them into one normal-height row (one link to IPAs and installed apps, its subtitle the counts), sized like the package rows. Screenshot: .runner/uploads/20261126-104415-IMG_0019.png | files: web/app/screens/installed.js, web/app/screens/installed.test.js | after: B460
- [ ] **B461** Find More: row buttons (ADD/ADDED) draw on top of the pinned section header (Popular on Canister) when scrolling; the header must cover the rows' buttons. Screenshot: .runner/uploads/20261126-104415-IMG_0021.png | files: web/app/screens/findmore.js, web/app/screens/findmore.test.js | model: sonnet
- [ ] **B460** Installed, sorted by name: the pinned letter header (A, B...) slides up under the search field and scope bar instead of pinning below them. Search's page already does this right; give Installed the same pinned top. Screenshots: .runner/uploads/20261126-104415-IMG_0019.png, .runner/uploads/20261126-104415-IMG_0020.png | files: web/app/screens/installed.js, web/app/screens/installed.test.js | model: sonnet
- [ ] **B459** Changes (jailbreak app, iPhone 7): with an upgrade waiting (iFizBox 1.0.0 banner shown), the Upgrade bar button was missing, only Refresh showed; and Refresh never finished (Downloading Packages bar stuck with Cancel). Find why Upgrade is missing and why the refresh hangs; check in Chromium with the fake bridge first. Screenshot: .runner/uploads/20261126-104415-IMG_0018.png | files: web/app/screens/changes.js, web/app/screens/changes.test.js
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
