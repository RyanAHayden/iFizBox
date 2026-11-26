# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **B465** (follow-up, high) Some buttons take a tap without showing their pressed state: the user can tap Home and Settings (and others) and the action happens but the button never depresses, so the tappable area is bigger than (or offset from) the area that draws :active/.is-pressed. Find why (likely the press handler in app.js sets is-pressed on a different element than the hit target, or a child/padding/::before covers the button), fix it once in the shared press code/CSS so every tappable control (tab bar items like Home and Settings, bar buttons, cells, action/alert buttons) shows its pressed state across its whole hit area, in iOS 6 and iOS 13 styles. Check in Chromium (readme_shots/capture.mjs route): tap each control at its edges and centre and confirm the pressed look; add a node test that a tap anywhere in a control's hit box marks that control pressed. | files: web/app/app.js, web/app/ios6.css, web/app/press-hitbox.test.js
- [ ] **B466** (follow-up, high) A scroll that starts and ends on a tappable item (row, cell, button) opens it as if tapped. Any touch that moved enough to scroll (or while the list is still scrolling/momentum) must cancel the tap and clear the pressed state, like UIKit: a drag is never a tap. Fix it in the shared press/tap code so it holds for every list and control. Check in Chromium with CDP touch events: drag from a row and release on the same row, list scrolls and nothing opens; a plain tap still opens. Add a node test for both cases. | files: web/app/app.js, web/app/scroll-tap.test.js | after: B465
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
