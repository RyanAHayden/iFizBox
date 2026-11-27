# F465b: Install Without a Computer on the website

## Did

- The free Apple ID Ready page (`web/app/screens/computer-install.js`) now offers **Install Without a Computer** under the computer's code: Get Open Minis, Get LocalDevVPN, and the copyable line `wget -qO- https://ifizbox.com/sign/setup.sh | sh -s -- <code>`. **Computer Install** stays as it was.
- Tests are in `web/app/screens/computer-install.test.js`.
- Docs: `docs/sideload.md`, `docs/signing.md`, and `release-notes/F465b.md`.

## Decision

- The section must not go live before a setup release that ships **Phone Setup**. Rather than rely on someone remembering, the site reads `/sign/setup.sh` and offers the section only if the script contains `minis-bonjour` (in `tools/setup/install.sh.in` since F465) and the user agent says iOS 27 or later.
- The script published on 2026-11-25 (the setup release) was fetched from ifizbox.com and does not contain the mark, so nothing new shows today.
- A test checks that `install.sh.in` carries the mark.
- The Start footer changes only when the section is offered.
- The Finish Setup footer now reads "Once iFizBox is installed" (it no longer says "the computer has installed").

## Checked

- `node --test` on `computer-install.test.js`: 10/10 pass.
- Chromium screenshot of the block with a stand-in setup script and code: layout fine.
- `tools/setup/release.sh --dry-run` built all five targets. Nothing was published.

## Found

- Open Minis is no longer on the App Store as of the afternoon of 2026-11-27. The link in Open Minis' own GitHub README (`https://apps.apple.com/app/id6759188481`) shows "App Not Available" on the iPhone 15 Pro. `apps.apple.com` returns 404 for us, gb and cn. Apple's iTunes lookup returns 0 results by id (us, gb) and by bundle ID `com.openminis.app`, while the same lookup finds LocalDevVPN.
- It was installed from the App Store on that phone earlier the same day (F465) and is still installed (1.16).
- Its TestFlight public link (`https://testflight.apple.com/join/3BdkA5c3`) answers with a join page. Not tried on the phone.
- The reason for the removal is not known; it may be temporary. A question was put to the person before finishing.
- Tried and failed: `ui-15.sh` screenshots of the iPhone 15 Pro came back all black, although WebDriverAgent's page source showed the App Store in front. The App Store alert was read from the page source.

## Not verified

- The real line end to end on the iPhone 15 Pro. The published setup command has no Phone Setup (publishing happens only on a person's ask), and Open Minis cannot be installed from the App Store now.
- A stand-in run of the line (dry-run binary served inside Open Minis) was not done, pending the Open Minis decision. So `wget | sh -s -- <code>` through `install.sh` on the phone is still untried.
- The section on a real iOS 27 Safari. Only Chromium with an iOS user agent from the harness was used. The user agent rule is the existing one in `core/compat.js`.
- The two App Store rows tapped in Safari.
