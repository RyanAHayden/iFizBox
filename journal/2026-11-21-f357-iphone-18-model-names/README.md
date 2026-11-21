# F357 iPhone 18 line and 17e in Tailscale.modelNames

## Done
- `iPhone19,2` → "iPhone 18 Pro". Evidence: an earlier USB read of the user's phone (memory note
  iphone15-lockdown-over-wifi, 2026-11-20) gave ProductType iPhone19,2 with DeviceName "r/i18P", and today
  `tailscale status` lists that phone as `iphone192` / `ifizbox-on-iphone192` (the identifier fallback F353 left).
- `iPhone18,5` → "iPhone 17e", from the public identifier lists I know (17e, February 2026).
- test_tailscale.py: MachineName checks both entries, keeps them in the "never falls back" list, and checks the
  label ends `-on-iphone-18-pro`.

## Tried, failed
- Reading ProductType from the 18 Pro again today: it is not on USB (only the 15 Pro, iPhone16,1, is), `ideviceinfo -n`
  doesn't find it, and the R33 lockdown probe at 192.168.0.60 got "connection reset by peer".

## Not verified
- The other iPhone 18 line identifiers (18 Pro Max, anything else from autumn 2026): not known to me and no such phone
  is here. iPhone19,2 being the Pro (not the Pro Max) breaks the old ",1 = Pro" order, so they can't be guessed; they
  still fall back to the identifier. Filed as a follow-up.
- iPhone18,5 = 17e not checked on a device (none here).
- No build or phone run of the new names: a table entry only, covered by the unit test.
