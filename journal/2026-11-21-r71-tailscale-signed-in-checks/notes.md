# R71: B316 checks on the iPhone 15 Pro with Tailscale signed in

## What I did (2026-11-21 23:14 UTC)

- Read the tailnet from the desktop (`tailscale status --json`, iFizBox machines only):
  - `iFizBox on iPhone 15 Pro` 100.95.9.37: offline, **key expired**, last seen 19:51 UTC.
  - Every other `iFizBox on iPhone…` node is offline; the four older ones are expired or stale, and
    `iFizBox on iPhone19,2` (the user's phone) was last seen 22:40.
- So iFizBox on the 15 is still signed out of Tailscale, as B316 left it. Every step R71 asks for needs it
  signed in first: Test/Check Connection going green, an install through Tailscale, then expiring the
  node, and reading the lockdown probe log over Tailscale.
- A Tailscale login needs the owner's account (memory: iphone15-tailscale-login-needs-owner; three earlier
  10-minute login windows timed out with nobody typing). This is an unattended late-night run, so I did not
  start a login window that nobody would finish. Instead the task blocks on the owner.

## How to unblock

On this desktop: `tools/remote-15.py` (serves http://<desktop Tailscale IP>:8098). Open iFizBox on the 15 >
Installation & Signing > Install Apps With > Tailscale > Sign In and finish the login in the browser page it
opens. After that, R71 can run the four checks unattended.

## Not verified

All four checks in the brief: (1) Test/Check Connection clearing Home's failure tile and the status cell,
(2) an install through Tailscale clearing it, (3) the expired-node → 'Tailscale Is Signed Out' → Sign In
path, (4) the lockdown control probe log. Why: iFizBox on the 15 is signed out of Tailscale and the login
needs the owner.
