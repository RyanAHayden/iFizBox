# R105: computer install with a new certificate over the installed copy

## Goal
B479 makes a computer install (`ifizbox.com/sign/setup.sh`) replace the held certificate when the install brings a new
Free Apple ID certificate. R105 checks this on the iPhone 15 Pro. The installed Free Apple ID copy is
`com.ryha.ifizbox.4549VNVVAG` (1.0.4 build 6091). After a computer install over it with a newly made certificate, the new
serial must be in `signing.status` and in localStorage `ifizbox.freeid`. The log should say the certificate inside the app
replaced the held one.

## Before
- The app held serial `6C7616E225E00F9FE1C829B32D10CDBA` in both `signing.status` and `ifizbox.freeid`, from the B478 run.
- Release 1.0.5 is published. `setup.sh` reported `Code OK: iFizBox 1.0.5 (32.2 MB)`.

## What I did (2026-11-26, about 20:51 to 20:57)
- In Safari on the phone, `ifizbox.com` Settings > Signing already held a Free Apple ID record. I tapped Forget Free Apple
  ID, then Set Up, and signed in with the spare Apple ID. No 2FA prompt appeared.
- The Certificate Limit alert listed Apple's two certificates: `iloader` (until 2027-10-29) and `iFizBox Website`. I revoked
  `iFizBox Website` (the `6C76…` one) and left `iloader`. The page then said "Made a new certificate", with Certificate Until
  2027-11-27.
- Download for a Computer Install gave the code `HP2H-8MNX`. On the desktop I ran
  `curl -fsSL https://ifizbox.com/sign/setup.sh | sh -s -- HP2H-8MNX`. It installed iFizBox 1.0.5 and the pairing file, exit 0.
- I launched the app and read its state over Web Inspector (`pymobiledevice3 webinspector cdp`, `Runtime.evaluate`):
  - `signing.status` `identity.serial` = `489CED16A91951DE50F8D95ACCF801B6`, expires `2027-11-27T01:43:57Z`.
  - localStorage `ifizbox.freeid` serial = the same `489C…`.
- No `signing.remove` or `signing.import` was run by hand. B478 needed that step; B479 does not.
- Afterwards the phone lock was released with `ui-15.sh unlock`.

## Result
- The held certificate changed from `6C76…` to `489C…` through the computer install alone. The check passes on the serial.

## Tried and failed
- The log line "the certificate inside the app (serial …) replaced the held one (serial …)" was not seen. It is an NSLog
  from `native/Sources/SignBridge.swift`.
  - `pymobiledevice3 syslog collect` made a logarchive. Linux cannot read its unified log, because the strings are
    compressed.
  - `ssh mba` (a Mac with `log show`) timed out.

## Not verified
- The log wording. The new serial in `signing.status` can only come from the replace path (`importIdentity`), so the
  result is checked, but the NSLog text is not.
- Apple's certificate list. It was read only from the Certificate Limit alert (`iloader` and `iFizBox Website`), not with
  a `listCerts` hook.
- The Free Apple ID app's own Sign In Again, and the paid Lite copy (`com.ryha.ifizbox`). Neither was touched.

## Side effects
- Apple now lists `iloader` and a new `iFizBox Website` (`489C…`). The earlier `6C76…` is revoked.
- Other tasks that carry `6C76…` will see the Certificate Limit alert. See the spare Apple ID certificate churn lesson in
  the B478 journal.
