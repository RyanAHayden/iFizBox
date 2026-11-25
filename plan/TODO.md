# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs in three places:
the public site, the jailbreak app (a native shell around a WKWebView that installs `.deb`s through a root helper,
docs/native.md) and the sideload IPA, the same shell without the helper, for AltStore sources and signing,
installing and re-signing apps on the phone (docs/sideload.md). It has to feel native: 120 Hz, real swipe-back.
Push notifications for updates; Shortcuts recipes in docs/shortcuts.md. Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **D33** Swap the README's showcase video for F441's approved cut (user 2026-11-25: 'use the new video once its in'): regenerate docs/img/showcase.webp from the new 4:5 MP4 (ffmpeg fps=10,scale=400:-2, libwebp_anim -q:v 28 -compression_level 6 -loop 0, under 1 MB) and replace the showcase.mp4 asset on GitHub release v1.0.0 (GH_TOKEN of RyanAHayden, gh release upload v1.0.0 showcase.mp4 --clobber), which the README links to; fix the img alt text if needed. Check: the gate; the MP4 URL answers with the new file's size | files: docs/img/showcase.webp, README.md | after: F441 | model: sonnet
- [ ] **F441** Showcase video: a splash opening, no two phones (user 2026-11-25: 'make the video have a better splash page start and not show 2 phones at the start'). Replace the two-phone opening and its labels with a short splash (about 3 s, also a good poster frame): our app icon, the name and the existing line 'works with or without a jailbreak' on the same pinstripe ground, then one move into the no-jailbreak phone. Delete the code only the old opening used; the rest of the cut stays. Update the README. Check: stills of the opening in both sizes, text readable at 360 px wide; gate green. Don't post it. When rendered, block with CONFIRM 'Watch the video with the new splash opening', both MP4s playable from the ask, as F440b did. | files: marketing/video/video.html, marketing/video/README.md
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

### Parked

- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F293** (follow-up, later) Serve the known-malware IPA list (core/malicious.js MALWARE_IPAS) and the known-safe list from the Worker too, so a confirmed Report as Malicious blocks without an app release (F291 ships them in the app only); plus an admin way to read reports in D1 (malicious_reports) and confirm one | files: worker/src/**, web/app/core/malicious.js, web/app/core/safe-sources.js, web/app/screens/safety.js
- [ ] **C31** (follow-up, later) Storage keys and module-private exports (audit 2026-11-20): one module naming the 55 ifizbox.* storage keys, used by their readers and writers; drop export from module-private exports (164 are used only inside their own module) where no test imports them, or note why in docs/audit.md. Check: node --test; a test that every ifizbox.* string literal comes from the key module. | files: web/app/core/storagekeys.js, docs/audit.md
