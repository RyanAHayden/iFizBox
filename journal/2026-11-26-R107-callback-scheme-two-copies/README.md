# R107: Shortcut callback goes to another iFizBox copy

Research only, no product change.

## What is in the code
- `native/Info.plist` and `native/Info-sideload.plist` both declare the scheme `ifizbox`. Every build and every re-signed
  copy carries it, whatever its bundle ID (`com.ryha.ifizbox`, or `com.ryha.ifizbox.<TEAM>` such as `.4549VNVVAG`).
- `RestoreShortcutBridge.swift:135` and `CellularShortcutBridge.swift:113` build the callback as
  `ifizbox://<host>?id=<id>&r=<result>` and pass it to Shortcuts as `x-success`/`x-error`/`x-cancel`.
  The handlers (`:147`, `:128`) accept any URL with scheme `ifizbox` and the right host.

## How iOS picks between two apps with one scheme
Apple documents no rule: a custom scheme claimed by several apps is not guaranteed to go to any one of them
(the Info-sideload.plist comment says "iOS gives a scheme to one app when several claim it"). In practice it is the
app LaunchServices registered last for that scheme (the most recent install or update), and it can change after
a reinstall. No API asks which copy owns it. So a callback with the shared scheme is a race between copies, and
B490 lost it: the other copy came to the front and ours logged no "back done".

## Can users have two copies?
Yes. The free Apple ID route installs under a team-suffixed ID (`com.ryha.ifizbox.<TEAM>`), because a free account
cannot reuse an ID another team holds. A user who keeps the App Store/TestFlight/earlier sideload copy and then
re-signs gets two copies, each with `ifizbox://`. Re-signing in AltStore/SideStore/Feather often does the same.
So the case is real, not only a test-phone leftover.

## Should the callback use its own scheme per bundle ID?
Yes, for the two Shortcut callbacks only. Declare a second scheme in Info-sideload.plist that is unique per copy,
and use it for `x-success`/`x-error`/`x-cancel`. Options:
1. Scheme derived from the bundle ID, `ifizbox-<bundle id>` (lowercase, dots allowed in schemes). It must be written into
   Info.plist when the copy is signed (the signer already rewrites the bundle ID, so it can rewrite this too), and read
   at run time from `Bundle.main.bundleIdentifier`, so no list to keep. Recommended.
2. Keep `ifizbox://` and add a bundle ID to the query, then have the wrong copy forward it. Does not work: the wrong
   copy opening is the problem, and forwarding needs a second app switch.
3. Universal link: needs a server and an associated domain per ID. Too heavy.

Limit: a copy installed before the fix has only `ifizbox://`, so it cannot be addressed by its own scheme. The fix
helps the copy that has it; the old copy's own callbacks (no own scheme) stay as now. `LSApplicationQueriesSchemes`
is not needed to open a URL from Shortcuts, only to call `canOpenURL`.

## Not verified
- Which copy iOS picks on the 15 Pro was not measured here (research, no device). The "last registered wins" rule is
  from B490's two runs and general behaviour, not documented.
- Whether the signer in this repo can rewrite the extra scheme per copy was not read in depth; the follow-up checks it.
