# B294: IPA page footer follows Install Apps With

## What I did
- `web/app/screens/myipas.js`: the footer under Sign Now / Save Signed IPA now comes from `actionsFooter(route)`,
  fed by `storedRoute()` (the same read `signing/route.js chooseRoute` uses). This iPhone: "Installing needs only
  the VPN to this iPhone (LocalDevVPN or Tailscale), no Signing Server." Signing Server: the old manifest line.
- `web/app/screens/myipas-b294.test.js`: both texts.
- Named the VPNs from `vpnList()` rather than the one that is on, since that needs an `idevice.status` call per
  page draw; the list matches what Install Apps With's own subtitle says.

## Tried and failed
none

## Not verified
- On a phone (the 15 Pro, Tailscale route): not checked; the change is one text picked from a stored setting,
  covered by the unit test, and the task is low priority.
- Whether an IPA page already open redraws when Install Apps With changes: the page redraws on entry changes only
  (B277), so the new footer shows on the next open of the page; not checked in Chromium.
