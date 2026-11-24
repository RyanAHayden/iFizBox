# B420: the bundled profile refreshes on update

- `BundledIdentity.replacesProfile` is the pure rule: a newer profile for the same certificate replaces the held one only if the file's .p12 holds that certificate, the profile lists it, same team and App ID, strictly newer CreationDate, not expired, and not leaving this iPhone out. Tests cover each case.
- `SignBridge.refreshBundledProfile` runs once at launch on the sideload build; `SignStore.replaceProfile` writes the profile file and the Keychain copy.
- The compare has its own seen key, `ifizbox.bundledProfile`, separate from `ifizbox.bundledIdentity`, so files marked under the old rule get one look.
- The compare also marks `seenKey`, so a certificate removed later stays removed.
- Nothing is marked while the held profile can't be read (phone locked) or the write fails, so the next launch tries again.
- The file's .p12 certificate must equal the held one, even if its profile lists several certificates.
- A profile with no date, or one with no devices, keeps what's held.
- A signed copy kept in My IPAs is keyed on the certificate, so one signed with the old profile stays in use until it is signed again. This is existing behaviour, the same as importing a profile by hand.

## Not verified

- On a phone: the swap needs two profiles of different dates for one certificate, and an update installed with the newer one. That would replace the shared 15 Pro test phone's signing profile, so it was not run there.
- The Keychain/Security half is compiled only; the rule is tested on Linux.
- That the user's old profile came through the bundled file is inferred, not checked.
