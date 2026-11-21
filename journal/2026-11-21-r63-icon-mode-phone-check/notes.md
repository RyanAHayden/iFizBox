# R63: B289's phone check on the iPhone 15 Pro

Result: **all three Modes behave as B289 meant**, on a Lite build holding B289. Each state was shot before and
after a reboot and showed the same icon both times: the Home Screen icon doesn't wait for a restart (the brief's
notification-icon cache reason doesn't apply to it; see Found on the way).

"Dark" below means the iPhone in Dark mode **and** Home Screen > Customize on Dark > Auto; "Light" means Light mode
(Customize then draws light icons).

| Theme > Mode | iPhone / Home Screen | Home Screen icon | Expected |
|---|---|---|---|
| Automatic | Dark (baseline, after I switched both to Dark) | Gunmetal | Gunmetal (the pair's dark side) |
| Light | Dark | **Classic** | Classic |
| Dark | Light | **Gunmetal** | Gunmetal |
| Automatic | Light | Classic | Classic |
| Automatic | Dark | Gunmetal | Gunmetal |

Light theme Classic, Dark theme Gunmetal (the defaults), Match Theme on: the phone's settings as I found them.

## What I did

- Built the Lite IPA from this worktree (`native/build.sh ipa`: 0.19.0 (3838), commit 34b06b6, which holds B289's
  merge a819383e). Checked that the bundled `web/core/settings.js` has the new `iconState` (reads `appearance`)
  before installing. The phone had 0.18.4, which doesn't.
- `tools/ui-15.sh R63 install`, then drove the app's own Settings > Theme > Mode control with taps.
- Each Mode change showed iOS's "You have changed the icon for iFizBox" alert with the expected icon (Classic for
  Light, Gunmetal for Dark, Classic for Automatic on a light iPhone); tapped OK.
- `tools/ui-15.sh R63 reboot` after each change, then shot the Home Screen's second page.
- Switched the iPhone between Light and Dark with WebDriverAgent:
  `curl -X POST -d '{"name":"dark"}' 127.0.0.1:8100/wda/device/appearance` (works on the real device).
- Screenshots: `ref/15/screens/r63-*.png` (main checkout's `ref/`, not committed: they hold Apple's wallpaper and
  icons).

## Put back

- Theme > Mode: Automatic (as found; checked on screen, `r63-c3-mode.png`).
- iPhone appearance: Light (as found).
- Home Screen > Edit > Customize: Default (as found). I had set it to Dark > Auto for the check (below).
- The installed build stays 0.19.0 (3838), the B289 Lite build, newer than the 0.18.4 that was there.
- CDP server I started (pymobiledevice3 webinspector) stopped by its pid; UI lock released.

## Found on the way

- **On iOS 27 the iPhone's Dark mode alone doesn't make the Home Screen dark.** With Home Screen > Edit >
  Customize on **Default**, the Home Screen keeps drawing every icon's light look (Safari, Notes, iFizBox's Classic)
  while the system is Dark; only the wallpaper dims. The icons' dark looks come with Customize > **Dark** (Always,
  or Auto to follow the iPhone's mode). My first "Automatic + Dark" shots showed Classic for that reason, not a
  bug: with Customize > Dark the primary set showed Gunmetal at once. So "the iPhone in Dark" in a test of the
  Home Screen icon means Customize > Dark (Auto) plus Dark mode.
- **The Home Screen icon changes at once**, no reboot needed: every state above showed the same icon before the
  reboot as after. The restart rule (docs/iphone15.md) is about notification icons; this check didn't send a push.
- Filed a docs follow-up for both gotchas in docs/iphone15.md (R63 may only write findings).

## Tried that failed

- Reading the app's `localStorage` over Web Inspector while the app was in the background: the eval timed out
  (WebKit pauses a background page's JS). It worked with the app in front.

## Not verified

- Notification icons under Mode Light/Dark: not in this task's brief, and no push was sent. B289 sends one icon
  set for both slots, so a push should carry that icon after a restart, but it wasn't looked at.
- Non-default themes or App Icon picks (Match Theme off): only the defaults (Classic/Gunmetal, Match Theme on) were
  run on the phone. The pick cases are covered by B289's node tests, not by a device check.
- Customize > Dark > Always, Clear and Tinted: only Default and Dark > Auto were tried.
- iOS 15-17 (one icon only): no such phone on the rig for the sideload build.
