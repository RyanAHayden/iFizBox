# R64: B301 and F353 on the iPhone 15 Pro

Brief: the owner signed in to Tailscale in iFizBox on the 15 Pro (2026-11-21, after B301/F353 merged), and the
desktop's `tailscale status` showed no new node and none online. Check which build the 15 runs, which node is
ours, and whether Sign Out then Sign In keeps the count.

## Findings

### The owner's sign-in never reached iFizBox's node

Read-only, from the app's container (`afcclient --container com.ryha.ifizbox`, no screen lock needed),
`Library/Application Support/tailscale/` at 19:40 UTC:

| File | Phone time (EST) | UTC | What |
|---|---|---|---|
| `tailscaled.state` (119 B) | 13:46:49 | 18:46:49 | one entry: `_machinekey` (72 B), nothing else |
| `tailscaled.log2.txt` | 13:47:06 | 18:47:06 | 18:47:04 "To start this tsnet server … go to: https://login.tailscale.com/a/gb8b257957f94b808", 18:47:06 "logger closing down" |

18:46:49 is R57's own Sign In tap (journal/2026-11-21-r57-tailscale-new-login, round 2), which it closed with ✕.
Since then the app's node has not started: no log line, no state write. So the owner's later login (around
19:10 UTC) was not finished in iFizBox's login page for this node. Maybe it was typed on another page, maybe in
the Tailscale app (`iphone-15-pro-1` is the Tailscale app's own node on this phone: 100.109.186.91, hostname
`localhost`, online). Or the login page timed out before the login was sent. That explains "no new machine, none
online".

### The machine key on the phone is not `-5`'s

R57's round 2 tapped Sign Out at 18:46:09 on build 0.18.4 (3748), which is before B301. That Sign Out deleted
`tailscaled.state` and its Keychain copy. Its Sign In at 18:46:49 then made a **new** machine key, the one stored
now. B301 keeps the key only from a Sign Out done on a B301 build. So `-5` (and `-4`) cannot come back: their keys
are gone. The next login with this key **registers one new machine** (6 → 7 `ifizbox-on-iphone*` names, or a new
`ifizbox-on-iphone-15-pro`). That is expected and is not a B301 failure. B301's check is the Sign Out → Sign In
after that, which must not add another one.

### Which build the 15 runs

`ios apps` (read-only): `com.ryha.ifizbox` 0.19.1, CFBundleVersion **3913**. `native/build.sh` sets the build
number to `git rev-list --count HEAD`. The only local refs at 3913 are `task/B309` (head 9b667936, committed
19:35 UTC, which contains F353's merge d3227a86 (count 3867) and B301's merge 1f956e6d). So the phone now runs
B309's work-in-progress build, with B301 and F353. It was installed **after** the owner's sign-in (19:35 >
~19:10), so which build the owner's attempt ran on is not known. That doesn't matter: per the state file, the
attempt never reached the node.

### F353's name on a reused node: Tailscale renames it

`ifizbox-on-iphone-3` from R57's table (created 2026-11-20 23:24:26 UTC) is now listed as
**`ifizbox-on-iphone192`**: same created time, hostname `iFizBox on iPhone19,2`, online, last seen 19:20 UTC.
That node runs a build with F353 on an iPhone19,2 (not the 15 Pro: the user's newer phone). F353's table doesn't
list that model, so it fell back to the identifier. Two things follow:

- **A reused node takes the new name.** The control server renamed an existing machine when its hostname changed
  (it had not been renamed by hand). So once the 15's node comes back under B301, it should read
  `ifizbox-on-iphone-15-pro` even if it was first registered under an old name.
- **The fallback label is `iphone192`, not `iphone19-2`.** Tailscale drops the comma rather than turning it into
  a hyphen. F353's journal says `ifizbox-on-iphone19-1`, and `test_tailscale.py`'s `tailscale_label` maps every
  non-alphanumeric run to `-`. Both are wrong for punctuation, but only fallback names have any. A follow-up was
  filed (below).

## Desktop `tailscale status --json`, 19:38 UTC

| Node | HostName | Created (UTC) | Last seen (UTC) | Online | Key |
|---|---|---|---|---|---|
| `ifizbox-on-iphone` | iFizBox on iPhone | 11-19 23:19 | 11-19 23:30 | no | valid |
| `ifizbox-on-iphone-1` | iFizBox on iPhone | 11-19 23:30 | 11-19 23:31 | no | valid |
| `ifizbox-on-iphone-2` | iFizBox on iPhone | 11-20 06:06 | 11-20 21:08 | no | valid |
| `ifizbox-on-iphone192` (was `-3`) | iFizBox on iPhone19,2 | 11-20 23:24 | 11-21 19:20 | yes | valid |
| `ifizbox-on-iphone-4` | iFizBox on iPhone | 11-21 03:49 | 11-21 17:43 | no | expired |
| `ifizbox-on-iphone-5` | iFizBox on iPhone | 11-21 18:32 | 11-21 18:46 | no | expired |
| `iphone-15-pro-1` (Tailscale app, 15 Pro) | localhost | 11-21 03:47 | now | yes | |
| `iphone-15-pro` (old Tailscale app node) | localhost | 08-07 | 11-20 16:52 | no | |
| `iphone192` (Tailscale app, iPhone19,2) | localhost | 11-15 | now | yes | |

Six iFizBox machines, as the brief counted. The brief's "none online" was right for the 15. The renamed `-3`
didn't match an `ifizbox-on-iphone-N` name, so it was easy to miss.

### On the phone (under the 15's lock, 19:41–19:43 UTC)

- Settings shows `iPhone16,1, iOS 27.0.1, iFizBox 0.19.1 … Version 0.19.1 (3913) · 9b66793` (`shots/r64-2-build.jpg`),
  i.e. B309's head, so the build has B301 and F353.
- Settings > Installation & Signing > Install Apps With: Pairing "Paired", Connect With "Tailscale", and the
  Tailscale group shows **Sign In** (`shots/r64-5-signed-out.jpg`). The app is signed out, so **no node is ours
  right now**: the 6 `ifizbox-on-iphone*` machines are all old ones. `-5` was the last one the 15 used, and its
  key is gone (above).
- The signed-out footer still says `"iFizBox on iPhone"`. That's a fixed string in `web/app/core/installroute.js`,
  not the name F353 now registers. Filed as B313.
- I left the app on that page for the owner and gave the lock back.

## What is left (needs the owner's login, twice)

1. Owner: Tailscale > Sign In on the 15 and finish the login. Expected: **one** new machine (7 iFizBox machines)
   named `ifizbox-on-iphone-15-pro` (F353), online. It is new because the stored key is new, not because B301
   failed.
2. Then (agent, under the lock): Sign Out. The node should stay listed with an expired key, and
   `tailscaled.state` should hold only `_machinekey`, the same bytes as before (B301). Then Sign In.
3. Owner: finish the second login. Expected: still 7. The 15-pro node comes back online under the same
   name and Created time (B301).

Count to compare against: 6 `ifizbox-on-iphone*` machines at 19:38 UTC (table above).

## Follow-ups filed

- B311 (low): iPhone19,x identifiers missing from `Tailscale.modelNames`, and `tailscale_label` turns
  punctuation into `-` where Tailscale drops it.
- B313 (low): the signed-out footer's fixed `"<name> on iPhone"`.

## Not verified

- **B301 (Sign Out → Sign In keeps the machine)**: not run. Each Sign In needs the owner's Tailscale login (the
  login page keeps no session), and nobody typed one while I held the phone. Blocked on the owner.
- **F353's name on the 15**: not seen yet, for the same reason. The renamed `-3` (`ifizbox-on-iphone192`)
  shows the F353 code path working on another phone, with the identifier fallback.
- **Where the owner's earlier login went**: I can't tell from here. The app's state and log show it never
  reached iFizBox's node. Whether it was typed into the Tailscale app, or into a login page that had already
  closed, isn't recorded anywhere I can read.
- **Is `iPhone19,2` the user's iPhone 18 Pro?** A guess from the memory notes, not checked.
- **Whether the stored `_machinekey` matches any listed node**: `tailscale status` shows node keys, not machine
  keys, so this can't be compared from the desktop. The timeline (R57's pre-B301 Sign Out deleted the state at
  18:46:09, then this key was written at 18:46:49) is the evidence.
