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
- In the jailbreak app the Inject Tweaks group takes tweaks from Files only: "from a Source" is the sideload app's
  Tweak Sources (`tweakSourcesOn` is sideload-only), so it would list nothing here.
- Installing a tweaked or decrypted copy back over the App Store app is not offered from Installed Apps. The copy
  lands in My IPAs; its page has the usual Install (helper install-ipa, ldid signs it) and the new Share. So the
  user's app is never replaced unless they install that copy themselves from its page.
- Code: no decrypter's code copied. flexdecrypt / fouldecrypt (mremap_encrypted) and TrollDecrypt / bfdecrypt
  (reading a launched app's memory) only gave the approach.
