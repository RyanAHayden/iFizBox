# F437: restore the VPN before iFizBox closes

Control session 2 asked whether to queue this. The answer was "Queue it".

## Queued

F438 (normal): run the Restore My VPN Shortcut's back run just before iFizBox closes on its own update by the This iPhone route, so the VPN comes back without a reopen. Only when the back run is owed and can run unasked.

## Where it came from

- The user's 0.32 to 0.34 update closed. It only finished after the app was reopened and the Shortcut ran.
- That stick is most likely the bug B440 fixed. It is not proven, since there is no phone log.
- None of B440's 10 of 10 runs on the 15 ran the Shortcut.

## Left out

- Other apps' installs. Their progress and success come over our VPN, and dropping the connection cancelled an install in a test.
- The Signing Server route.

## Not built or tested

Nothing was built or tested here. This is a plan entry only.

## Not verified

- That opening Shortcuts in the window works. (In the queued task.)
- That the Shortcut's callback does not reopen the old copy. (In the queued task.)
- That B440 was the user's cause. There is no phone log.

## Size

`plan add` called F438 slightly too big (11 over a limit of 10). Left whole: it is one behaviour, and its code cannot
be checked apart from the phone runs. Most of the count is test files and risk notes.
