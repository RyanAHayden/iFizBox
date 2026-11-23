# C64: remove the Tailscale route and LocalDevVPN (not started)

## What I did

Checked the task's precondition before removing anything. Nothing in the code has changed.

- The task opens with "Once the user OKs F372's built-in VPN on their phone".
- The plan blocked it with "(after V8) remove only after the user verified the built-in VPN in the V8
  release" (commit 73e393fb).
- V8 was then dropped ("V10 is the release; covers it"). The runner counts a dropped task as landed, so it
  reopened C64 (fe53889c). V10 (0.22.0, with the built-in VPN) merged at 23:36 on 2026-11-22, minutes
  before this session started.
- Nothing in the plan or git history says the user tried 0.22.0's built-in VPN on their own phone. The only
  phone check so far is F372's own run on the iPhone 15 Pro (Test Connection, one install). The user's R66
  note ("LocalDevVPN isn't used any more") is about LocalDevVPN, not about the built-in VPN working on their
  phone.

## Decision

Blocked on CONFIRM, with no code removed. A branch closed with `done --blocked` still merges (agent-runner
README, "part landed with the rest stuck"), so doing the removal now and then blocking would land it before
the OK. That would take away Tailscale, the route the user's phone can still fall back to, before the
built-in VPN has been checked there.

## Not verified

- Whether the user has already tried the built-in VPN on their phone and just didn't write it in the plan.
  Nobody is around to ask during an unattended run.
