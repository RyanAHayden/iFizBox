# F462: App Refresh renews iFizBox's own profile

The rule is in `docs/signing.md`, "App Refresh".

## What I did
- **`native/sign/Refresh.swift`**: `ProfileRefresh.ownAppID` and `Plan.own` added; `run` renews iFizBox's own profile.
- **`native/Sources/Sideload.swift`**: `signing.installed` answers `own` ("TEAM.identifier" or null), and
  `signing.refresh` takes the own profile into the run.
- **`web/app/core/freeroute.js`**: `refreshApps` runs the refresh when `own` is set, even with no recorded app.
- **Tests**: `native/sign/tests/sideload/main.swift` (a stub misagent), `web/app/core/freeroute.test.js`.

## Decisions
- **`own` is in `signing.installed`**: without it the page makes no refresh call when no app is recorded.
- **It is nil without the pairing**, so no progress page opens that could only do nothing.
- **The embedded profile must be free**: a paid one is left alone.
- **An expired embedded profile still counts**: the new profile is what revives it.
- **Sharing is by App ID**: iFizBox is renewed only when no other recorded app shares its App ID. A deleted app no
  longer counts.

## Checks run
- `node --test web/app/core/freeroute.test.js`: 30/30.
- `SWIFT_TOOLCHAIN=... python3 native/test_sideload.py`: OK (3 tests). A first run without `SWIFT_TOOLCHAIN` skipped
  all 3.

## Not verified
- Nothing on the iPhone 15 Pro. Open: whether iOS 27 accepts the profile through misagent for the running app after a
  Computer Install, and whether iFizBox's lifetime is really extended.
- A real check needs a free-Apple-ID Computer Install of iFizBox on the phone, which replaces the app there.
- The `Sideload.swift` glue (`signing.installed`'s `own`, `signing.refresh`) has no unit test, only the build.
