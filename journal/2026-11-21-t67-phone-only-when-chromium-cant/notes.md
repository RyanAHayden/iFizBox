# T67 Phone only when Chromium/local can't check

## What I did

- AGENTS.md: a new bullet after the iPhone 15 Pro one, **Phone only when Chromium/local can't check**, for both
  phones: `web/app/` changes go through Chromium (`tools/readme_shots.py` / `capture.mjs`, fake bridge) and
  `node --test`; a phone only for the native shell, signing/installing, iOS-only WebKit bugs, Home Screen icons,
  notifications; the journal says why Chromium couldn't do it; give the lock back (trap), the runner frees it when a
  session ends. The iPhone 7 bullet points to it.
- docs/iphone15.md: a "When to use it" section with the same rule, the trap and the runner cleanup.
- docs/iphone7.md: the rule under Rules (iOS 15 JS syntax named as the 7's iOS-only case), and the trap/cleanup
  beside the 30-minute stale line.
- Lock release when a task ends or is dropped: new `tools/ui-release.sh [ID]` (ID defaults to the worktree's
  branch, `task/<ID>`) runs `ui-15.sh`, `ui-7.sh`, `ui-4s.sh unlock ID`; each only removes a lock that ID owns, so
  another task's lock stays. `runner.toml` `[run] on_exit = "tools/ui-release.sh"`: agent-runner runs on_exit in the
  slot's worktree whenever a slot's session ends (loop.py `reap`, for an ended or a killed/dropped session alike).
  `tools/test_ui_release.py` covers: frees only its own, `task/` prefix, nothing held, `main` left alone.
- ui-15.sh: header comment only (Chromium first, trap, the runner cleanup). The 30-minute stale timeout stays.

## Choices

- runner.toml is outside the task's file list, but "the runner's cleanup" needs it, and it is one setting.
- I kept the stale timeout at 30 minutes: with the on_exit cleanup a dropped task no longer waits it out, and a
  shorter one could take the phone from a task in a long build between two taps.

## Not verified

- The on_exit hook firing in a real run: I can't end a slot's session from inside one. agent-runner may read
  runner.toml only when the run starts, so it may take effect from the next run start.
- A race: the runner starts on_exit (Popen, not waited for) and then saves leftovers and cleans the worktree. If
  the clean switched the branch before `git rev-parse` ran, the script sees no task and frees nothing (the lock then
  goes stale after 30 minutes as before). I did not change agent-runner (another repo) to pass the task ID.
