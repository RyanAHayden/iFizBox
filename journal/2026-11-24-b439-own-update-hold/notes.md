# B439: iFizBox's own update in the background gives the holds back

## Code

- `CloseForUpdate.inFront(idle:)` in `native/Sources/Sideload.swift` starts a `PromptHold.quiet` (60 s) wall timer only
  when it has to wait for the app in front. After that it calls `idle` (the install call's `holdUntilAnswer` release,
  passed from `hostAndOpen` as `serving`, a Once) and `Sideload.yieldPageHold` while that same wait lasts. `frontRun`
  is serial, so a wait that another wait replaced ends its loop.
- `SignAhead.open` passes no `serving`: it holds nothing of its own. The page's hold yields there too.
- Tests: `native/test_prompt_hold.py`, text checks of the wiring.
- Spec review: no fixes needed.

## Device run

- iPhone 15 Pro, iOS 27, this build.
- Servers: `worker/node.mjs` and a throttled IPA server on the desktop, over `tailscale serve`. Nothing was uploaded
  to production.
- Chromium has no native audio or suspension, so it could not do this run.
- Over Web Inspector: `signing.hold {on}`, then `signing.install {host: true}` of iFizBox's own 0.32.0 IPA. Home 4 s later.
- 22:33:18 background.
- 22:33:28 uploaded; the link waits for the app in front.
- 22:34:46 the page's hold let go.
- 22:34:51 iOS suspended the app.
- 22:35:53 in front: the link opened, the prompt was shown, and the call was answered ok.
- Cancelled. Nothing installed.
- Log: `phone.log` beside this file.

## Failed tries

- First: unthrottled. The upload was done in 3 s, in front, so the link opened before Home.
- Second: same process. The first run's unanswered, then cancelled, prompt was still polling with its own
  `CloseForUpdate` hold, so the page's hold was not alone and was not let go in the 110 s watched. The ui-15 tidy did
  not end the app; a go-ios kill did.

## Left on the phone

- This build, and an iFizBox signed record with the test URL. The app was killed.

## Not verified

- The before-state was not measured.
- The route through `SignAhead` `signing.open`: text and unit tests only.
- Return after the link expired: by reading only.
- Tapping Install after such a return.
- Return within the 60 s.

## Known limit

- As in the second try, a new update uploaded in the background while an earlier unanswered prompt still polls keeps
  the page's hold. Filed as B445.
