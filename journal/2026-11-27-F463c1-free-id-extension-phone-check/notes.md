# F463c1: 15 Pro check of the free Apple ID extension

**Task:** Check F463c (free Apple ID: an app's extension gets its own App ID and profile) on the iPhone 15 Pro. Node and Swift stub tests passed before this, but they cannot sign or install. It has to run on the real phone. Lite build of this branch (main at b10d5a3a), installed with `tools/ui-15.sh`.

**Method:**
- Kept the certificate with `signing.export`, then `signing.remove`.
- Signed in with the spare free Apple ID. The 2FA Allow prompt and code appeared on the phone itself.
- Certificate Limit alert: revoked the old "iFizBox Website" certificate and left iloader's.
- Test app (journal/2026-11-27-f463c-free-id-extension-profiles/testapp, bundle ID `com.ryha.f463c1`, with a Share extension) was built from a scratch copy and put into iFizBox's Documents with `afcclient`.
- App queue run: `queueLibraryInstall` called over Web Inspector, and Confirm tapped on the screen.
- Custom Install: the real sheet, `customInstall` called over Web Inspector, and Install tapped. The test IPA was served by `tailscale serve` over https.

**Result:**
- PASS, queue: `signing.addProfile` for the app, then `signing.prepare` left Share.appex out and answered `missingExtensionAppIds`. The profile for the `.share` App ID was added, then `signing.discard`. The app was signed a second time with the extension under its own App ID, and installed. Apple accepted the extension's App ID.
- PASS, Custom Install: `signing.inspect` by token named `extensionAppIds`. Both profiles were added before `signing.install`, and the app was signed once and installed over the queue's copy. The App IDs already existed, so this path created none.
- PASS, Share sheet: the extension opens from the share sheet and shows "from app: written-by-app". The app then shows "from extension: written-by-extension". The first install is the keychain proof: before the extension had run, the app showed "none". After Custom Install the extension opened again; the values were left over from the first run, so that check only proves it runs.
- PASS: `signing.installed` lists the extension's App ID (`4549VNVVAG.com.ryha.f463c1.4549VNVVAG.share`) after both installs.
- PASS, App Refresh: `refreshApps` (core/freeroute.js) run with the live session over Web Inspector. The log had "Installed the new profile for com.ryha.f463c1.4549VNVVAG" and "Installed the new profile for com.ryha.f463c1.4549VNVVAG.share". The failed list was empty.

**Things learned:**
- The first launch is refused until the developer is trusted in Settings > General > VPN & Device Management. That is normal iOS behaviour for a free Apple ID. It was done on the phone through `tools/ui-15.sh` (Trust, then Allow).

**Phone restored:**
- Test app uninstalled and its record forgotten.
- `F463c1.ipa` removed from My IPAs (Saved IPA).
- Original certificate imported back (same serial).
- The two `ifizbox.freeid` localStorage keys removed.
- Developer trust gone with the last app.
- Tailscale not connected, and the `tailscale serve` port turned off.

**Left on the phone:**
- This branch's Lite build.
- The installed free provisioning profiles.
- The spare Apple ID now holds two new App IDs: `com.ryha.f463c1` and its `.share` extension.

**Not verified:**
- App Refresh through its button and setup flow in the UI. The function was run directly. A real renewal near expiry was not tested, because the profiles were minutes old.
- The plain Install button on a source app. Custom Install covered the `signing.inspect` path. Plain Install by URL shares ownAppId but was not tapped.
- Custom Install creating the extension's App ID from nothing. The App ID already existed from the queue run.
- Custom Install started from an app page's Custom Install row. The same function was called directly.
