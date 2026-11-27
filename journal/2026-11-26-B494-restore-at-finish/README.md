# B494 Restore My VPN at the finished button

- LocalVPN.installEnded(finished:) takes ours down with no linger when an install ended well and no other install is queued (no pause, only its own job). Linger stays while another is queued.
- The ending install's own SignJob was still registered, so SignJob.anyGoing held the look: SignJob.onIdle (last job ends) now calls RestoreBack.look().

**Not verified**
- iPhone 15 Pro timing (finished -> Shortcuts opening, before/after) and leave-within-1 s test: not run, no phone session in this unattended run; the Swift was not compiled on Linux beyond the gate.
