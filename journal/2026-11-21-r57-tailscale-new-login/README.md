# R57: a brand-new Tailscale login on the iPhone 15 Pro (B218's second half)

## Outcome

**Fails the brief's rule: a Sign Out then Sign In added a machine.** The tailnet went from five
`ifizbox-on-iphone*` nodes to six with the owner's first new login (seen once), and the second Sign Out left that
new node listed too (expired), so the next login is expected to make seven (not seen). B301 (keep the machine key across Sign Out) is the fix;
this run confirms what it predicted.

- **Round 1** (owner typed the login, 2026-11-21 about 18:32 UTC, during R48's window): Sign Out had left
  `ifizbox-on-iphone-4` listed with an expired key; the login then registered a new machine,
  **`ifizbox-on-iphone-5`** (created 18:32:39 UTC). Count: **6** (owner's own count from `tailscale status`,
  and mine at 18:45).
- **Round 2** (driven by me on the 15 at 18:46 UTC): Sign Out. `-5` stayed listed, its key turned expired at
  18:46:11 UTC, the second of the tap. Count after Sign Out: **still 6**, nothing removed. Sign In opened
  login.tailscale.com asking for an email again (`r57-14`): the page keeps no session from round 1, so the second
  login needs the owner's password. The user said to record the count in that case, so I closed the page.
- **Count after the second Sign In:** not measured (no login typed). From round 1 and the two expired nodes it is
  expected to be 7 (`ifizbox-on-iphone-6`).

## What I did

### First attempt (earlier on 2026-11-21, blocked for the login)

1. R48 had the 15's lock, tapped Sign Out at about 17:40 UTC and opened the login page twice; neither login was
   finished. I logged `tailscale status --json` from the desktop every 20 s.
2. Under my lock: the app (0.18.4 (3748) · a4b39df, which holds B218) was signed out (`r57-5`). Sign In opened
   login.tailscale.com (`r57-6`); nobody typed the login in its 10 minutes, so it ended with "Couldn't Sign In"
   (`r57-7`). No new node in that time. Blocked asking the owner to type the login.

### Second attempt (after the owner's answer)

The owner logged in on the 15 (in R48's window; R48's merged note says the page sat connected as
`ifizbox-on-iphone-5`) and counted six nodes from the desktop.

1. 18:45 UTC: `tools/ui-15.sh lock R57`, `wake`, `launch`. The app opened on Install Apps With, signed in:
   Device `ifizbox-on-iphone-5…`, Test Connection, Sign Out (`r57-10`). The footer reads "This iPhone is
   100.109.186.91 on your tailnet": that is `iphone-15-pro-1`, the Tailscale app's node, not iFizBox's own
   (`-5` is 100.76.143.64). Correct for the footer's meaning (the address iFizBox reaches the phone at).
2. 18:46:02 tapped Sign Out, the confirm sheet came up (`r57-12`), 18:46:09 tapped its Sign Out. The group turned
   to Sign In (`r57-13`).
3. 18:46:30 `tailscale status --json`: six nodes, `-5` expired at 18:46:11 (table below).
4. 18:46:49 tapped Sign In: login.tailscale.com with an empty email field (`r57-14`). Closed it with ✕; the page
   went back to Sign In with no alert. Released the lock.

The phone is left signed out of Tailscale in iFizBox, Connect With still on Tailscale. Tailscale installs from
iFizBox on the 15 wait for the next login (B301's check will need one anyway).

## The tailnet's nodes (`tailscale status --json` on the desktop, 18:46:30 UTC)

| Node | Created (UTC) | Last seen (UTC) | Key |
|---|---|---|---|
| `ifizbox-on-iphone` | 2026-11-19 23:19 | 2026-11-19 23:30 | valid to 2027-05-18 |
| `ifizbox-on-iphone-1` | 2026-11-19 23:30 | 2026-11-19 23:31 | valid to 2027-05-18 |
| `ifizbox-on-iphone-2` | 2026-11-20 06:06 | 2026-11-20 21:08 | valid to 2027-05-19 |
| `ifizbox-on-iphone-3` | 2026-11-20 23:24 | 2026-11-21 18:40 | valid to 2027-05-19 |
| `ifizbox-on-iphone-4` | 2026-11-21 03:49 | 2026-11-21 17:43 | **expired** (shown as 2026-11-20 17:42) |
| `ifizbox-on-iphone-5` | 2026-11-21 18:32 | 2026-11-21 18:50 | **expired** (shown as 2026-11-20 18:46) |

Both expiries read exactly a day before the Sign Out that caused them (17:42 and 18:46:11); my guess (not
checked) is that this is how the tailnet marks a logged-out key. Nothing was deleted. `-5`'s "last seen 18:50"
is what the 18:46:30 query returned, ahead of the clock; copied as reported, not explained.

`-3` still shows recent "last seen" times while the 15's app was signed out, so something else runs `-3`'s state
(another install of the app, a Simulator, or an older Keychain copy). Not followed up; it does not change the
count rule.

## Why each login adds a node (code, read)

`native/sideload/tailscale/Tailscale.swift` `tailscale.signOut`: starts the node, `TSLogout()` (the machine stays
listed with an expired key, as seen twice), stops it, then `Tailscale.forget()` deletes `tailscaled.state` and
the Keychain copy (`TailscaleKeep.forgetNode()`). The next Sign In has no machine key, so the tailnet registers a
new machine under the next free name. Seen for `-4` → `-5`. B301 keeps the machine key across Sign Out.

The login page keeps no session between Sign Ins (round 2 asked for the email again), so every Sign In after a
Sign Out costs the user a full login. That is the login page's own cookie handling, not something B301 changes.

## Shots

At a third of their size in `shots/` (full size in `ref/15/screens/`, gitignored): `r57-5` signed out,
`r57-6` login page from Sign In, `r57-7` the 10-minute alert (first attempt); `r57-10` signed in as `-5`,
`r57-12` the Sign Out confirm, `r57-13` signed out again, `r57-14` the login page asking for the email again.

## Not verified

- **The count after the second Sign In** (expected 7): the login page asks for the owner's password again and
  the user said to record the count instead of asking a second time.
- **Test Connection after a second login**: same reason. R48 covered Test after the first login.
- **The admin console** (login.tailscale.com/admin/machines): no login on this machine. The desktop's
  `tailscale status --json` lists the same tailnet's machines, expired ones included, which the brief allows.
- **Who runs `-3`**: not looked into.
