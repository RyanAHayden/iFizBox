# F374: Installed Apps, Decrypt and Inject Tweaks in the jailbreak app

## What was built

- **Helper** (`native/helper/decrypt.c`, `decrypt.h`): two verbs dispatched in `main.c` before the plan code, so
  `policy.c` is untouched.
  - `ifizbox-helper user-apps`: one line per app in installd's containers:
    `<id>\t<name>\t<version>\t<build>\t<.app path>\t<encrypted 1|0|>\t<store 1|0>`. Encrypted is read from the
    main executable's `LC_ENCRYPTION_INFO(_64)` cryptid (thin 32/64-bit and fat files, `helper_macho_crypt`).
  - `ifizbox-helper decrypt-app <id>`: every Mach-O of the .app still encrypted is written decrypted (cryptid 0) to
    `/var/mobile/Library/Caches/com.ryha.ifizbox/decrypt/<id>/<path in the .app>`, owned by that folder's owner;
    only those files, the app reads the rest of the bundle itself. Root writes there only through directory fds it
    opened `O_NOFOLLOW`, new folders/files with `mkdirat` / `O_EXCL`, `fchown` once written.
  - How it decrypts: first `mremap_encrypted` over a private `PROT_READ|PROT_EXEC` mapping (the trap itself:
    libSystem doesn't export it and `syscall(2)` is deprecated in the SDK). When that fails (a binary never run on
    this phone), the binary is started with `POSIX_SPAWN_START_SUSPENDED`, its encrypted range read through the task
    port (`task_for_pid` + `vm_read_overwrite`: the kernel decrypts each page for the read) and killed before any of
    its code runs. New helper entitlements: `task_for_pid-allow`, `com.apple.system-task-ports`.
  - A file FairPlay still refuses stays encrypted ("Still encrypted <path>: <why>" line); only the main executable
    failing stops the run (exit 1).
- **Shell** (`native/Sources/InstalledApps.swift`): `apps.icon` (UIKit's private
  `_applicationIconImageForBundleIdentifier:format:scale:`, format 2), `library.decrypt` (runs the helper, zips
  `Payload/<App>.app` with the decrypted files in place into My IPAs as "<App> <version> (decrypted).ipa"; leaves out
  `SC_Info/` and any extension still encrypted; never `iTunesMetadata.plist`), `library.addTweaks` (copy of a library
  IPA, entries copied raw, the main executable through `MachOEdit.inject`, tweak files under the .app; refuses an
  executable still encrypted) and `library.share` (share sheet for the file itself).
- **Web**: `core/userapps.js` (parse, rows, copies, stream lines), `screens/userapps.js` (the list with icons, an
  app's page: Details, Decrypt / Decrypt Again, Inject Tweaks group, Build IPA with Tweaks), routes and the
  "Installed Apps" row in Install IPAs' Add an IPA group (`myipas.js`), Share on a jailbreak IPA's page,
  `backend-native.js` `userApps` / `decryptApp` / `addTweaksTo`.

## Decisions (unattended run)

- Where the list lives: under Install IPAs (`#/installed/myipas/userapps`), a row in its "Add an IPA" group, since
  Decrypt makes an IPA there. `installed.js` is not in the task's files, so the Installed tab is not changed.
- The group with the tweaks keeps its own header "Inject Tweaks": GLOSSARY.md's "Add Tweaks" is the page under an
  app's Details (tweaks from Tweak Sources), a different thing.
- "Through the existing Inject Tweaks flow": the page uses the same group (`tweaksGroup`: files kept per app,
  `prepareTweaks`, the bundled ElleKit via `preparedItems`) and the same `TweakSet` / `MachOEdit.inject` the signer
  uses; only the last step is new, because the jailbreak build doesn't sign: `DecryptedIPA.withTweaks` writes the
  copy without signing it (install-ipa's ldid signs it at install).
- A file still encrypted outside an extension (a framework of the app) makes Decrypt fail with its name instead of
  packing an IPA that couldn't run (spec review); a still-encrypted extension is left out with a line.
- In the jailbreak app the Inject Tweaks group takes tweaks from Files only: "from a Source" is the sideload app's
  Tweak Sources (`tweakSourcesOn` is sideload-only), so it would list nothing here.
- Installing a tweaked or decrypted copy back over the App Store app is not offered from Installed Apps. The copy
  lands in My IPAs; its page has the usual Install (helper install-ipa, ldid signs it) and the new Share. So the
  user's app is never replaced unless they install that copy themselves from its page.
- Code: no decrypter's code copied (GPL-compatible by being our own). flexdecrypt / fouldecrypt (mremap_encrypted) and TrollDecrypt / bfdecrypt
  (reading a launched app's memory) only gave the approach.

## What failed on the way (iPhone 7, iOS 15.8.8, palera1n)

1. `mremap_encrypted` alone (a standalone build of `decrypt_driver.c` run with `sudo` over ssh, against X 12.45.1, the
   only App Store app on the phone): the main executable and the widget extension decrypted, the four other
   extensions failed with EPERM. The EPERM was from `mmap(PROT_READ|PROT_EXEC)`, not from the decrypt: a binary
   never run on the phone has no code signature registered yet.
2. Spawning the extension suspended and killing it (no read), then `mremap_encrypted` again: still EPERM.
3. Running the extension once for real (by hand, `sudo <path>`; it exits by itself) made it decryptable after: so
   FairPlay loads the key when an encrypted page is first read. Not something to do in the product (its code runs).
4. Spawned suspended, the process's memory already reads decrypted (`fd430091`, an arm64 instruction, at the
   encrypted offset). So the fallback reads the whole range through the task port and writes it out. With it,
   5 of 6 encrypted binaries decrypt; the one left is `Extensions/CrashReporterExtension Production.appex`, an
   ExtensionKit extension (top-level `Extensions/`), which iOS 15 doesn't start (EPERM again). It is left out of
   the IPA with a yellow line; it couldn't run on iOS 15 anyway.
- `syscall(2)` is deprecated (an error with -Werror) in the iOS 27.1 SDK and libSystem doesn't export
  `mremap_encrypted`: the trap is made with inline `svc #0x80`.

## Checked on the iPhone 7 (build 0.21.0-4305 installed with apt, docs/iphone7.md)

Through the app (tools/ui-7.sh, shots ref/7/screens/f374-1..14.png):
- Install IPAs shows the "Installed Apps" row; the list shows X under App Store ("12.45.1 · Encrypted") and the
  Apple apps under Other Apps, each with its Home Screen icon.
- X's page: Details, Decrypt, Inject Tweaks, Build IPA with Tweaks. Decrypt ran on the black progress page:
  "Decrypted 5 of 62 Mach-O files, 1 still encrypted", the CrashReporter extension left out, then
  "Added X 12.45.1 (decrypted).ipa to My IPAs (30.2 s)".
- **Timings**: tap to IPA in My IPAs ~42 s (decrypting ~3.5 s, packing 685 MB of app into a 516 MB IPA 30.2 s).
  By hand the helper's decrypt alone took 3.4 s.
- **cryptid=0**: every Mach-O in the IPA that had LC_ENCRYPTION_INFO (main + 4 extensions) reads `encrypted: 0`
  with `decrypt_driver crypt` on the phone; the IPA has no SC_Info, no iTunesMetadata.plist, no CrashReporter.
- The IPA's page in My IPAs reads it (4 extensions, iOS 15.0) and Share opens the share sheet with the 516 MB file.
- The app page then says "Decrypt Again" with the IPA's row.
- **Inject Tweaks accepts it**: a test `F374Hook.framework.zip` (built here, put in Files > On My iPhone > Downloads
  over ssh) was added in the Inject Tweaks group, then Build IPA with Tweaks made "X 12.45.1 (tweaks).ipa" in ~5 s:
  `Injected @rpath/F374Hook.framework/F374Hook`; the copy holds `Frameworks/F374Hook.framework/*` and the main
  executable names the framework, still cryptid 0.
- Also on the desktop: the web's own check (`core/tweaks.js ipaEncrypted`, what Inject Tweaks uses to lock App
  Store copies) reads an IPA with the decrypted X executable as not encrypted and one with the original as
  encrypted; `sign/tests/decrypted/main.swift` with the real decrypted X executable takes the load commands.
- Cleaned up after: both test IPAs, the test tweak files and my scratch folder removed from the phone; the app had
  already removed its decrypt folder. The test tweak stays saved for com.atebits.Tweetie2 in the app's IndexedDB
  (Inject Tweaks' Remove takes it off).

## Not verified

- **Installing the decrypted or tweaked copy** (Install on its page: helper install-ipa, ldid): not run. It would
  replace X, the phone's only App Store app, and its Apple ID login isn't ours to redo; nothing else App Store-made
  is on the phone and a person would have to sign in to the App Store to add a small free app. So whether the
  ldid-signed decrypted X launches, and whether the injected framework loads, is unchecked.
- **A small free App Store app** as the brief asks: none on the phone (needs a person's Apple ID); X (685 MB) was
  decrypted instead.
- **A .dylib or .deb tweak from Files**: the Files picker greys out `.dylib` (iOS has no type for the extension in
  the shared group's `accept` list); a zipped .framework was used. Same group as the sideload build's, not changed
  here: filed as B355.
- A fat (multi-slice) App Store binary and a 32-bit one on the phone: iOS 15 App Store binaries are thinned arm64,
  so only the fixtures (test_decrypt.py) cover fat and 32-bit headers.
- The website and the sideload build: the page and calls are jailbreak-only (`jailbreakOnly`, the row only when
  `jailbreak()`); checked by node tests, not on the 15.
