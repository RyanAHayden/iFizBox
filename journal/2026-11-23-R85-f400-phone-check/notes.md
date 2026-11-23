# R85: F400 phone check (a retry uses the Waiting IPA)

Checks F400: a retried install or update uses the IPA already downloaded, and downloads again when that copy
is gone, damaged or listed at another version. All checks passed. No product change.

Build: main at ad70969e (0.26.0, build 4884). `make -C native ipa`, installed on the 15 Pro with
`tools/ui-15.sh R85 install`. CDP via `pymobiledevice3 webinspector cdp --port 9342`.

Why phones: the native shell, installd and its helper, and app kill can't run in Chromium.

## iPhone 15 Pro

The Signing Server route fails on purpose: manifestServer `https://f400.invalid`, url
`test-fixtures/alpha-1.1.0.ipa` (2.3 MB). Logs: `run1-15pro.log`, `run2-15pro.log`.

1. First install: downloads, signs, then the install step fails with "Couldn't reach f400.invalid". The
   waiting dir holds `<hash>.ipa` and `<hash>.json`.
2. Retry: "Using the IPA already downloaded (2.3 MB)". No Downloading line, no downloading phase. signing.prepare
   reuses it too.
3. Damaged copy: one byte flipped mid-file in the kept IPA (a fresh copy of the same fixture, SHA-256
   689eff7b..., put over it with afcclient). Log: "The IPA already downloaded is gone or damaged: downloading it
   again", then it downloads.
4. Retry after that: reused.
5. Source lists 1.2.0 while the kept IPA is 1.1.0: downloads again, no "Using" line.
6. signing.prepare of the 39 MB v0.20.0 iFizBox.ipa, app killed (`ios kill`) right after "Downloaded". Both
   files stay in the waiting dir. Relaunch, same call: "Using the IPA already downloaded (39 MB)", no download.
7. This iPhone route (`route: idevice`) for Alpha: succeeds (phase "here"). Alpha's waiting file is gone
   afterwards; iFizBox's remains. It downloaded first because the kept Alpha IPA was listed 1.2.0 (step 5) and
   this call listed 1.1.0.

The 15 Pro keeps Test Alpha 1.1.0 installed.

## iPhone 7 (iOS 15.8.8)

- Installed the jailbreak .deb of the same commit (`native/build.sh deb`, apt-get install over 0.21.0-4305). The
  app binary contains the string.
- Harness page `h7-harness.html` swapped in as web/index.html for one run, then restored (md5
  bf3601092041dd48cccd33c65255b3aa checked). App killed.
- Test IPA: alpha with MinimumOSVersion 99.0. Served from the desktop over `ssh -R 8765` as
  `http://127.0.0.1:8765/fail.ipa` with insecure:true, so installd's helper refuses it ("needs iOS 99.0 or later").
- ipa.install 1: download, then the helper refusal. ipa.install 2 (retry): "Using the IPA already downloaded
  (2.3 MB)", no Downloading status, refused again. Screenshot: `iphone7-retry.png`.
- Test files left on the 7 were removed by hand.

## Findings

- afcclient `get` of a kept .ipa fails ("Failed to open file ... Unknown Error (1)"), though `ls` and `get` of its
  .json work. The .ipa has link count 2 (a hard link into Caches). Not treated as an app bug so far. The damaged-copy
  test (step 3) used a fresh copy instead. The first 15 Pro run stopped at this get, after step 2.
- afcclient with piped stdin loops forever printing prompts: always run it with `< /dev/null`.

## Not verified

- The HEAD check against a changed server file (ETag or Last-Modified differing). Only the listed-version
  mismatch (step 5) and the damaged copy (step 3) were run.
- The iPhone 7 download was plain http through the tunnel, not https from GitHub.
- The iPhone 7 success path (install ok, then the waiting file removed) was not run.
- The iPhone 7 check was run once, as asked.
- Step 7 shows a successful This iPhone install removing the Waiting IPA it had just downloaded, not one left by
  an earlier failed install (step 5 had already replaced the 1.1.0 copy). The F400 journal's wording "the waiting
  file goes" is covered only in that form.
- Why afcclient can't open the kept .ipa (link count 2) is open: it may be file protection, not checked.
- `phone-r85.mjs` is the script from step 3 on; steps 1, 2 and 2b ran from the F400 `phone.mjs` (run1 log), which
  also reads the fixture copy `kept.ipa` (the same GitHub file, SHA-256 689eff7b...) from its scratch dir.
- "Show me the id": no id was asked for in the task beyond R85 itself; none is shown.
