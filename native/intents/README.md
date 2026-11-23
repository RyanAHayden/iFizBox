# native/intents/: App Intents

iFizBox's actions for Shortcuts, Siri, Spotlight and the Action button, with nothing built by hand. How to use them:
`docs/shortcuts.md`. The widget and the Control Center controls are in `../widget/`.

| intent | modes | does | returns |
|---|---|---|---|
| Check for Updates | both | jailbreak: `ifizbox-helper update`, then installed (dpkg status) vs the newest in apt's lists, holds left out; sideload: the apps Install remembered against their sources | one line per update (`Name 1.0 → 1.1`), dialog "3 Updates: …" |
| Add Source (URL) | both | opens iFizBox (`openAppWhenRun`) and hands the page `ifizbox://add?url=…`: the Add Source alert, filled in | – |
| Restore My Packages (file) | both | opens iFizBox; jailbreak: adds the file's sources (`addsource`), `update`, installs what isn't installed and some source has (`apply`, newest versions), holds; sideload: its sources as a `ifizbox://import` link (Import's review alert) | dialog with what happened |
| Install All Updates | jailbreak | the check, then `apply` of every upgrade (pulls new dependencies in, unlike `upgrade`) | the installed `Name version` lines; dialog says "Respring to finish" on `finish:` |
| Respring | jailbreak | `ifizbox-helper respring` | – |
| Userspace Reboot | jailbreak | `ifizbox-helper userspace-reboot` (`launchctl reboot userspace`) | – |
| Export My Packages | jailbreak | sources (sources.list, `*.list`, `*.sources`), packages not Auto-Installed (apt's extended_states), holds | a JSON file, `ifizbox-backup` version 1 |
| Connect VPN | sideload | the Install Switch's action: connects the built-in VPN for a queue of installs (`LocalVPN.tripConnect`); an error ends the run | – |
| Open for Install | sideload | the Install Switch's action: opens iFizBox (`openAppWhenRun`) so the install goes on (`LocalVPN.tripOpened`) | – |
| Wait for Install | sideload | the Install Switch's action: returns at once when the queue is over, else after 20 s (`LocalVPN.tripWaiting`) | – |

- `Core.swift`: what each does, Foundation only, tested on Linux (`test_intents.py` builds `tests/main.swift` with it
  and `../sign/Updates.swift`, against `../fake/ifizbox-helper`). Also `WidgetShare`, the App Group snapshot the widget
  reads. `IntentHost` is the phone (helper, files under the prefix, sideload update fetch).
- `App/InstallSwitch.swift`: the three Install Switch actions above, `@available(iOS 16)`, in the sideload IPA's metadata
  only. What they do is `../sideload/vpn/App/LocalVPN.swift`'s. They return nothing, so the Shortcut's last action
  has no output for iOS to ask about. Shortcuts runs them, not the page; `tools/shortcuts/install-switch.plist` uses them.
- `App/Intents.swift`: the `AppIntent` structs and the `AppShortcutsProvider`, `@available(iOS 16)`; `App/Host.swift`:
  `PhoneHost` (spawns the real helper through `../helper/spawn.c`; the widget builds it too); `App/WidgetStore.swift`:
  writes the count for the widget (also from the page's `app.badge`). Intents.swift imports neither UIKit nor
  WidgetKit: with AppIntents in one file they pull in a strongly linked cross-import overlay.
- AppIntents is weak-linked (`-weak_framework AppIntents`) so iFizBox still launches on iOS 15; `build.sh` fails if
  objdump shows it, or an `_AppIntents_*` overlay, linked strongly.

## Metadata without Xcode

iOS reads an app's intents from `iFizBox.app/Metadata.appintents/` (`extract.actionsdata`, `version.json`), which
Xcode's macOS-only `appintentsmetadataprocessor` writes. On Linux: `build.sh` compiles with
`-emit-const-values-path build/iFizBox.swiftconstvalues` and `-const-gather-protocols-file intents/protocols.json`
(the swift.org toolchain has both), and `metadata.py build` turns that JSON into the two files. The sideload IPA gets
`--only CheckForUpdatesIntent,AddSourceIntent,RestorePackagesIntent,ConnectVPNIntent,OpenForInstallIntent,WaitForInstallIntent`
(`build.sh` `SIDELOAD_INTENTS`), so the jailbreak-only intents and their App Shortcuts never show there, and the jailbreak
app gets `JAILBREAK_INTENTS` (no Install Switch action); `mkipa.py check` refuses an IPA with another set.

The format follows Xcode's own output: sweetpad's capture from Xcode 27B52 (`fixtures/`, MIT; `test_intents.py`
checks byte-for-byte equality after sorting) and the llios sample from Xcode 17F113
(https://github.com/qyang-nj/llios, `building/app_intents/`, no licence, so not copied here; it matches too,
checked by hand). Two choices worth knowing:

- `outputFlags`: ProvidesDialog is 4 (llios' dialog-only intent), ShowsSnippetView 2 (sweetpad's dialog + snippet
  is 6). sweetpad's own writer has them the other way round, without a capture of dialog alone.
- `generator` says `xcode-tools` 27B52 and `version.json` `toolsVersion` 27B52, as Xcode writes, in case iOS looks.
- No `nlu/` or `root.ssu.yaml` (Xcode's `appintentsnltrainingprocessor`): Bazel's builds ship without them too. Siri
  phrases may then match less well than Xcode builds'; Shortcuts and Spotlight don't use them.

`metadata.py` refuses anything it doesn't write (entities, enums, queries, parameter defaults, explicit
`supportedModes`, more than 10 App Shortcuts) rather than writing something iOS would skip silently.
