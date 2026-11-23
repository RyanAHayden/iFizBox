# B329: every apt install said "apt refused" on the iPhone 7

## Cause

On the 7, apt could not open its own lists at all:

```
$ apt-cache policy bash
E: Encountered a section with no Package: header
E: Problem with MergeList /var/jb/var/lib/apt/lists/repo.twickd.com_._en
E: The package lists or status file could not be parsed or opened.
```

`repo.twickd.com_._en` (written 2026-11-22 02:25 by an `apt-get update`) is an HTML page: Twickd's repo answers its
Translation URL with its web page and HTTP 200. Its Release (2021, 181 bytes) lists no hashes and the repo is
unsigned (the helper allows that, N6), so apt kept the page as the Translation file. From then on every apt
command fails, `apt-get -s` included, so the Confirm sheet's simulate came back with exit 100 and output the
apt-problem reader has no sentence for: "apt refused this queue (exit 100). Its own words are below."
Twickd is in the phone's `ifizbox.sources`. Sileo on the phone uses the same lists, so it was broken too.

With `-o Acquire::Languages=none` apt reads no Translation files and works again (checked on the 7 by hand:
`apt-get -s ... install com.nahtedetihw.gesturesxv` plans `Inst com.nahtedetihw.gesturesxv (1.6 Havoc ...)`).

Nothing on the web side or in Apt.swift/Bridge.swift was wrong: the request (`helper.run ["simulate",
"<id>=<version>"]`) was right; apt itself couldn't start.

## Fix

- `native/helper/policy.c`: `helper_plan` now runs the old builder (`plan_words`) and then `skip_translations`,
  which puts `-o Acquire::Languages=none` (policy.h `HELPER_APT_NO_TRANSLATIONS`) right after `apt-get` /
  `apt-mark` in every plan (update, update-source, install/remove/upgrade, hold/unhold/showhold/auto,
  simulate/apply/apply-ask, rollback, install-paid, simulate-deb/install-deb). `p->packages`, when it points into
  argv, moves with it.
- `native/daemon/main.m`: the same option on its apt-mark showhold, apt-get update and the simulate/install
  builder; otherwise its update would fetch the page again.
- The app reads descriptions from Packages and never used Translation files, so nothing is lost.
- `update` with the option deletes the bad file (apt's list cleanup removes lists it no longer fetches), which also
  heals Sileo.

## Tests

- `native/helper/test_helper.py` `test_no_translations_for_any_apt_run`: every apt verb's plan has the option
  right after the tool name, once; the caller's names still end the plan; `configure` (dpkg) gets none. The other
  argv expectations gained the option (`NOLANG`).
- `native/daemon/test_no_translations.py`: every apt argv in main.m carries `NO_TRANSLATIONS` (main.m only builds
  for the phone, so a source check).

## Phone check (iPhone 7, ui-7.sh under the B329 lock)

Chromium can't check this: it is the root helper and apt on the phone. Built `native/build.sh deb`
(0.21.0-4206), installed over 0.20.1-4173 with `apt-get install`, checked both `ifizbox-helper` and
`ifizbox-upgrades` hold `Acquire::Languages=none`. The bad `repo.twickd.com_._en` was still in apt's lists.

- `ifizbox://package?id=com.ps.ytautofullscreen` (YTAutoFullScreen 1.0.4, PoomSmart's Repo, Section Tweaks; it
  hooks only YouTube, which isn't on the 7, so it changes nothing there) > Install > Install: Confirm listed
  "Install YTAutoFullScreen" (before the fix this was Cannot Comply, "apt refused this queue").
- Confirm: the console ran apt and dpkg to "Installed YTAutoFullScreen / 1 installed" and the Restart SpringBoard
  button (Complete for a tweak). `dpkg-query`: `install ok installed`.
- Removed it again over ssh (`apt-get remove`), tapped Restart SpringBoard. After the respring the app refreshed
  its sources itself; afterwards `repo.twickd.com_._en` is gone, no `_en` file is left, and plain `apt-cache
  policy bash` (no option, as Sileo runs apt) works again.
- Screens: `ref/7/screens/b329-{1..7}.png` (ref/ is not committed).

The phone was asleep at first (`ssh 7`: No route to host, 7 not on the tailnet); a minute later ssh answered.

## Not verified

- GesturesXV itself was not installed: it changes the 7's navigation gestures, which every phone task drives;
  apt's simulate of it plans `Inst com.nahtedetihw.gesturesxv (1.6 Havoc ...)` with the option (by hand over ssh).
- The daemon's own update and automatic install with the option were not run on the phone (it runs on its own
  schedule); its argv is checked by `native/daemon/test_no_translations.py` and the built binary holds the string.
