# B438: the page's hold also yields for an unanswered prompt

## Code

- `PromptHold.asleep` (not held, not requested, not ended, not over) replaces `unopened`, in
  `native/sign/PromptHold.swift`.
- `InstallPrompt.Awake` calls `Sideload.yieldPageHold` after every release. It goes on while `asleep` and
  `InstallPrompt.undecided` (the entry is still this install's and not known dismissed).
- A prompt closed with Cancel and then Home within 20 s is covered too: the watch only calls it dismissed with the
  app in front.
- `web/app/signing/queue.js` unchanged.
- Tests: `native/test_prompt_hold.py` and `native/tests/prompthold`.

## Device run

- iPhone 15 Pro, iOS 27, this build. Route: Signing Server. Chromium has no native audio or suspension, so it could
  not do this run.
- Over Web Inspector: the app's own `heldLanes`, `prepareOnDevice` and `openPrepared` with UTM SE.
- 22:11:40 opened. Opened again by itself at 22:11:48, so two prompts were stacked.
- 22:15:11 Home.
- 22:16:12 serving hold let go.
- 22:16:23 page's hold let go.
- Frozen by iOS from 22:16:58 to 22:17:43 (return).
- Both prompts cancelled. On return: no upload, listener back, the lane ended dismissed at 22:18:03. Nothing installed.
- `signing.cancel` sent afterwards.
- Log: `phone.log` beside this file.

## Not verified

- The before-state was not measured.
- Install tapped after return, and while suspended.
- The close-then-Home-within-20-s case: unit tests only.
- Another app still signing in the sign lane meanwhile (its own hold): text and unit tests only.
- The jailbreak build: no such route.

## Known limit

- While such a prompt waits, a gap over 10 s between signing calls in the background lets the page hold go early.
  The run goes on when the app is in front.
