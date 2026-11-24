# R86: RyukGram wiped its settings again (third report)

## Verdict
No cause found. Nothing could be checked on the phone, and step 1 (the user's log) is still missing, so no fix is guessed and no B is filed.

## What is known (from the plan note and B390's journal, journal/2026-11-23-b390-ryukgram/notes.md)
- User report 2026-11-23 about 18:55 EST: RyukGram wiped its settings "after not doing anything fancy". Third report.
- SideDrop's Instagram/RyukGram copy: IPA last changed 2026-11-22 19:52Z, signed copy re-made 2026-11-23 15:35Z (C65's deploy), not since (read 23:57Z). So SideDrop did not re-sign it just before the report; when the phone installed it is not known.
- A missing Library/ifizbox-groupfix.log only means no iFizBox-signed launch with B390's fix in that container (older signer, or SideDrop's fix, whose log was not checked).
- B390 on the iPhone 15 Pro (iOS 27) with real RyukGram 453/456: re-signs (ours, SideDrop's signer, both), reboot, update all kept settings. Only a delete and reinstall lost them (the container is new). RyukGram's "Mask everything & relaunch" cleared sign-in but kept settings.
- B392 (stale own-group keychain item) and B393 are finished on their branches but not released (0.26.0 lacks them).

## Step 1: what is needed from the user
Open RyukGram's FLEX file browser, Library/ifizbox-groupfix.log, send the lines. How to read it: no file = no launch with 0.26.0's fix in this container; only new lines = new container (reinstall or another bundle ID) or cleared Library; a long log = container kept, and the "N preferences" count per launch shows when the settings went; a drop with the same container = the app or a tweak cleared its preferences, not the signing. Also ask: which signer (SideDrop or iFizBox), version, whether logins went too, whether an update or re-sign ran before.

## Step 2: not run, and why
- RyukGram's own settings screen is only reachable when signed in to Instagram (B390 had to write the setting keys with a spy dylib instead). No Instagram login exists on this machine and a login is a person's, so "settings changed through its UI" cannot be done unattended. Writing keys with a spy proves nothing new over B390 (step D2 already showed the clearing itself is the only thing that removes them).
- So the plain-use checks (kill and reopen, background launch, low storage/cfprefsd kill, account switch or sign-out, Clear device & relaunch, per-account settings, update notice) were not run, and B392+B393's build was not made here.
- The phone was not used (no lock taken).

## Plan for when a login exists (a person signs in once on the 15 Pro)
Install RyukGram 456 (IPA kept in an earlier session's scratchpad; get the newest from the source), change a few RyukGram settings through its UI, then after each of: kill and reopen; a background launch; cfprefsd kill; account switch/sign-out; Clear device & relaunch; update notice — snapshot standard prefs (spy dylib from journal/2026-11-23-b390-ryukgram/spy.m) and diff with cmp.py. Then repeat with B392+B393's build. Say plainly if RyukGram's own code empties them.

## Not verified
Everything in step 2; the user's phone, its signer and history; whether logins went with the settings.
