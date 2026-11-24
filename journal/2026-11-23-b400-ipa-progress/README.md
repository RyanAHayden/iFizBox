# B400: IPA install progress, and the unpacked app to installd

## What was done
- **Download percent** (`native/Sources/Apt.swift`): `ipa.install`'s download is watched by KVO on `task.progress`
  (`fractionCompleted`), one `dlstatus` line per new whole percent, never back (`IPAInstall.percents`, shared with
  the http path). The session and its headers are kept as before. The download stays the bar's first fifth.
- **Background** (`native/Info.plist`): `UIBackgroundModes` audio, and `ipa.install` holds KeepAlive from its call
  to its answer (`Sideload.holdUntilAnswer`), so leaving the app mid-download or mid-install freezes nothing.
- **Helper percents** (`native/helper/ipa.c`): Copying 0 to 5 and Unpacking 5 to 40 move with bytes. Unpacking's
  total is the zip's central directory (`helper_ipa_zip`); the tree unzip fills is measured about twice a second.
  Installing follows installd's `PercentComplete` through the `installApplication:withOptions:error:usingBlock:`
  block (the plain call where the block isn't there), from 50 (ad hoc 60) to 99. The percent never goes back
  (`progress()`), and installd's text ends in its own percent ("Installing 40%").
- **Unpacked app to installd**: with AppSync Unified, installd takes the unpacked `.app` (`PackageType: Developer`)
  when unzip exited 0, every entry was made on Unix or macOS, the central directory could be read, and there's no
  top-level `iTunesMetadata.plist`. installd then moves it into place instead of unpacking the IPA again. The
  root-owned copy goes as before otherwise. The copy is no longer fsynced (it is read back and deleted).
- **Web** (`web/app/core/ipainstall.js`, `core/apprun.js`, `screens/apprun.js`): `ipaStatus` gives the step's own
  percent (`step`), `ipaStep(text)` the row's word (Preparing, Downloading, Copying, Unpacking, Installing, Signing).
  The row shows the word and its percent (`Installing 40%`), the run status does too, and the Log gets a line
  per step. The helper's row bar no longer starts at 50%: its bar is the whole install (`rowProgress`).

## Measurements
iPhone 7 (iOS 15.8.8), com.ryuk.ryukgram 456.0.0 "Duplicate, iOS 15" IPA: 327,767,305 bytes, 638 MB unpacked, 3754
files, AppSync, no fakesign. The helper's code was run by a small timing tool over ssh (as root, with the helper's
entitlements; a copy of ipa.c), not the app.

| Build | Screen | Copy | Unzip | installd | Total |
|---|---|---|---|---|---|
| Before | on | 1.9 s | 10.7 s | 51.2 s | 64.2 s |
| installd percents, still the IPA | on | | | 11 to 16 s unpacking, 38 to 41 s at 40% (verifying) | 61.7 s and 69.7 s |
| same | off | | | 40 to 48 s unpacking, 96 to 136 s at 40% | 181 to 189 s |
| before-code, re-IDed 339 MB copy | off | | | | 250.8 s |
| unpacked `.app` to installd | on | 2.0 s | 9.4 s | 20.1 s | 31.5 s |
| final code | on | 2.0 s | 9.6 s | 23.6 s (0.7 s to 40%, then 22.5 s at 40%) | 35.2 s |

- Setting the helper's thread QoS to user-initiated and an IO policy: no gain with the screen on, dropped.
- Dropping fsync: no measurable gain (the copy is still about 1.9 s, flash speed), kept dropped for the read-back.
- The screen-off slowdown is iOS's. Queue runs already keep the screen on.

## In the app
Version 0.26.0-4984 from RyukSign Source, com.ryuk.ryukgram 446, 247.6 MB.
- Old app process: Home mid-download stopped the download at 61,423,300 bytes for 80 s, and on return the install
  failed with "took too long".
- New: Home mid-download, the temp file kept growing from 83 to 258 MB, and the helper started by itself in the
  background. Installed within about 30 s of the download ending (18:52:25 to 18:53). The Log showed the
  Downloading, Copying, Unpacking and Installing lines, and the bar moved. The app launched fine after an
  unpacked-`.app` install.
- A deb install doesn't restart a running iFizBox, so the process was killed before testing. Overwriting a binary
  in place on the phone gets it SIGKILLed, so the file was removed first.

## Why the phone
installd's behaviour and background suspension can't be checked in Chromium. The phone was cleaned up afterwards: the
test app, tools and files were removed, iFizBox was left at this build. A stale `/var/tmp/ifizbox-ipa.3rDg0O` from
2026-11-22 (not this task's) was left.

## Tests
`node --test` (the web tests), `native/helper/test_helper.py` (InstallIpa), `native/test_ipa.py`.

## Not verified
- The Apps row's "Downloading 40%" and the run status percent on the phone's screen. Unit tests only; the status
  percent was added after the phone run.
- The fallback when installd lacks `usingBlock:`.
- An iOS 16+ jailbreak.
- The ad hoc path without AppSync on a phone (tests only).
- A fakesigned (unsigned) IPA: not re-run on the phone.
- A Windows-made zip and the `iTunesMetadata.plist` fallback on the phone (Linux tests only).
- With installd at 40% for about 20 s, the bar stands still: installd says nothing in between.
- The review's last `ipa.c` edits (installd's percent never drops in the text, a static name for installd's block, a
  guessed unpack size when the zip's directory can't be read) were compiled for iOS and tested on Linux, not on the phone.
