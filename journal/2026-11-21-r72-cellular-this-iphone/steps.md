# Steps for your iPhone, on cellular (R72)

Away from Wi-Fi, or at home with Wi-Fi disconnected as in step 1. Takes about 5 minutes. After each Check
Connection, write down what iFizBox says (Connected, or the alert's title).

1. Control Center: tap the **Wi-Fi** tile so it turns white ("Disconnecting nearby Wi-Fi"). Wi-Fi stays on but
   isn't joined. Cellular Data stays on (green).
2. **Tailscale**: iFizBox > Settings > Installation & Signing, Connect With: Tailscale, Tailscale VPN on.
   Tap **Check Connection**.
3. **LocalDevVPN**: Connect With: LocalDevVPN. Open LocalDevVPN, Connect (it replaces the Tailscale VPN).
   Back in iFizBox, **Check Connection**.
4. Control Center: tap **Cellular Data** off (the antenna tile turns white). LocalDevVPN still on.
   **Check Connection**.
5. Still with Cellular Data off: install any small app through This iPhone; when it says Copying, turn
   Cellular Data back on. Did it finish?
6. Optional, Airplane Mode instead of step 4: Cellular Data on, Airplane Mode on (Wi-Fi tile white),
   LocalDevVPN on, **Check Connection**.

Afterwards: Cellular Data on, Wi-Fi tile on again, and Connect With back to how it was.

Reply with one line per step, e.g. `2 refused, 3 refused, 4 connected, 5 finished, 6 connected`.

What I expect, from SideStore and StikDebug's code: 2 and 3 refused (cellular in use), 4 and 6 connected, 5
finishes. If 3 connects, Wi-Fi switched on is enough and nothing needs turning off.
