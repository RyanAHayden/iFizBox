# B406: no jump to Home from Search

## Report

The user opened the app, opened Search, and was thrown to Home.

## Cause

"Return to Home After" in `web/app/app.js` (the `visibilitychange` handler) ignored touches. If the app had been hidden long enough, it went Home even when the user had just tapped Search and started typing.

## Reproduced

Headless Chromium at 375x667, CPU x6, with a fake jailbreak bridge. Visibility state and the clock were faked.

- (a) Hidden for 10 minutes, then tap Search and type, then a late `visible` event. Old code went Home and blurred the field.
- (b) Visible, then a Search tap before the async `hashchange` fired. Old code went Home.

## Fix

- `web/app/nav/hometop.js`, `createUserTouch`: reset on hidden. A field that iOS refocuses does not count as a touch.
- `web/app/nav/hometop.js`, `createReturnHome`: synchronous through `router.goNow`, no slide. `hiddenAt` is used up by every return. A touched app only refreshes.
- `homeTop.opened` skips the Home return when the user has touched the app.
- `onRoute` moved from `web/app/app.js` to `web/app/nav/stack.js` as `newestRoute`, so a slow mount loses to a newer tab.
- The same rule now applies to: the website's new-build reload (waits until the user leaves), finished-run page dismissal in `web/app/incoming.js`, the settings redraw on return while typing in `web/app/screens/settings.js`, and the Security Patch alert and push permission prompt (both wait until the user is not typing).

After the fix, case (a) stays on Search with the typed text. An untouched return still goes Home.

## Checked

- Cold launch (CPU x1, x6, x20; `screens` modules delayed 0 ms and 400 ms; Search tapped as soon as the tab bar drew, then typed, then a 9 s wait). Old and new code both stayed on Search.
- A page reload keeps `#/search`, but the typed text is lost. `App.swift` has no `webViewWebContentProcessDidTerminate`, so only a reload that keeps the URL was simulated.

## Failed or rejected

Nothing notable.

## Not verified

- The real iPhone 7. Chromium reproduced the bug, so the phone was not used, as the task asked.
- The real iOS event order of a tap against `visible`.
- A real WebKit content-process crash.
- Which of the two paths hit the user on 2026-11-23. The process started at 17:17:17 and the report came about 17:18. That is inside the 2 minute default, so a return of that same process cannot have triggered it, unless the report time is wrong.
