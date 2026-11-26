# B469: the own app icon survives iFizBox's self-update in Lite

Lite (the sideload build) lost the picked own app icon when it updated itself from inside the app. The Changes row
(`installSelfNow` in `web/app/essential-ui.js`, `signing.install {url, host: true}`) and the queue's row for the app's
own ID (`signing.prepare`) both sign a downloaded IPA whose own-icon sets are placeholders. The next launch's
`tellIcon` got `resign_needed`, and `offerResign` asked "Use Your Icon Again?".

## Code

- Web, `web/app/screens/appicon.js`: `updateOwnIcons(read, onScreen)` returns `[tone on screen's own icon, the other
  tone's]`, with no duplicates. It replaces `updateOwnIcon`. It returns null when iconMatch is on or there is no own
  pick. `withOwnIcon(params)` adds `{ownIcon, ownIconOther}` in the sideload mode only.
- Web, `web/app/essential-ui.js`: `installSelfNow` passes `withOwnIcon` output as `installOnDevice`'s params.
- Web, `web/app/signing/queue.js`: `prepareOnDevice` adds `ownIcon` for `job.id === SELF_ID`. There is an injectable
  `ownIcon` option for tests.
- Web, `web/app/signing/route.js` (outside the task's file list, one line): `askInsecure`'s url is `params.url` when
  params are given, so the Changes row's params (with ownIcon) keep the http-link memory as before.
- Native, `native/Sources/AppIcon.swift`: `OwnIcons.selfFiles(name, other:, current:)` gives the own-set files. It shares
  `setFiles` with `selfSource`. It draws the other tone's picture into the other own set (b when the first went in a,
  else a), and leaves that picture out if it can't be drawn.
- Native, `native/Sources/Sideload.swift`: `ownIconPick(c)` reads `{ownIcon}` and `{ownIconOther}` and `AppIcon.onScreen`
  on the main queue, because bridge calls arrive there. `OwnIconPick` carries `other`. `withOwnIcon(options, pick, log)`
  sets `SignOptions.ownIconFiles` and logs "Keeping your own app icon in this update". On failure it logs and goes on
  without the icon, and the page then offers the re-sign as before. It is used in the `signing.install` url and token
  paths.
- Native, `native/Sources/SignAhead.swift`: one line in `signing.prepare`, because the queue signs there. This file was
  not in the task's list; the line was needed.

## Slot choice

`OwnIcons.plan`: when the running bundle's on-screen own set already holds the picture, the files go into that same
slot. After the update iOS keeps the alternate icon name, so `app.icon` finds nothing to switch and iOS shows no
alert. Otherwise the files go into the other slot, and `tellIcon` switches to it on reopen. When light and dark pick
different own icons, the other tone's picture goes into the remaining set as well (see Code).

## Gating

The page sends `{ownIcon}` only for the app's own ID, from the Changes row. Native does not check the IPA's bundle ID.
The signer's `ownIconFiles` writes into any app's bundle, so another app that got it would only gain unused PNGs.

## Tests

- `web/app/screens/appicon-update.test.js`: `updateOwnIcons`, `withOwnIcon`, and `prepareOnDevice` sending `ownIcon`
  only for `SELF_ID`.
- `node --test` passes.
- native build passes: `native/build.sh`, with SWIFT_TOOLCHAIN and IOS_SDK from `~/.local/share`.

## Phone check (iPhone 15 Pro, ui-15.sh, lock B469)

- Built this branch with native/VERSION lowered to 1.0.2 (reverted, not committed), and installed it with
  `ui-15.sh install`.
- The rig install had no signing identity (Signing Needs Setup). The team's ad hoc cert.p12 and adhoc.mobileprovision
  were re-imported with `signing.import` over Web Inspector (pymobiledevice3 webinspector cdp).
- Added a test picture with app.icon.add, set darkIcon to it with iconMatch off, and picked it for Light with pickOwn.
  Its alert answered Install. The existing selfIcon re-sign installed through the Signing Server (sign.ifizbox.com
  /sign/host). On reopen iOS said "You have changed the icon" with the picture.
- Changes > iFizBox 1.0.3 row > Details > Modify > Upgrade > Confirm. This is the queue route for the self ID
  (signing.prepare).
- The Log said "Keeping your own app icon in this update" and "Own icon: 8 files of the own-icon sets replaced", and
  signed iFizBox 1.0.3 (the released IPA from GitHub). log.jpg is the Log.
- After Install on iOS's prompt, the Home Screen showed the picture at once (home-after-update.jpg).
- Reopening showed no "Use Your Icon Again?" and no iOS icon alert, since the picture went into the set already on
  screen (reopened-no-prompt.jpg).
- `ios apps` showed 1.0.3. The identity survived the two self-updates (no Signing Needs Setup after).

Phone left as:

- iFizBox 1.0.3 (the release, re-signed by the app).
- Ad hoc identity imported.
- Icon settings back to Glass with Match Theme on (iOS alert tapped OK).
- Test picture removed (app.icon.remove).
- CDP server stopped, lock released.

## Not covered

- `web/app/signing/install.js` line 39 (installing the app's own IPA from a source's app page, `isSelfIpa`) still goes
  without `{ownIcon}`. Filed as B470.

## Not verified

- The Changes row's own route was not driven on the phone. The row on this build opened Details, whose Upgrade goes
  through the queue. The Changes row's own route is `installSelfNow` in `essential-ui.js` (the Upgrade banner/row that
  goes straight to `signing.install`). It shares `Sideload.withOwnIcon` with the url path, but its page part is only
  covered by code reading.
- The two-different-icons case (`ownIconOther`) was not run on the phone. The phone's running build was made before
  that fix, so only the node tests cover the web part.
- The hosted vs This iPhone route: only the Signing Server route was run.
