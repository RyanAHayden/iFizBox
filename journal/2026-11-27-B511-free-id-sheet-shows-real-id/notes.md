# B511: Custom Install's sheet shows the app's own App ID under a Free Apple ID

## The bug
With a Free Apple ID, Custom Install's sheet showed the held App ID (`com.ryha.ifizbox.<TEAMID>`) in its Bundle ID row
and in its footer ("Your profile signs it as ..."). The install makes `<bundle ID>.<TEAMID>` first (the app's own App
ID, `signing/freeappid.js withOwnAppId`) and installs as that. So the sheet named an ID the install never used, for an
app that had no profile of its own yet. Found on the 15 Pro in T89 and filed as a follow-up.

## What changed
- `web/app/signing-sheet.js`: new `withRealId(info, native)`, used by `inspectAndInstall` and `inspectToQueue` right
  after `signing.inspect`. When `pinned` is true and `freeAppId` differs from `signsAs`, it returns the look with
  `signsAs` and `appIdAs` set to `freeAppId`, so the row, the footer and the comparison use the app's own ID and no
  `bundleId` is sent.
- The exception: an app already installed under the held App ID stays there. `withRealId` keeps the held ID in that
  case, through `staysOnHeld`, the same rule the install uses.
- `web/app/signing/freeappid.js`: `staysOnHeld` is now exported (a one-word edit outside the task's files), so the
  sheet reuses that rule instead of copying it.
- `web/app/signing-sheet.test.js`: one new test, "B511: pinned, before the app's App ID is made". It checks that a
  fresh app shows its own ID, the footer names it, and no bundle ID is sent; and that an app installed under the held
  ID shows the held one.

## Checks
- `node --test web/app/signing-sheet.test.js web/app/signing/freeappid.test.js`: 21 pass, 0 fail.
- The full gate, `tools/check.sh`, runs at `done`.

## Not verified
- Not run on the 15 Pro. The check asked for is the node test above.
- The native shell was not changed.
- Known limit: with no Apple session and no app holding the held App ID (for example an imported free profile whose
  App ID is not installed), the shell would install as the held App ID while the sheet shows the app's own.
