# T87a: free Apple ID computer setup on the iPhone 15 Pro

## Result
The free Apple ID computer setup ran up to the app's first launch on an iPhone 15 Pro (iOS 27.0.1, iPhone16,1) on 2026-11-26, from a
Linux x86_64 desktop, with the spare free Apple ID. The computer setup works up to the first launch of the app. The
first on-phone re-sign with the free profile does not work, and the app shows no Free Apple ID group after the
computer setup, so the weekly refresh cannot be reached on the phone.

Follow-up tasks: B473 (UDID dead end and lost sign-in on the website), B474 (no Free Apple ID group after a computer
setup), B475 (on-phone re-sign fails silently, bundle ID mismatch).

Screenshots: `ref/15/screens/t87a-*.png` (not committed).

## Steps that worked
Wording is what the screen shows. Taps are in order.

1. Lock taken with `ui-15.sh`. Safari on the phone opens `https://ifizbox.com/`. Home shows a red "Signing Needs
   Setup". Install iFizBox Lite > sheet "Sign iFizBox First" > **Use a Free Apple ID** > Signing page > **Use a Free
   Apple ID** > form "Sign In With a Free Apple ID" (Apple ID, Password, **Sign In**).
2. Apple shows an "Apple Account Sign In Requested" alert on the same phone (the spare ID is signed in on the 15 too)
   > **Allow**. A system alert shows the 6-digit code. Type it into the Two-Factor field > **Verify**. No second
   person is needed: the code appears on the phone under test.
3. (Step 3 failed; see What failed. Its workaround worked, then the sign-in was lost and had to be made again.)
   Sign in again on the website. No 2FA prompt the second time.
4. Checklist "Setting Up <name>": Register This iPhone shows "Added to the account" (green).
5. Certificate Limit alert: Apple lists 2 existing development certificates (iloader and iFizBox test). Revoke
   "iFizBox test" (the project's own old test certificate; iloader was left alone). Then Certificate shows "Until
   2027-11-26" with "Made a new certificate", App ID `com.ryha.ifizbox.4549VNVVAG`, Profile "Until 2026-12-03".
6. Download for a Computer Install: the page "Complete" lists Downloading, Signing, Uploading and Making a code (about
   25 s). **Show Code** gives a code (valid about 9 min) with the curl and PowerShell lines.
7. On the Linux desktop, run `curl -fsSL https://ifizbox.com/sign/setup.sh | sh -s -- CODE`. It prints, in order:
   "Downloading the setup command for Linux (x86_64)", "Found iPhone (iOS 27.0.1)", "Code OK: iFizBox 1.0.3 (32.2 MB)",
   "Installing", "Installed iFizBox", "Gave the app its pairing file", "Done". Exit 0. No Trust prompt was needed
   (usbmuxd was already paired).
8. The app appears on the Home Screen as `com.ryha.ifizbox.4549VNVVAG` (signer iPhone Developer, the spare ID's team
   4549VNVVAG), beside the older Lite `com.ryha.ifizbox` (Apple Distribution, team S8NFX3A2LT).
9. Open it: "Untrusted Developer" > Settings > General > VPN & Device Management > the developer row > **Trust** >
   **Allow**. Developer Mode was already on. The app opens to Home (iFizBox 1.0.3, LITE icon). The banner "Profile
   Expires Soon: Expires in 6 days . Renew in Signing" shows right after the fresh setup.
10. Settings > Installation & Signing shows "Ready to Install", Certificate "364 days left", Signed Apps 0. The
    Certificate page shows the name "iPhone Developer: <team>", the profile "iOS Team Provisioning Profile:
    com.ryha.ifizbox.4549VNVVAG", "Expires Dec 3 2026", Devices 1, "This iPhone In Profile". The app reads the
    identity from the computer setup.

## What failed
- **UDID dead end (B473).** Checklist "Setting Up <name>": Register This iPhone is red with "This iPhone's UDID isn't
  known yet." Its only buttons are Try Again and Sign Out. Nothing points to Find This iPhone's UDID.
  Workaround that worked: open `#settings/signing/udid` > Download Profile > Allow > Settings > General > VPN & Device
  Management > Downloaded Profile > Install (Not Signed warning, Install twice) > Safari page "UDID Sent (iPhone16,1)".
  The Downloaded Profile row stayed listed afterwards and was removed by hand (Remove Downloaded Profile).
- **Sign-in lost after the detour (B473).** The website page reloaded and the Apple sign-in was gone. Signing in again
  worked (see step 3).
- **No Free Apple ID group, so no Refresh Profile (B474).** Settings > Installation & Signing has no Free Apple ID
  group, although the certificate in use is the free identity. docs/signing.md says the group shows in that case, so
  the weekly refresh (Refresh Profile) is unreachable on the phone. The Home banner's "Renew in Signing" leads nowhere.
- **On-phone re-sign with no computer fails silently (B475).** Installed > iFizBox > **Install** > **Confirm**
  (30.4 MB). The app signed on the phone (817 files, 5 Mach-O, 4 bundles). The log says "Kept its bundle ID" and also
  names the App ID `4549VNVVAG.com.ryha.ifizbox.4549VNVVAG` in its entitlements, so the IPA keeps `com.ryha.ifizbox`
  while the free profile is for the suffixed ID. The app was uploaded to the Signing Server (`sign.ifizbox.com/sign/host`,
  itms-services). iOS asked '"sign.ifizbox.com" would like to install "iFizBox"', and **Install** was tapped. The
  Console Log says "Completed" for both Sign and Install, but nothing changed: both apps keep their old signers and
  version 1.0.3. The older Lite copy (`com.ryha.ifizbox`) briefly got a blue dot on the Home Screen.
  Settings > Installation & Signing > This iPhone then says "Network Extensions Missing: This profile has no Network
  Extensions, so it can't connect. Sign with one that has them, or use the Signing Server." On a free profile the
  This iPhone route is unavailable, and the Signing Server route is refused by iOS for free profiles (docs/sideload.md,
  error 111).

## Verdict
- Worked: website sign-in, 2FA, certificate limit alert, the UDID workaround (after the detour), the checklist, the
  code, setup.sh, install, pairing file, Trust, first launch, and the app reading the certificate and profile.
- Failed: the UDID dead end, the sign-in lost after the detour, no Free Apple ID group or Refresh Profile in the app,
  the on-phone re-sign (silent), the bundle ID mismatch.

## Not verified
- That the failed on-phone install is iOS error 111. iOS showed no message and the device log was not read.
- Mac and Windows computers: only Linux x86_64 was run.
- A second week's refresh (the profile runs to 2026-12-03).
- The cause of the blue dot on the older Lite copy (unsuffixed ID).
- Whether setup.sh ran with Developer Mode toggled: it was already on.
