# F445: film the Free Apple ID login of the sideload-only clip on the iPhone 15

## What I did
On 2026-11-26, 15:04 to 15:08, on the iPhone 15 Pro (iOS 27.0.1), with iFizBox Lite 1.0.3 (8400e1a,
com.ryha.ifizbox, the paid-team copy). The phone was locked with `tools/ui-15.sh`.

- Before filming: saved the app's paid certificate with the bridge call `signing.export` over Web Inspector
  (`pymobiledevice3 webinspector cdp`, eval `ifizboxNative.call`), then ran `signing.remove`.
- Filmed with WDA video at 60 fps setting (the actual rate varied, about 18 fps on average), 1178x2556, 116 s.
  The flow on the phone:
  1. Settings > Installation & Signing > Certificate > Free Apple ID > Use a Free Apple ID.
  2. Typed the Apple ID and password from `~/.config/ifizbox-appleid` (not printed). Sign In. "Signing In..." took about 5 s.
  3. Two-Factor Authentication page.
  4. Apple's "Apple Account Sign In Requested" alert, on the same phone. It says "a MacBook Pro near <city>" and
     shows the Apple ID and a map. Allow.
  5. "Apple Account Verification Code" alert with the code. Typed it, then Verify.
  6. Checklist "Setting Up <name>".
  7. Certificate Limit alert (Revoke iloader / Revoke iFizBox Website). Revoked "iFizBox Website", the project's
     own certificate made by T87a's website run. That is the same choice T87a made with the older test certificate.
     iloader was left alone.
  8. Checklist finished.
  9. The Certificate page shows the free certificate: "iPhone Developer: <Apple ID> (...)", team 4549VNVVAG,
     expires Nov 26 2027. Profile "iOS Team Provisioning Profile: com.ryha.ifizbox.4549VNVVAG", expires Dec 3 2026.
     Devices 1, This iPhone In Profile.
- No second person was needed. The 2FA code shows on the 15 itself, because the spare Apple ID is signed in on it.
- After filming: `signing.import` with that export (same serial 46890BB0...), so the paid certificate is back. Removed
  the localStorage keys `ifizbox.freeid` and `ifizbox.freeid.anisette`, so the app is as it was. The export file
  was deleted.
- This was the first real run of the in-app Free Apple ID sign-in (F444). It worked end to end.

Edits to the clip:
- New `marketing/video/take-free-apple-id.sh` cuts the raw recording into `marketing/video/takes/free-apple-id.webm`
  (VP9, 804x1748, 30 fps, 26.5 s, 560 KB, committed; the first encode at 60 fps was 3.4 MB and the gate's 1 MB size
  guard refused it). It also writes `takes/free-apple-id.json` (part names, raw
  seconds, start in the take). The take covers the Apple ID with a grey box (the form field and the certificate
  name row), blacks out the status bar, and leaves out Apple's sign-in alert and the idle waits. The raw recording
  is not in the repo, because it shows the Apple ID. It stayed in the session scratchpad only.
- `marketing/video/promo-sideload.html` now plays the take in place of the recording's span from mark `free` to
  mark `free-done`. A canvas is fed by a muted video, seeked per frame, with `TAKE_SPEED` per part.
- `marketing/video/shots-promo-sideload.json` keeps the stubbed sign-in steps, shortened, with the marks `typed`,
  `code` and `setup` removed. The rest of the recording (installs, the aging world, Re-sign All) needs the free
  certificate that the stubbed sign-in imports. Only the take is shown.

## What failed or surprised
- The Certificate Limit alert listed iloader first, but `freeroute.js` says "ours first". This app has no saved
  identity, so nothing counts as "ours".
- While the code keyboard was up, iOS scrolled the web view up under the status bar. In a few frames of the take
  the nav bar is half hidden.
- The screen recording did not capture the code alert itself. The screen is only dimmed for those seconds.
- Revoking the T87a website certificate may stop the T87a-installed copy (com.ryha.ifizbox.4549VNVVAG) from
  launching or re-signing. This was not checked.

## Not verified
- Whether the T87a-installed copy (com.ryha.ifizbox.4549VNVVAG) still opens or re-signs after the website
  certificate was revoked.
- I printed the credential file once by mistake (in the first session's tool output, not in the repo). Its
  password may be worth changing.
- The cuts were rendered from a fresh capture (the promo-sideload part of make.sh, into the session scratchpad, not
  the whole make.sh): `promo-sideload-4x5.mp4` and `-9x16.mp4`, 48.4 s each (2906 frames). Frame strips of both,
  8 s to 22 s, show the real flow: form, Apple ID covered, Signing In, the code, the setup checklist, the free
  certificate with its name covered. The cut back to the recording holds the take's last frame while the recording
  taps Sources, so the stub's "Demo Person" certificate never shows. Not checked: the other clips of make.sh (not
  changed), and a viewing of the whole clip at speed by a person (only stills and strips were looked at).
- The raw recording is gone with the scratchpad. Changing the take's cuts or boxes means filming again.
- The take has the real phone's look where it differs from the recording: a "20" badge on Changes, the iOS 27
  keyboard and the half-hidden nav bar while the number pad is up.
