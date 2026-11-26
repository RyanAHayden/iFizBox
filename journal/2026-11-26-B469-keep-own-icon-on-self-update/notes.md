# B469: the own app icon survives iFizBox's self-update in Lite

Lite (the sideload build) lost the picked own app icon when it updated itself from inside the app. The Changes row
(`installSelfNow` in `web/app/essential-ui.js`, `signing.install {url, host: true}`) and the queue's row for the app's
own ID (`signing.prepare`) both sign a downloaded IPA whose own-icon sets are placeholders. The next launch's
`tellIcon` got `resign_needed`, and `offerResign` asked "Use Your Icon Again?".

## Code

- Web, `web/app/screens/appicon.js`: `updateOwnIcon(read, onScreen)` picks the own icon the tone on screen shows, else
  the other tone's. It returns null when iconMatch is on or there is no own pick. `withOwnIcon(params)` adds
  `{ownIcon: name}` in the sideload mode only.
- Web, `web/app/essential-ui.js`: `installSelfNow` passes `withOwnIcon` output as `installOnDevice`'s params.
- Web, `web/app/signing/queue.js`: `prepareOnDevice` adds `ownIcon` for `job.id === SELF_ID`. There is an injectable
  `ownIcon` option for tests.
- Native, `native/Sources/AppIcon.swift`: `OwnIcons.selfFiles(name, current)` gives the own-set files. It shares
  `setFiles` with `selfSource`.
- Native, `native/Sources/Sideload.swift`: `ownIconPick(c)` reads `{ownIcon}` and `AppIcon.onScreen` on the main queue,
  because bridge calls arrive there. `withOwnIcon(options, pick, log)` sets `SignOptions.ownIconFiles` and logs
  "Keeping your own app icon in this update". On failure it logs and goes on without the icon, and the page then
  offers the re-sign as before. It is used in the `signing.install` url and token paths.
- Native, `native/Sources/SignAhead.swift`: one line in `signing.prepare`, because the queue signs there. This file was
  not in the task's list; the line was needed.

## Slot choice

`OwnIcons.plan`: when the running bundle's on-screen own set already holds the picture, the files go into that same
slot. After the update iOS keeps the alternate icon name, so `app.icon` finds nothing to switch and iOS shows no
alert. Otherwise the files go into the other slot, and `tellIcon` switches to it on reopen.

## Gating

The page sends `{ownIcon}` only for the app's own ID, from the Changes row. Native does not check the IPA's bundle ID.
The signer's `ownIconFiles` writes into any app's bundle, so another app that got it would only gain unused PNGs.

## Tests

- `web/app/screens/appicon-update.test.js`: `updateOwnIcon`, `withOwnIcon`, and `prepareOnDevice` sending `ownIcon`
  only for `SELF_ID`.
- `node --test` passes.
- native build: see gate

## Not covered

- `web/app/signing/install.js` line 39 (installing the app's own IPA from a source's app page, `isSelfIpa`) still goes
  without `{ownIcon}`. Filed as a follow-up.

## Not verified

- The 15 Pro check: pick an own icon, install an older build, update from Changes, reopen. Expected: own icon on the
  Home Screen, no prompt. Not run yet in this session.
