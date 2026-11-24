# B419: an install asked for Airplane Mode with Wi-Fi joined

The screenshot shows 5G in the status bar (iOS's own route was cellular then), with the stale-configuration failures of B418.

**Can `LocalVPN.Path.now()` read cellular with Wi-Fi joined?** By its code, yes: it was
`usesInterfaceType(.cellular) && !usesInterfaceType(.wifi)`, and NWPathMonitor's path lists what iOS would route on, not
what is joined. Reasoned, not measured:

- Wi-Fi Assist, and Wi-Fi without internet (captive portal): the path is cellular, en0 keeps its address, and the
  status bar shows 5G. Both fit the screenshot.
- Another VPN's route: its utun comes first; whether `wifi` still shows is up to iOS.
- Our own VPN: its route is 10.7.0.1 only, so the default path should not change.
- Low Data Mode: only sets `isConstrained`, the interface stays.
- Wi-Fi dropping for a moment (e.g. as the VPN starts): cellular for a few seconds, and the wait asked at the first read.

Which one it was can't be told from the screenshot: no path was logged. It is now (status, interfaces, types used,
expensive, Low Data Mode, en0 IPv4 yes/no).

Changed:

- an IPv4 address on en0 (up and running) is Wi-Fi, for `now()` and so for `idevice.status` and the "can go off" line.
- before asking, the path is read for 3 s after the VPN is on (it must come on first: no network, no start). Wi-Fi in
  that time goes on at once. Off cellular without Wi-Fi still settles 1 s, and returns "not waited".
- "Join Wi-Fi or turn on Airplane Mode" comes from AIRPLANE_ON, so the row, the bottom line and the Log tab all have
  it; apprun.js needed no change. Joining Wi-Fi ends the wait in the same loop as before.

**Not verified**

- Real cellular, Wi-Fi Assist, a drop, and joining Wi-Fi during the wait: the iPhone 15 Pro has no SIM, and no other
  phone here runs the sideload build on cellular. Only the code's shape (test_vpn.py) and the wording are tested.
- Whether iOS takes the install's connects while Wi-Fi Assist is using cellular with Wi-Fi joined: the task says joined
  Wi-Fi never waits; if iOS refuses, the install fails with its connect error and the log has no wait lines.
