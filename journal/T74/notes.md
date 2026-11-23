# T74 Phone tools tidy up on unlock

`ui-{4s,7,15}.sh unlock` now leave the phone at the Home Screen with the screen off (and the switcher empty on the
7 and 15) before freeing the lock; `ui-release.sh` goes through unlock, so dropped slots tidy too.

Why the phones: switcher gestures and screen state only exist on the devices; Chromium can't check them.

- iPhone 7: a cold `home` on a sleeping phone lands on the Lock Screen; two presses a second apart reach the Home
  Screen. Two shots of one still screen differ (mean 0.5/255), so `tools/ui-same.py` compares fuzzily (Pillow,
  local tool like themecmp.py); a switcher card differs by ~70. ~10 s with two apps.
- iPhone 15: a W3C pointer swipe from the bottom edge doesn't open the switcher; `/wda/dragfromtoforduration` from
  y=851 pt does. The screen can be off while `/wda/locked` says false, and then `/wda/unlock` does nothing: an
  all-black shot means press the side button first. 16-23 s.
- 4S: no awk or ps; quits UIKitApplication jobs except Cydia (dpkg), Home, sleep button. iOS 6's multitasking bar
  can't be cleared from the shell; Phone, Mail and Facebook relaunch themselves in the background.
