# B435: the install prompt's keep-alive hold

## Code

- The rule is pure Swift: `native/sign/PromptHold.swift`. `InstallPrompt.Awake` (`native/Sources/InstallPrompt.swift`)
  feeds it and calls KeepAlive. `serveChecked` no longer calls KeepAlive itself.
- Tests: `native/test_prompt_hold.py` and `native/tests/prompthold/main.swift`.
- Waking after our own release looks like B89's freeze, which would upload the IPA to the Signing Server.
  `PromptHold.slept` skips that upload. An upload after a real freeze keeps the hold until it ends.
- Every open of the install link takes the hold, not only Try Again. A prompt that could first open only once the
  app is in front is covered.
- The 15 min expiry timer is now wall clock, since the app may be suspended.
- The expiry log line went through `serverLog`, which counts as iOS asking for the IPA. It now goes through
  `InstallLog.say`.

## Device runs

Phone: iPhone 15 Pro, iOS 27. Route: Signing Server (ifizbox.com). Driven by `signing.install` and `signing.reprompt`
over Web Inspector. Device log in `phone.log`.

- Run 1 (Alpha 1.1.0): no prompt was seen within 8 s of the link (likely iOS was slow to show it), so the existing auto-reopen opened a second one.
  One was cancelled. Home at 21:12:10, hold let go at 21:13:11. "Froze" 13 s on return, no upload, listener back.
  Install on the second prompt, still up, took the hold again at iOS's HEAD and installed.
- Run 2 (UTM SE, 244 MB): Install, then Home at once. Sent in full, installed, hold let go 2 min later (grace).
  iOS copied it from loopback in under a second or so, before Home landed.
- Run 3 (Alpha 1.2.0): Cancel 21:17:38, Home 21:17:53, let go 21:18:38. Suspended from 21:19:14 (InstallServer's own
  background task gives about 30 s more). Back 21:20:22, no upload. `signing.reprompt` took the hold again, the prompt
  showed, and Install installed 1.2.0.
- `idevicesyslog` dropped some lines (run 1's GET). Installed version confirmed with `ios apps`.
- UTM SE uninstalled afterwards. Test Alpha 1.2.0 left on the phone.

## Review fixes after the device runs

- A request for an earlier install of the same app (still served) no longer marks the new one's prompt or hold.
- `reprompt` takes the hold at the tap, not only when the link opens.

## Not verified

- The review fixes on the phone: the build and the text tests only.
- A download still in progress as the app goes to the background (loopback too fast).
- iOS's first request arriving in the last ~30 s of background time after the release. Audio may not be allowed to
  start from there; InstallServer's background task gives about 30 s.
- Install tapped while the app is suspended. iOS can't reach it; the row's Try Again is the way.
- A real freeze with upload keeping the hold, the expiry, and Cancel: unit tests only.
- The row's Try Again button itself. The same `signing.reprompt` call was used.

## Follow-up

- Filed B437: `holdUntilAnswer` keeps the app awake while a prompt waits for the app in front.
