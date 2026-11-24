# R100b: switch-back run from the app (iPhone 15 Pro, iOS 27.0)

Measured 2026-11-24, 16:11 to 16:25. Tailscale On Demand on. Restore My VPN off unless stated. Settings > VPN was never opened. State was read from idevice.status and from the syslog. The signed draft `ref/shortcuts-signed/restore-plain.plist` was imported as "Restore My VPN". The Mac (MBA) was offline, so nothing could be re-signed.

## Summary (Go/No-go first)

**GO with one plist change.** The Back run from the app works, and the trip takes about 1 s. But the signed draft prompts the person whenever a run reports back with a callback, and that blocks the return until someone taps. Adding a final `nothing` action to the plist removes the prompt in the phone test. That change needs a re-sign on the MBA, which has not been done.

- Back run from the app: Shortcuts comes to the front for about 1 s, runs Set VPN, and returns to the app through the x-callback URL. Tailscale comes back in every run.
- The callback type does not say whether the VPN came back. Set VPN ended with error 2 in half of the Back runs, after the VPN had already switched. Treat x-success and x-error alike as "back from Shortcuts", and check `idevice.status` for `otherVPN`.
- The prompt: "Allow “Restore My VPN” to share 1 vpn with iFizBox?" (Back) or "...to share output with iFizBox?" (check). It appears after the VPN has switched, and it appears only when the run has an x-callback. A plain run with no callback never prompts (R100a).
- Cause: the workflow's last action is the closing If, and its output is returned to the app. Adding a top-level Nothing action as the very last action stopped the prompt in the test (done in a duplicate, in the Shortcuts editor).
- Setup and use are unchanged from R100a: store once, use the app, then run Back.

## What was measured

Back run from the rig, no callback: `shortcuts://run-shortcut?name=Restore%20My%20VPN&input=text&text={"back":1}`.

- Shortcuts comes to the front. A cold start and a warm start both reach the foreground in about 0.1 s.
- It shows its normal All Shortcuts grid. The "Restore My VPN" tile shows a spinner, then a check mark. The status bar shows the "◂ iFizBox" back link. No alert, no prompt, no banner text.
- Set VPN runs in BackgroundShortcutRunner 0.3 to 0.4 s after the open request. Warm run: open at 59.07, Set VPN done at 59.47, Tailscale enabled=1 and our VPN enabled=0 at 59.51.
- Without a callback the person stays in Shortcuts. Nothing returns to the app, and the app is behind it.
- A cold Shortcuts start (first run after the apps were closed) took 1.1 s from the open request until the app was back in front with a callback.

Trip time with an x-callback run (`shortcuts://x-callback-url/run-shortcut?...&x-success=ifizbox://sources&x-error=ifizbox://about`):

- Open request, then Shortcuts in front at 0.07 s.
- Set VPN done at about 0.4 s.
- The app open request from Shortcuts at about 0.4 to 0.9 s.
- App visibility Foreground at about 0.9 to 1.2 s after the open request.
- The whole trip is about 1 s. The app lands on the callback URL's page (Sources was seen), with "◂ Shortcuts" in the status bar.

Set VPN result and callback (four Back runs with Tailscale stored):

- Two runs finished clean (error false). The x-success callback fired.
- Two runs ended with NEVPNErrorDomain Code=2 on action 13 (Set VPN). The x-error callback fired (the app opened by x-error, not x-success).
- In all four runs, Tailscale got enabled=1 and our VPN got enabled=0, and `idevice.status` reported `otherVPN` true (utun5). So error 2 came after the effect.
- Declining the output prompt ("Don't Allow") gives WFSmartPromptErrorDomain Code=0, and x-error fires at once. In the test, Notes opened.
- No pattern was found for error 2. Both clean and error runs followed the same vpn.test steps.

Prompt on the signed draft (KEY FINDING):

- With any x-callback, the draft asks "Allow “Restore My VPN” to share 1 vpn with iFizBox?" (Back) or "...to share output with iFizBox?" (check). Choices: Don't Allow, Allow Once, Always Allow.
- The cause: the last action of the workflow is the closing If, and its output is returned. The `nothing` action sits only inside the Check branch.
- The prompt comes after the VPN has already switched, and it blocks the callback until someone taps.
- Test fix, on a duplicate Shortcut: append a top-level "Nothing" action as the very last action. iOS also added an automatic "Stop and output If Result", which had to be removed in the editor. After that:
  - A check run with x-success returned to the app with no prompt: open at 23:28.995, app request from Shortcuts at 29.325, app in front at 29.904 (about 0.9 s).
  - A Back run with Tailscale stored and an x-callback ran with no prompt. It ended with error 2 that time, the x-error callback fired, and Tailscale came back.

Nothing stored:

- A fresh duplicate of the Shortcut (its own stored content empty). Back run with Tailscale on, then with it off.
- The run goes through the three Get Value actions and the conditional. It never reaches Set VPN. It finishes with a success banner, with no alert and no error. Tailscale stayed untouched (it stayed off when it was off).
- So a Back with nothing stored is silent. The app cannot tell from the run.

Stored VPN deleted (proxy test: Tailscale cannot be deleted from here, because it needs the owner's login):

- Stored our own VPN configuration: ran Install Switch `{"start":1}` to make it the current VPN, then the duplicate's store run.
- Restore My VPN on, then `vpn.test` removed our configuration ("Restore My VPN: configuration removed").
- Back then failed at once (22:18.732) with WFActionErrorDomain Code=6. Shortcuts showed an alert, "VPN not found: The VPN you selected is not available on this device", with Show and OK buttons. No callback came until OK was tapped. Nothing changed.
- A re-created configuration gets a new UUID (685EA4AC… became 79E4AE2C…). The stored VPN is matched by that UUID, so after a re-create the stored VPN no longer matches.
- Tailscale's stored VPN was unaffected.

Other findings:

- The store run with the other VPN not current (ours enabled but not connected) ran silently.
- The duplicate's store run showed no "share vpn" prompt, because Always Allow had been given on the original.
- After a removal, the first `vpn.test` shows "iFizBox Would Like to Add VPN Configurations". I tapped Allow 3 times today. With Restore off, the configuration stayed on later saves.
- Timing came from the syslog, read live with pymobiledevice3. WDA video recording pulled 0 bytes (the `ios file pull` of the attachment hung), so the frames here are screenshots taken every 0.5 to 1 s, not video.

## Not verified

- Video of the trip (the recording pull failed).
- A locked phone.
- A VPN other than Tailscale.
- Cellular.
- Tailscale itself deleted (a proxy was used).
- The final-`nothing` plist as a signed file. It was tested only by editing a duplicate in the Shortcuts editor, not by re-signing.
- The restore-app variant with its app intents. It was not imported, so this journal does not test it.
- Why Set VPN ends with error 2 in about half the runs.
- A passcode.
- Long gaps or reboots between the store and the Back run.

## Plist change for F418

The signed draft (`ref/shortcuts-signed/restore-plain.plist`) keeps its actions in this order. Changes are marked NEW.

1. Detect the dictionary of the run input (ExtensionInput).
2. Get Dictionary Value, key `store`.
3. Get Dictionary Value, key `back`.
4. Get Dictionary Value, key `check`. Each of the three reads the input from step 1.
5. If Store: Get Current VPN; If Current VPN has any value: Set Stored Content, key "own VPN", input the VPN from Get Current VPN.
6. If Back: Get Stored Content, key "own VPN"; If Stored Content has any value: Set VPN, operation Connect, VPN from Stored Content.
7. If Check: Nothing.
8. NEW: Nothing, as the very last top-level action, after the last closing If.

Run inputs are JSON text: `{"store":1}`, `{"back":1}`, `{"check":1}`.

The generator (`gen.py`) should add one `act("nothing")` at the end of the action list, for both variants. The tail inside the branches stays as it is. The re-sign has to be done on the MBA.

Alternative, untested: report only through the app's own intents (the restore-app variant's OpenForInstall and FinishInstalls intents) and run with no x-success. In the restore-app variant, Back's inner If never reaches those intents.

## Recommendation for F418

- Run Back only from the app after use. Treat the return (x-success or x-error) as the end of the trip. Do not judge by the callback type.
- Check `idevice.status` `otherVPN` after the return.
- Expect about 1 s of Shortcuts on screen.
- Add the final `nothing`, then re-sign on the MBA. Without a callback the person is left in Shortcuts, so keep x-callback with the final `nothing`.
- Known cases to handle in the app: Back with nothing stored (silent), and a stored VPN that is gone (the "VPN not found" alert, which waits for OK).

## Phone put back

- Restore My VPN: off.
- Tailscale: connected (otherVPN true, utun5).
- Our configuration: saved. It was re-created with a new ID after the removal test, and it stays.
- My duplicate Shortcut, "Restore My VPN 2", deleted.
- UI lock released.
- Still on the phone from before: "R100 Store" and "R100 Back" (hand-built, from R100a, not usable). Delete them when convenient. "Restore My VPN" is the imported signed draft (restore-plain.plist), which is the one this journal tested.
- Screenshots: `ref/15/screens/r100b-*.png` (not committed).
