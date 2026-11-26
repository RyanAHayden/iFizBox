# B470: Lite's own IPA keeps the picked own icon on update

Updating iFizBox Lite from an app page sent its own IPA without the picked own icon, so the reopened app asked "Use Your Icon Again?".

## What changed

- `web/app/signing/install.js`: the `isSelfIpa` route of `signAndInstall` now loads `screens/appicon.js` `withOwnIcon({ url })` and passes the result as `params` to `installOnDevice` (`host: true`) when it has an `ownIcon`. Same as `installSelfNow` in `essential-ui.js` since B469. If the module fails to load, the install goes ahead without params.
- `signAndInstall` takes an optional second argument `{ install, ownIcon }` (defaults: `installOnDevice` and the `withOwnIcon` loader) so tests can replace them.
- `web/app/signing/install-ownicon.test.js`: new node test, 2 tests. One with an own icon (`params` is `{ url, ownIcon }`), one without (no `params` sent). Both check `host: true`.

## Failed attempts

None.

## Not verified

- On a device: an update of the iPhone 15 Pro with a picked own icon was not run. The next launch not asking "Use Your Icon Again?" is unconfirmed on a phone.
- Only the node test was run.
