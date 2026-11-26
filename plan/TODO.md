# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **B472** Pull to refresh area is still drawn as its own layer that chases the list and moves oddly (after B463's fix; user, iPhone 7). It must behave like iOS 6: part of the page, sitting just above the list's top, out of view, and only the gap a pull opens reveals it, moving exactly with the content (no separate overlay following scrollTop). Read journal/2026-11-26-B463-pull-area-outside-gap first. Likely fix: put the area inside the scrolling content (above the first row, in the rubber-band overshoot) instead of a positioned clip box measured from the list. Check on the iPhone 7 with a freshly built .deb (Chromium has no rubber band): screen-record a slow pull, a fling past the top and a refresh on Changes and Sources, with pinned headers; the area never shows over the nav bar, headers or rows. | files: web/app/nav/pullrefresh.js, web/app/nav/pullrefresh.test.js, web/app/style.css, web/app/ios6.css
- [ ] **V31** Release: bump the version where the project keeps it, per its versioning rules (agent-runner's: docs/SETUP.md#versions), move CHANGELOG.md's Unreleased entries under the new version heading, commit to main so the release workflow tags and publishes it. Check: the release workflow passed (gh run list) and gh release view shows the new tag | after: all | moved: yes
- [ ] **T87** Free Apple ID setup: real test + promo clip and posts (split into T87a, T87b) | files: journal/**, docs/sideload.md
- [ ] **T87a** Run the free Apple ID one-time computer setup end to end on the iPhone 15 Pro (never done on a real phone, per docs/sideload.md). From this desktop with the 15 on USB, under tools/ui-15.sh's lock: website sign-in with a free Apple ID (if you need a login, block with the Tools page link, never in chat), checklist, code, curl -fsSL https://ifizbox.com/sign/setup.sh | sh, app on the Home Screen, then a re-sign on the phone with no computer. File a B task per failure; update docs/sideload.md's Not verified list. Write in the journal exactly which steps worked, for the posts. | files: journal/**, docs/sideload.md — The Apple ID file is saved (~/.config/ifizbox-appleid); the person is around for the 2FA code.
- [ ] **T86** Promo clip + posts for sideloaders (split into T86c, T86a) | files: marketing/video/**, journal/**
- [ ] **T86a** Sideloader posts artifact (the T86 page, same URL): swap in the new 4:5 and 9:16 videos from T86c (upload + download links), update the X and r/sideloaded text to mention the Free Apple ID option next to your own certificate, Copy button per block. Then block CONFIRM: Sideloader posts ready on <page link>. Reply posted, or what to change. | files: journal/** | after: T86a | model: sonnet — reopened: T86c landed
- [ ] **T85** Promo clip + posts for jailbreakers (split into T85a, T85b) | files: marketing/video/**, journal/**
- [ ] **T85b** Jailbreak posts artifact (https://claude.ai/artifact/TCQpUb4DMCxkJqtKaF7vP5): add the r/jailbreak title and body as copy-ready blocks with Copy buttons, give the page a proper title and description, swap in the new Reddit video from T85a (upload + download link). Then block CONFIRM as before. | files: journal/** | after: T85a | model: sonnet
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [~] **F445** (follow-up, low) Film the Free Apple ID login of the sideload-only promo clip (T86c) on the iPhone 15 with the real ID in ~/.config/ifizbox-appleid (2FA code from the person), via tools/ui-15.sh's lock; replace the stubbed login in marketing/video/promo-sideload.html, hiding the real Apple ID on screen. Check: the 4:5 and 9:16 cuts show the real flow. | files: marketing/video/promo-sideload.html, marketing/video/shots-promo-sideload.json | after: T86c BLOCKED: (after T87a) Waits for T87a: it signs in with the same free Apple ID, and an in-app sign-in now could revoke its certificate
### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
