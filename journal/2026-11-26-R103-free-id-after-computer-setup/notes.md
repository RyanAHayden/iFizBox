# R103: Free Apple ID after a computer setup, on the iPhone 15 Pro

## Goal
Check on the iPhone 15 Pro, after a real computer setup, what B474 promises:
- Settings > Installation & Signing shows the Free Apple ID group.
- Sign In Again, then Refresh Profile, makes and imports a new profile.
- Home's "Profile Expires Soon ... Renew in Signing" tile opens that page.
- The days left match, and read 7 right after setup.

## Result
Run on 2026-11-26, about 17:48-17:53 local, on an iPhone 15 Pro (iOS 27.0.1), with the website carrying B474's code
(`app.js`, `websign-job.js` and `screens/free-apple-id.js` mention `free-id.json` and `adoptBundledFreeId`), a spare free
Apple ID and a Linux x86_64 desktop.

Steps: Safari on the phone, Install iFizBox Lite, Use a Free Apple ID. The Signing page already had the saved free
identity (profile until 2026-12-03). Download for a Computer, Install, then the one-liner
`curl -fsSL https://ifizbox.com/sign/setup.sh | sh -s -- CODE`. It found the iPhone, checked the code, installed
iFizBox 1.0.4 (32.2 MB), pushed the pairing file and finished. The app (`com.ryha.ifizbox.4549VNVVAG`) launched at once.
Trust and Developer Mode were already on. The paid Lite copy has a different bundle ID and was untouched, so no backup
was needed.

- **Pass, bundled identity**: `web/free-id.json` is in the app and was adopted. `ifizbox.freeid` and
  `ifizbox.freeid.bundled` are set in localStorage (read over Web Inspector).
- **Partial, where the group lives**: the Free Apple ID group is not on the main Installation & Signing page. It is on
  the Certificate sub page, at the bottom, as "Use a Free Apple ID / Set Up". It shows Team, Certificate Until, App ID,
  Profile Until, Developer Mode and Trust, and the buttons Sign In Again, Forget Free Apple ID and Done. In a fresh app
  session the button reads Sign In Again; Refresh Profile appears only after sign-in.
- **Pass, tile**: Home's "Profile Expires Soon / Expires in 6 days · Renew in Signing" opens Installation & Signing.
- **Days left**: the tile reads 6 and the profile says "Until 2026-12-03". The profile was made earlier the same day, so
  6 whole days is correct. Reading 7 right after setup was not checked, because no fresh profile was made.
- **Fail, Sign In Again**: signed in with the spare ID (Allow, 2FA code on the phone, Verify). The checklist reached
  "Register This iPhone: Already on the account". Then Development Certificate showed the "Certificate Limit" alert
  (Revoke iloader / Revoke iFizBox Website) instead of reusing the carried certificate. So B474's promise (no new
  certificate, no Certificate Limit prompt) did not hold. Cancel showed "Setup Stopped: No certificate was revoked, so
  Apple can't make a new one." Nothing was revoked.
- **Not reached**: Refresh Profile and importing a new profile. Refresh Profile needs a portal session, which the
  certificate limit blocked.
- **Not verified**: a new profile made and imported after Sign In Again; the days left right after setup; whether the
  cause is the certificate serial format (a guess, not checked).

Filed as B478: `freeroute.js` `certificate()` should reuse the saved certificate after checking `saved.teamId`,
`saved.p12` and the serial against `listCerts` (`serialNumber`) and `issued()`.

Screenshots are in `ref/15/screens/r103-*.png`. They are not committed, and they show the spare Apple ID's email.
