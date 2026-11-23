# B405: helper package names

## Findings
Read-only survey on the iPhone 7: 14322 stanzas, 4554 names (21 sources' lists plus dpkg status).

- The old name rule (`[a-z0-9][a-z0-9.+-]+`) refused 168 distinct name/architecture/list entries with capitals: 23 names under iphoneos-arm64, 143 under iphoneos-arm, 2 under iphones-arm. Most are in Packix (102) and Havoc (44), e.g. Oreo, OreoDark and arm64 themes such as com.julian.Nebula.
- It refused 1 name with an underscore: gsc.device-supports-liquid-detection_-corrosion-mitigation (dpkg status).
- It refused 3 names ending in + (libdb18.1++, com.gilshahar7.notability++, com.beckettobrien.btmanager+). The queue verbs refused them too.
- Versions: 2 were refused for `beta1` (com.allstars101.oneui2theme, com.prismdevelopers.Antimony in Twickd). A version of `2.2 ` is trimmed, and an empty one isn't sent.
- Known and twice checks: case only now. 8 names are spelled two ways in the lists.
- The user's photo named no exact package; the message was cut off.

dpkg: `--validate-pkgname` takes capitals, `_`, a trailing + and a one-letter name, and refuses `/`, `:` and a leading `-`. Test .debs with `dpkg --no-act`: capitals, `_` and + are accepted, and dpkg lower-cases the Package. `beta1` and `1.0-` are refused ("version number does not start with digit", "revision number is empty"). `iphoneos-arm` is refused as an architecture, which the package page already says (Rootful only).

apt-get -s: chaoge.ChargeLimiter works in any case. Oreo and OreoDark (iphoneos-arm) report "Unable to locate", while oreo and oreodark are found, which is why names go to apt in lower case. libdb18.1++ works.

Test .debs were removed from the phone. Underscore names are stored as `%5f` in apt's archive names.

One-letter names stay refused (none in the lists): `-o` would read as "remove o".

## Not verified
- An on-phone tap through the app's Confirm sheet.
- A real install (the task was simulate only).
- The new helper binary run through the app on the phone: the caller check refuses ssh, so the exact apt-get commands it plans were run on the phone instead.
