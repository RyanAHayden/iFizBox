# F465b1: Open Minis is gone from the App Store

## Did

- Re-checked on 2026-11-27, about 20:36 UTC. Open Minis (id 6759188481) is still gone.
- Uncached lookups return 0 results: `itunes.apple.com/lookup` with country=us or gb and a throwaway `cb=` parameter, and by bundle ID.
- `apps.apple.com` pages for it return 404 (us, gb, no country). LocalDevVPN's page returns 200.
- A US store search for "open minis" does not list it.
- Trap: the plain `https://itunes.apple.com/lookup?id=6759188481` still returns the full record. That is a stale Akamai cache copy (`x-cache: TCP_MEM_HIT`, 14429 bytes, against 42 bytes uncached). Add a throwaway query parameter when re-checking.
- The options put to the person were: hide the Install Without a Computer section until Open Minis is back; send people to its TestFlight link, `https://testflight.apple.com/join/3BdkA5c3`; or keep the App Store link, as the removal may be temporary.
- The person chose to hide Install Without a Computer until Open Minis is back.
- Re-checked again right before building: the uncached lookup still returned resultCount 0.
- Built:
  - `OPEN_MINIS_ON_STORE = false` in `web/app/screens/computer-install.js` gates `phoneSetupOffered` and the block. No script is fetched while it is false.
  - New test in `computer-install.test.js`. The older F465b tests pass `true`.
  - `docs/signing.md` and `docs/sideload.md` updated.
  - `release-notes/F465b.md` removed. It announced a section nobody now sees. No release note for this task, since users see no change.
  - To bring the section back, set the constant to `true`. A "later" research task to re-check Open Minis was filed.
- Phone check on the iPhone 15 Pro (iOS 27.0.1). It could not be done in Chromium: Open Minis, Bonjour, pairing and installing exist only on the phone.
  - Setup: `tools/setup/release.sh --dry-run build`. A stand-in site inside Open Minis, served by busybox httpd (`apk add busybox-extras`) on 127.0.0.1:8000. A tiny test app, `com.ryha.ifizbox.phonetest`, signed with the rig profile. LocalDevVPN connected.
  - Line run: `export IFIZBOX_SETUP_BASE=http://127.0.0.1:8000`, then `wget -qO- http://127.0.0.1:8000/install.sh | sh -s -- ABCD-2345 --server http://127.0.0.1:8000`.
  - Result: pass. `install.sh` picked Linux aarch64, checked the SHA-256, and ran the command. The code was accepted and the IPA downloaded. Developer Mode showed "Pair with iFizBox". The code arrived as a notification and in the terminal. Paired, then Installed, then "Gave the app its pairing". iOS listed the app, and `Documents/pairingFile.plist` was in its container (go-ios fsync).
- Cleanup: test app uninstalled; test files and busybox-extras removed from Minis; LocalDevVPN disconnected. Open Minis kept installed on the 15 Pro.
- iFizBox showed Pairing Lost, as known: the same-name pairing replaces the app's. It was re-paired and shows Ready to Install.
- An earlier phone run was not done: the phone was locked by another task (T89), and the choice was filed first.

## What failed

All of these were test-rig mistakes. No product bug was found.

- `export` was lost while typing, so the script fetched the published binary from ifizbox.com and refused it on SHA-256 mismatch ("Nothing was run").
- The stand-in IPA had to be under `/sign/up/`, or the command refuses it.
- Typed Ctrl-C did nothing in Minis. The toolbar C-c button works.

## Not verified

- The real `https://ifizbox.com` line. It needs a setup release that a person asks for.
- Download over HTTPS, and a real website code from Open Minis.
- The line without `--server` and without `IFIZBOX_SETUP_BASE`.
- A real free Apple ID signed IPA and its trust step.
- Launching the installed test app.
- A phone with a passcode.
- The website change on a real phone. It is covered by `node --test` only; there is no screenshot.
- Whether Apple's removal of Open Minis is temporary, and why it happened: unknown.
- The TestFlight link was not re-opened in this task.
- The App Store alert on the phone was not checked again. It was last seen in the earlier journal, `journal/2026-11-27-f465b-website-phone-setup`.
