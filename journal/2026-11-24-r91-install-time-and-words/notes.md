# R91: where This iPhone install time goes, and the words it shows

## What I did
- Four synthetic IPAs, bundle ID `com.ryha.ifizbox.r91test` (never iFizBox's), 325 MB unpacked, signed with the rig's
  ad hoc profile (zsign): `many-store-rand` (12,000 files of 27 KB, stored, incompressible, 327 MB), `one-store-rand`
  (1 file, stored, 325 MB), `many-defl-text` (12,000 files, deflated, 175 MB), `one-defl-text` (1 file, deflated, 144 MB).
- iPhone 15 Pro (iOS 27.0.1) over USB, lock taken with `tools/ui-15.sh` (waited about 50 min for R89's turn). The
  installs ran from `pymobiledevice3 apps install --no-streaming`, which does what the app does: AFC write to
  PublicStaging, then installation_proxy installs it. `ui-15.sh install` itself uses go-ios's streaming_zip_conduit,
  a different path (no staging copy), so it was only used once for a cross-check.
- Test apps uninstalled afterwards; lock released.

## Results (seconds, desktop over USB; each IPA run twice, second over the first = re-sign over an installed copy)
| IPA | AFC copy | copy end to InstallComplete | total |
|---|---|---|---|
| 12,000 files, stored, 327 MB | 1.3 / 1.4 | 8.1 / 7.8 | 10.0 / 9.6 |
| 1 file, stored, 325 MB | 1.3 / 1.3 | 2.4 / 2.1 | 4.2 / 3.8 |
| 12,000 files, deflated, 175 MB | 0.8 / 0.9 | 9.4 / 12.5 | 10.6 / 14.1 |
| 1 file, deflated, 144 MB | 1.1 / 1.0 | 3.1 / 2.4 | 4.7 / 3.9 |
| 12,000 files, deflated, over the running-app attempt (see below) | 1.1 | 10.4 | 11.7 |
| 3 different apps at once (12,000 files, deflated, 3 IDs) | n/a | n/a | 25.0 / 25.0 / 30.8 |
| go-ios streaming (1 file, deflated, 144 MB), for comparison | n/a | n/a | 8.0 |

Findings:
- **File count is what installd's time follows**, not size or compression: about 8-12 s for 12,000 files against 2-3 s
  for one file of the same size. Stored against deflated made no real difference (deflated was a little slower).
- **Several installs at once do not speed anything up**: three together took 25-31 s, about three times one install
  (10-14 s). installd works on one at a time; HERE_PARALLEL only overlaps the copies.
- **The silence before installd's first percentage** is installd unpacking and checking the staged IPA (go-ios's stages
  show ExtractingPackage, InspectingPackage, then percentages at the end: 40% VerifyingApplication arrives after the
  long part). So the silence is most of the install: 80% of the time with many files. It is not a hang.
- Installing over the app while it is running: the synthetic app (a stub) exits at launch, so it was not running when
  the install started. **Not reproduced.**
- The user's YouMod case (12,414 files, re-sign) matches the 12,000-file rows: about 10-14 s of silence on this
  phone with the desktop's fast copy. On the phone the copy is slower (17-18 MB/s in R55, so 8-18 s for 140-324 MB),
  and the silence comes after it. "Long" there is explained by file count; nothing else was found.
- The copy on the phone itself (AFC through the on-device VPN loopback) cannot be measured from the desktop: USB gave
  150+ MB/s, the phone's own route 17-18 MB/s. The 1 MB chunk against bigger or pipelined writes needs an app build
  with a test switch; no build here (the app builds on the MBA). **Not measured**; filed.

## Speed-ups
None measurably helps from what was measured: file count is the IPA's own, parallel is serialised by installd, and
compression does not matter. One follow-up filed for the one open question (chunk size on the phone).

## Words (This iPhone path), old -> new
| Moment | Old | New |
|---|---|---|
| HUD from the start until connected (signing.install fallback) | Installing on this iPhone | Connecting to this iPhone |
| HUD copying (fallback) | Installing on this iPhone 42% (overall) | Copying to this iPhone N% (the copy's own) |
| HUD copy ended, installd silent (fallback) | Installing on this iPhone | Copied to this iPhone, waiting for iOS |
| HUD installd's percent (fallback) | Installing on this iPhone N% (overall) | Installing N% (installd's own) |
| HUD connected, no bytes yet | Copying to iPhone | Connecting to iPhone |
| HUD copy at 100% | Copying to iPhone | Copied to iPhone, waiting for iOS |
| Run row before connecting (queue.js sent "copying" 0 before signing.open) | Copying to iPhone | Connecting to iPhone |
| Run row copy at 100% (B421) | Installing | Copied to iPhone, waiting for iOS |
| Run row, This iPhone route not started | Installing | Preparing |
| Run row, iOS asked, no prompt yet (Signing Server) | Installing | Asking iOS |
| Run line, one app connecting | Copying A to iPhone | Connecting to iPhone for A |
| Run line, copy ended | Installing A | Copied A to iPhone, waiting for iOS |
| Run line, several apps, none at installd yet | Installing N apps | Sending N apps to iPhone |
| Console log (page) | (none; row phase "copying" logged at connect) | Connecting to this iPhone for A, then Copying A to this iPhone at the first bytes |
| Console log, shell, before connect | Copying the IPA to iOS (N), then iOS installs it | Connecting to iOS to copy the signed IPA (N) |
| Console log, shell, route chosen | Installing on this iPhone through ... | Using this iPhone's own install route through ... |
| Console log, shell, at the copy's start | Copying the IPA to iOS (N) | Copying the IPA to iOS: N to send |
| Console log, shell, at the install request | iOS is installing it | The IPA is on iOS: asking installd to install it. Its first percentage comes after it has unpacked and checked the IPA (seconds; longer with thousands of files) |
| Console log (My IPAs install) | Installing the signed copy of ... | Handing the signed copy of ... to iOS |

Also: the shell's own log (os_log) now carries seconds: connect time, each installd percentage and Complete as
"N s after the request" (diagnostics only).
The step "copying" now starts at the first chunk that landed (the shell sends `connecting` at connected).

## Not verified
- Nothing here ran in the app on the phone: the Swift changes (step names, log lines) compile only through the
  gate's build; `connecting`/`Copied ... waiting for iOS` were checked by the JS tests, not on screen.
- The 1 MB chunk against bigger chunks or pipelining on the phone's loopback route: no app build with a switch.
- Installing over a running or playing app: the stub exits at launch.
- installd's first-percentage time: pymobiledevice3 prints only some stages, so the exact first percentage was not
  timed; the copy-end to InstallComplete figure is what is reported.
- Not audited (filed): the Signing Server / iOS-prompt HUD word "Installing" at handoff, self-update wording, the
  site (websign), the jailbreak build, notifications/Live Activity.
