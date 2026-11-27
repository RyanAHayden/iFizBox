# F454: count plain APT installs for Popular

- F452's code was already back on main (F453 restored it), so no revert was needed.
- The earlier wip/F454 attempt counted only in apply(). That missed the queue run, which installs through backend.queueInstall and counted nothing, not even linked .debs.
- web/app/backend-native.js: one `counted` helper calls backend.installs.count for install jobs after exit code 0. apply (apt jobs), queueInstall (the fetched .deb and the apt download) and the linked .deb path all use it. It replaces the module-level installCounter. backend.installs can be passed in as sourceOptions.installs.
- The existing tests that install (backend-native-linked, -queue, -queuerun) pass a stand-in, so they send no counts of fake ids to the real server (the linked test could before). New test: web/app/backend-native-installcount.test.js.
- Checked: `node --test web/app` with a preload refusing any `/installs` request: 3852 pass, no request tried.
- Counted: the packages a run asked for, including upgrades and downgrades (the server keeps one per device per package). Not counted: dependencies apt pulls in, removals, rollbacks.
- Known limit: counts share the reviews' write rate limit (a few a minute per address). An Upgrade All of many packages drops some counts and could briefly rate-limit a review post: filed as B499.
- Release note: release-notes/F454.md.

**Not verified**: no phone install and no real server or D1 (the change is in the web layer, checked with node tests over a stand-in bridge). Chromium runs with the fake bridge could still send counts to the live server (not guarded).
