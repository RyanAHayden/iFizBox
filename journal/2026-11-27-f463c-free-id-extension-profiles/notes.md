# F463c Free Apple ID: extension profiles

The shell now hands each app extension's profile to the signer and keeps it renewed, so a free-Apple-ID app with
extensions can be signed and refreshed without the page making its own IDs.

What changed:

- `FreeAppID.extensionsToSign` computes the extension App IDs; the signer and `signing.inspect` both use it.
- `signing.inspect` answers `extensionAppIds`, also by `{token}`.
- `signing.prepare` answers `missingExtensionAppIds`; the page makes them and signs again.
- Signed records keep `extensionAppIDs`; App Refresh renews them through misagent.
- Extension keychain groups name the app's group first.
- The page's `extensionAppId`/`appIdsFor` are gone; `ensureExtensionAppIds` replaces them and takes IDs from `signing.inspect`.

Why the queue signs twice: the app queue never reads the IPA before signing, and `signing.prepare` takes no token, so
it learns the extension IDs from the signer's report. An app with extensions is downloaded and signed twice when no
usable extension profile is kept.

Known gap: Manage's Re-sign (`signing.resign`) does not add extensions to an app whose record names none. docs/signing.md says so.

Verified: node tests freeappid, route-freeappid, freeroute, resign-freeappid (55 pass); `native/test_sideload.py`
with the Swift toolchain OK, including extension signing and refresh tests; `native/build.sh ipa` (Lite) builds; the
test app compiles.

Not verified (F463c1, iPhone 15 Pro): install of an app with an extension under a free Apple ID, the extension
running, keychain sharing, App Refresh renewing the extension profile. Apple accepting these extension App IDs
through the free portal is also untested.

Test app: `testapp/` holds `app.m` and `make.py`. `python3 make.py <path to rustup's ld64.lld>` builds `F463c.ipa`,
an app with a share extension (`com.ryha.f463c`, `.share`).
