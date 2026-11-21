# R57: a brand-new Tailscale login on the iPhone 15 Pro (B218's second half)

## Outcome

Half done on the phone, then blocked on the one step that needs the owner: typing the Tailscale login.

- **Sign Out, checked on the 15 Pro:** after Sign Out, the app's node `ifizbox-on-iphone-4` is **still listed**
  in the tailnet, with its key expired. The count stays at five, but the old node is left behind.
- **Sign In, the login page:** opens login.tailscale.com on the phone as it should (shot `r57-6`). Nobody typed
  the login in its 10 minutes, so it ended with "Couldn't Sign In: the sign-in didn't finish in 10 minutes" (`r57-7`).
- **What that means for the brief's pass rule** ("still 5 passes, 6+ means Sign Out leaves old nodes"): Sign Out
  deletes the node's state, so the next login registers a new machine, and the expired `-4` is still there
  beside it. Unless Tailscale removes the expired node when the new one logs in (not seen, and not what it
  usually does), the count goes to six on the first new login: a fail. Filed as **B301** (keep the machine key
  across Sign Out, so a later Sign In comes back as the same machine).

## What I did (2026-11-21)

1. R48 (the Tailscale sign-in hand check) had the 15's lock when I started, with the owner said to be at the
   phone. It tapped Sign Out at about 17:40 UTC and opened the login page twice (12:43 and 12:55 local); neither
   login was finished. I logged the tailnet's nodes from the desktop (`tailscale status --json`) every 20 s the
   whole time. R48 released the lock at 18:06 UTC with the app signed out; F324 held it until 18:10.
2. `tools/ui-15.sh lock R57`, `wake`, `launch`. The app was on F324's build (Settings footer: 0.18.4 (3748) ·
   a4b39df, which holds B218). Settings > Installation & Signing > Install Apps With, scrolled down: the
   Tailscale group shows **Sign In** only (signed out, `r57-5`).
3. Tapped Sign In at 18:10:55 UTC: login.tailscale.com opened in the app's sheet (`r57-6`). I left it alone and
   watched the tailnet every 15 s for 11 minutes: no new node. At 18:22 the app showed the 10-minute alert
   (`r57-7`). I tapped OK and released the lock.

The phone is left as R48 left it: signed out of Tailscale, Connect With still on Tailscale. Tailscale installs
on the 15 wait for the owner's login, whichever of R48 or R57 they answer first.

## The tailnet's nodes (`tailscale status --json` on the desktop)

Before (R57's first attempt, earlier on 2026-11-21) and now (18:04 to 18:22 UTC, unchanged through the whole
watch):

| Node | Created (UTC) | Last seen (UTC) | Key |
|---|---|---|---|
| `ifizbox-on-iphone` | 2026-11-19 23:19 | 2026-11-19 23:30 | valid to 2027-05-18 |
| `ifizbox-on-iphone-1` | 2026-11-19 23:30 | 2026-11-19 23:31 | valid to 2027-05-18 |
| `ifizbox-on-iphone-2` | 2026-11-20 06:06 | 2026-11-20 21:08 | valid to 2027-05-19 |
| `ifizbox-on-iphone-3` | 2026-11-20 23:24 | 2026-11-21 18:00 | valid to 2027-05-19 |
| `ifizbox-on-iphone-4` | 2026-11-21 03:49 | 2026-11-21 17:40 | **expired** (expiry shown as 2026-11-20 17:42) |

Five nodes, the same five as before. `-4` was the app's node until Sign Out; its expiry now reads a day before
the sign-out, which looks like how Tailscale marks a logged-out key (it stamps it in the past). Nothing was deleted.

`-3` shows "last seen 18:00" while the 15's app was signed out. Something else still runs `-3`'s state: another
install of the app (another phone or a Simulator) or an older Keychain copy. Not followed up; it doesn't change
the count.

## Why the next login adds a node (code, read)

`native/sideload/tailscale/Tailscale.swift` `tailscale.signOut`: starts the node, `TSLogout()`
(`LocalClient.Logout`: the tailnet expires the node key but keeps the machine listed, as seen above), stops it,
then `Tailscale.forget()` deletes `tailscaled.state` and the Keychain copy (`TailscaleKeep.forgetNode()`). The
next Sign In has no machine key, so the tailnet registers a new machine and names it `ifizbox-on-iphone-5`
(the name `-4` is still taken). Tailscale re-registers the *same* machine only when the same machine key logs
in again, which is B301's fix.

## Shots

At a third of their size in `shots/` (full size in the main checkout's `ref/15/screens/`, gitignored):
`r57-5` signed out (Sign In row), `r57-6` login.tailscale.com open from Sign In, `r57-7` the 10-minute alert.

## What the owner is asked

`BLOCKED`: be at the 15 Pro for 10 minutes to type the Tailscale login. R57 (or R48, whichever reopens first) opens the
page. After it, R57 reads the count (expected six with today's code: a fail, B301), signs out and in once more
for the brief's "twice" (a second login, so the owner types it again), and checks that Test with no Sign Out
adds nothing. If B301 lands first, the same run checks the fix instead: five before and after.

## Not verified

- **A new node after a real login**: nobody typed the login (two R48 windows and one R57 window, about 30
  minutes in all), so the count after Sign In, and the name the new node gets, are expected from the code and
  the expired `-4`, not seen.
- **The second Sign Out → Sign In cycle** and Test after it: they need a login first.
- **The admin console** (login.tailscale.com/admin/machines) was not read: no login on this machine. The
  desktop's `tailscale status` lists the same tailnet's machines, expired ones included, which is what the
  brief allows instead.
- **Who runs `-3`** (last seen 18:00 UTC while the 15's app was signed out): not looked into.
