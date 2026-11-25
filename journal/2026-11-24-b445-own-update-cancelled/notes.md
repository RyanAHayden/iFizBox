# B445: iFizBox's own update, cancelled or ignored, gives its hold back

## Decision

- `CloseForUpdate`'s own KeepAlive count is replaced by `InstallPrompt.Awake`, under the PromptHold rule: one per run.
- A newer run takes its hold before the older run's is given up.
- `hereBegan` and `giveUp` give it up.
- `asked` doesn't keep the hold: iOS's second question (Low Data Mode) can be cancelled after it, and iOS asks for
  iFizBox to be ended when it registers the install, before the download (B394), which a suspended app doesn't resist.
- `Awake` got an optional `waiting`, so the page's hold yields too while the prompt waits.
- `giveUp(late:)` posts no notification when the app was suspended past the link's life by 30 s.
- Polls in the background stop only because iOS suspends the app.
- `InstallPrompt.swift` was edited beyond the task's file list, for `waiting`.

## Code

- `native/Sources/InstallPrompt.swift`: `Awake` with `waiting`.
- `native/Sources/Sideload.swift`: `CloseForUpdate` takes its hold through `InstallPrompt.Awake`. `Hosted` (struct at
  about line 1583) gets `by` (the bundle path, new on each install), which must match for a link to be reused (`reusable`).

## Device run

- iPhone 15 Pro, iOS 27, this build. Node worker and IPA server over `tailscale serve`; nothing on production.
- Chromium has no native audio, suspension or installd, so it could not do this run.
- Times below are from `phone.log` beside this file.
- Unanswered prompt: Home 23:03:39, the hold let go 23:04:40, suspended 23:04:45. The prompt was still over the Home Screen.
- Install tapped there 23:05:23: iOS terminated pid 1161 at once. The IPA was fully fetched and the install landed.
- Cancelled 23:08:43 with the page's hold on. Home 23:08:46: ours let go 23:09:47, the page's 23:09:57, suspended 23:10:03.
- The reported case: cancelled, then a new update downloading slowly. Home 23:11:08, uploaded in the background 23:11:28.
  The older hold let go 23:12:09, the page's 23:12:41, suspended 23:12:46. In front 23:13:44 and the link opened.
- Same IPA after a Cancel: the link was reused and nothing was uploaded.
- In front: Install tapped 23:17:11, self-close 23:17:12, exit 23:17:13.

## Failed tries

- A JS `setTimeout` meant to start the second update did not fire in the background. It ran on return.
- Install on a stacked older prompt belonged to a superseded run, so the newest run's polls did not close iFizBox.
  Not changed here; only looked at because the test stacked the prompts.
- Killing the app let that install land, which made one go-ios install and launch fail (Busy). Redone after.

## Left on the phone

- This build, as installed by its own update.
- An iFizBox signed record with the test URL.
- The servers and the `tailscale serve` routes are stopped.

## Not verified

- iOS older than 27: that a suspended iFizBox is ended by the install there.
- The path fix on the device for the landed case. It is a text test; same-copy reuse was checked on the device.
- The late notification.
- The icon badge after iOS ended a suspended iFizBox.
- The Low Data Mode second question.
- The This iPhone route's `keep(nil)`.
- The page's queue run (web lane) with the page hold.

## Known limits

- A suspended iFizBox can't post "The iFizBox Update Didn't Start" when the link dies. The page says it on return.
- A prompt dismissed more than 5 s after it opened isn't noted as dismissed (`begin` has run): the minute then starts
  at Home. In front the hold changes nothing.
- `closeWith` (the icon badge) doesn't run when iOS ends iFizBox; so it was before when iOS ended it in the background.

## Review (spec axis)

- Fixed: `asked` kept the hold after a cancelled second question. This came after the device run, which was on the build
  where `asked` still kept it; only the in-front run reached that mark.
- Kept: `Hosted.by` and `giveUp(late:)`, needed once iFizBox may be suspended or ended by iOS.
