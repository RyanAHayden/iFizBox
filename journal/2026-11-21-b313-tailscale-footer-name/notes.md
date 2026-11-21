# B313 Tailscale footer names the device the app joins as

Signed out, the Tailscale group's footer (Install Apps With, and This iPhone) said `iFizBox on iPhone`, while the
node joins as `Tailscale.hostname` = `"<brand> on <deviceName>"` (e.g. `iFizBox on iPhone 15 Pro`).

## What changed

- `native/sideload/tailscale/Tailscale.swift`: `tailscale.status` also returns `hostname` (that same
  `Tailscale.hostname`); the bridge comment at the top lists it.
- `web/app/core/installroute.js` `tailscaleFooter`: signed out, it shows `("<hostname>")` when the status has one,
  and just "as its own device" with no name when it doesn't (an older shell, or the status not there yet). It no
  longer makes up a name.
- `web/app/core/installroute.test.js`: with a hostname, without one, with an empty one, and with no status.
  (The brief named `web/app/core/test/installroute.test.js` and then the screens tests; the footer's existing
  assertions live in `web/app/core/installroute.test.js`, so the new ones went there.)

## Check in Chromium (fake bridge)

`capture.mjs` here is F317's copy with `tailscale.status` read from `TS` (env). The page reads Tailscale from
`idevice.status`'s `tailscale` field, so `PAIR` carries it too:

    PAIR='{"paired":true,"tailscale":{"signedIn":false,"connect":"tailscale","hostname":"iFizBox on iPhone 15 Pro"}}' \
    TS='{"signedIn":false,"connect":"tailscale","hostname":"iFizBox on iPhone 15 Pro"}' \
    node capture.mjs http://127.0.0.1:8791/ shots with.json --mode sideload

(web/app served with `python3 -m http.server 8791 --bind 127.0.0.1 --directory web/app`.) `shots/with.png`
shows the footer: "iFizBox joins your tailnet as its own device ("iFizBox on iPhone 15 Pro") and reaches this
iPhone through it, so Tailscale can stay on." On the first try, without `tailscale` in `PAIR`, the footer read
"… as its own device and reaches …", which is the no-hostname case.

## Not verified

- The Swift change isn't compiled or run: this Linux machine has no iOS toolchain, and building the sideload app
  needs the MBA. It's one more key in a `[String: Any]` literal, built from a `String` property already used for
  the node's name.
- Not checked on the 15 Pro: the footer text comes from the web layer, which Chromium checks; the only native part
  is the extra key, which would need a new sideload build on the phone.
