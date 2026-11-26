# B459: Refresh hangs on "Downloading Packages"

## Report
- iPhone 7, jailbreak app. Changes showed the "iFizBox 1.0.0 is out." banner but no Upgrade (N) nav button, only Refresh. The reload bar sat on "Downloading Packages" with Cancel.
- Screenshot: .runner/uploads/20261126-104415-IMG_0018.png. Other shots from the same moment show the user had just used Find More's Add All (many new sources).

## Why Upgrade was missing
- On the jailbreak build the banner reads GitHub's latest release (essential-ui.js bannerOnce, newerRelease). Upgrade (N) and the Available Upgrades group count apt's rows from the catalog.
- The catalog was still on the old lists. Changes showed iFizBox "Updated 0.34.0-5681" (the installed version), so there was no upgrade row, and Upgrade (0) is hidden by drawUpgradeButton.
- The catalog reloads only once the refresh's last steps run (startRun data(): Loading Data), and Changes reloads on catalog.onChange. So the Upgrade button follows the refresh: both symptoms have one cause.

## Why the refresh hung
- backend-native.js nativeSourceCalls refreshSources, after apt-get update, read every source with Promise.all and no time limit.
- A source apt could not fetch is read again over the network (Release, InRelease, then Packages.xz/.bz2/.gz/plain through net.packages, plus the JS bz2 fallback). Each shell request is allowed 30 s idle and 120 s total (Apt.swift session, PlainFetch.swift). One dead or trickling host could hold the bar on "Downloading Packages" for many minutes.
- The site's refreshSources (core/sources.js sourceCalls) already used pool(REFRESH_CONCURRENCY=8) and a 20 s time limit per source (refreshTimed). The native one never did.
- Changes' own Refresh calls the same refreshSources (and queues behind a running apt-get update), so it hung the same way.

## Fix
- Native refreshSources now uses pool(sources, REFRESH_CONCURRENCY) and withTimeout(refreshSource, NATIVE_REFRESH_TIMEOUT = 60 s). sourceOptions.timeout and .concurrency override these, for tests.
- A timed-out source gets the timeout as its error (Not Responding) and keeps its last count. The reload bar's Cancel (signal) starts no more sources.
- 60 s, not the site's 20 s, because a big list apt fetched is read and counted on the phone, which takes an iPhone 7 a while.

## Test
- web/app/backend-native-refresh-timeout.test.js, with the fake native shell and helper (native/fake/): a source whose network reads never answer (and apt can't fetch, FAKE_DEAD) no longer holds refreshSources; at most REFRESH_CONCURRENCY sources read at once.
- Both tests failed on main's backend-native.js and pass with the fix. 142 tests across backend-native*, screens/changes*, screens/sources*, websign-refresh and incoming-sources-tab pass.

## On the phone
- ssh 7, read only, no screen lock. Later that morning 1.0.0-5835 was installed and apt's lists had it, so the refresh had finished (or was cancelled) by then. Which source was slow cannot be told after the fact.

## Tried / failed
- The first test version added the dead source while it already hung, so addSource's own check never returned and the test run hung. Fixed by making the source stop answering only after it is added.

## Not verified
- No Chromium run with the fake bridge. The hang is in backend-native.js's refresh, which the node tests drive through the same fake bridge (native/fake/fake-native.mjs) a Chromium run would use, so a browser adds nothing for this path.
- Not checked on the iPhone 7 with the real sources: the slow source from the report is gone, but a phone check of Refresh with many sources needs the phone's screen lock. The next phone test with a large source list should watch that Refresh ends.
- Not changed: the jailbreak banner can still show before apt's lists have the new version (GitHub release published before the repo, or lists not refreshed yet). Its Upgrade then waits up to 20 s and opens Changes with no Upgrade button. Filed as a follow-up: B464.
