# R80: Install Switch Notification automation, follow-up measurements on the iPhone 15 Pro

## Result

Measured on the iPhone 15 Pro, iOS 27, Wi-Fi only, no SIM service, on 2026-11-23. Every run used a probe build
and a stand-in body (Toggle appearance), not the real Install Switch actions.

| # | Question | Answer | One line |
|---|---|---|---|
| 1 | The trigger can be carried in a signed .shortcut | Not determined | No export could be made, so no plist was read; a guessed key was ignored on import. |
| 2 | One automation covers start and end, by a title filter | Yes | "Title contains" with one word fired for both messages and not for another title. |
| 3 | Restore after a failure, a kill or a timeout | Partly | A later end still ran after a failed run, and a scheduled end ran with the app killed. But triggers were dropped for a while after an erroring run. |
| 4 | Focus, locked, notification removed at once | Partly | Do Not Disturb did not block; the locked phone ran both runs; a notification removed within about 0.1 s did not run. Other Focus modes not tried. |

## 1. The trigger in a signed .shortcut

Not determined. Learned:

- On the phone, the trigger is not one of the Shortcut's actions. The Shortcut's action list holds only the
  Show Notification action. Its body refers to the trigger by a variable (the trigger's Notification output).
- The trigger is a separate row linked to the Shortcut. It holds the trigger identifier (Notification), the app
  (bundle ID, name and team), and a title filter (operator "contains", property Title, one value).
- Saved from the editor, the automation appears in Automation as "When I get a notification from iFizBox", enabled.
  The editor flow is about seven taps (Library, Automation, +, Edit, search and pick the trigger, App, the search
  field and the app). It offered no Run Immediately or Ask Before Running choice: the automation ran without
  asking, and no first-run Allow prompt appeared for the stand-in actions.
- Export from the phone was not possible. Save to Files asks for iCloud sign-in and left a loading sheet that
  cleared only after a reboot. Copy iCloud Link needs iCloud too. The share row has no iFizBox entry.
- A made .shortcut was tried: the same action plus a guessed top-level key holding the trigger. It was signed,
  placed in the app's Documents and shared to Shortcuts. The import showed the action but no trigger card. So the
  guessed key is ignored; the real key is unknown.

## 2. One automation for start and end, by title

Yes. Add Filter with "Title contains" works. The filter is one tap to add, then the value field is typed.

- Two posts, "start" and "end", with the same word in the title, both ran the one automation.
- A post with another title, from the same app, did not run it.
- Eight of eight posts ran with a body that cannot error, alternating start and end 12 s apart.
- The Notification variable holds the title then the body. A Shortcut can tell start from end by an If on that
  text. The other way is two automations (filter "start", filter "end"), which costs about twice the set-up taps.

## 3. Restore after a failure, a kill or a timeout

Partly.

- **Failure.** The start's run ended in an error (its third action failed). The next end post, 19 s later, still
  ran, and the appearance was restored. So the end is a separate run and does not depend on the start's run.
- **Kill.** The app was killed right after the start was posted and an end was scheduled 30 s ahead. The system
  delivered the scheduled end with the app dead, the automation ran, and the appearance came back about 30 s
  after scheduling. So a notification scheduled at the start restores the state even if the app is gone.
  The app cancels it (remove pending and delivered) when the real end is posted; after a cancel, the scheduled
  end did not fire.
- **Erroring body drops triggers.** With the failing action in the body, 6 of 15 posts ran over about 9 minutes
  (run history: 12:48:37, 12:48:56, 12:49:11, 12:49:40, 12:50:54, 12:56:06); all runs that did happen ended in an
  error. In an eight-post loop, the first post ran (and errored) and the other seven, 8 to 80 s later, did not. The
  automation stayed enabled throughout. There is no simple window: posts 15 to 29 s after an
  erroring run ran, a post 74 s after one ran, but a post 40 s after one and others up to 80 s after did not. The
  rule behind the drops is not known (a count of failures, or a backoff). Without the failing action, 8 of 8 ran.
- The failing run also showed a banner: "Show Notification: No URL Specified".

Consequences: the body must not be able to error; the end cannot rely on one notification alone; the app should
also restore at the next launch.

## 4. Focus, lock and removal

- **Do Not Disturb** (Silence all notifications, moon in the status bar): the start toggled the appearance and
  the end toggled it back. Not blocked.
- **Locked screen:** a start posted with a 12 s delay, then the lock button pressed. After unlock at 25 s, the
  appearance had changed (light to dark). Then an end posted the same way, with the screen black 4 s after the lock
  (checked by a screenshot): after unlock the appearance was back (dark to light). So both ran while locked.
- **Notification removed at once:** removed 0.1 s after its delivery time: neither start nor end ran (two tries).
  Removed 1.5 s after delivery: ran. Removed 4 s after: ran. So the system reads the notification within about
  0.1 to 1.5 s. Do not remove a start or end notification in its first 2 s.
- With the app in front, the notification showed as a banner from iFizBox, and a second banner from Shortcuts
  about 2 s later.

## Probe

How it was done, for the next person:

- A scratch worktree of main with one throwaway Swift file, hooked into the app's incoming-URL handler. It was
  never merged. Its hooks: post a local notification with a time-interval trigger (so the system delivers it with
  the app dead) and remove it N seconds after delivery; remove pending and delivered notifications for an ID; exit
  the app; share a file from the app's Documents through the share sheet. Each hook wrote a line to a log file in
  Documents.
- Built with the repo's native build script on Linux and installed with `tools/ui-15.sh`.
- Notifications for iFizBox were turned On in Settings (they were Off before).
- The test automation was made by hand in the Shortcuts app: Automation, +, Edit, search "When I receive a
  notification", App iFizBox, Add Filter "Title contains" with the test word. The action was Show Notification
  (body = the trigger's Notification variable) plus Toggle appearance as a visible stand-in. The failure test added
  a Get Contents of URL with an empty URL, which errors with "No URL Specified".
- Run history was read from Shortcuts' database in an unencrypted iOS backup taken with pymobiledevice3 (three
  backups, about 2 minutes each, about 10 GB, deleted after). The tables used: the Shortcut, its actions, its
  triggers, and the run events (outcome 1 = ran, 2 = ran with an error, 0 = other).

## Put back

- The test Shortcut and the test automation were deleted. The phone keeps Install Switch, Cellular Data On and
  Cellular Data Off, as before.
- Do Not Disturb off. Appearance set back to Dark, as at the start.
- iFizBox notifications set back to Off.
- The plain iFizBox build (from the repo's native build folder) was reinstalled over the probe.
- The phone was locked and the lock released.
- The three Shortcuts database backups were deleted.

## Not verified

- **A timeout with the app still alive and posting the end itself.** The timeout was covered only by an end
  scheduled ahead (tested with the app killed, which is the harder case). The app's own end post while alive is
  the same call as the end posts in the 8 of 8 run. Why: not run as its own case.
- **The first lock test's screen state.** Only the second lock test had a screenshot of the black screen.
- **Cellular data.** The phone has no SIM service, so no cellular effect was seen.
- **The real Install Switch body** (Connect VPN, Set Cellular Data, Set VPN) in an automation with a failing step.
  The stand-in was Toggle appearance. Why: the real actions were not put in the automation.
- **Focus beyond Do Not Disturb.** Focus filters, a Focus that hides iFizBox, and Focus with the lock together.
  Why: only Do Not Disturb was set.
- **The trigger key in an exported .shortcut.** Why: no export from the phone (iCloud needed).
- **The throttle after an erroring run.** Its window is not known, and whether a slow run that does not error
  matters was not tried. Why: not measured in this run.
- **First-run "Allow" for the real actions.** The stand-in actions asked nothing. Why: not run with the real ones.
- **iOS 16 to 26.** No trigger there; not run. Why: this build is on iOS 27 only.
- **An iCloud-signed phone.** Only a phone without iCloud was measured, so export may differ there.
- **An automation made by import.** Why: only the by-hand set-up was tried.

## Follow-ups

Filed: a note on F396 (the build), and the research tasks R81 and R82.

- **Build note on F396 (Install Switch Notification automation):**
  - The body must not be able to error.
  - The editor flow has no Run Immediately choice.
  - Filter by title, so start and end are one automation.
  - The app schedules the timeout end at the start and cancels it when the real end is posted.
  - Do not remove a notification in its first 2 s.
  - Also restore at the next launch.
- **R81, research:** the export key for a signed .shortcut, by Taildrop from the share sheet or an iCloud sign-in on the
  phone, or by reading the iOS 27 Shortcuts code. The phone's Tailscale node was offline, last seen a day earlier.
- **R82, research:** the throttle after an erroring run, its window and whether a slow run that does not error matters.
