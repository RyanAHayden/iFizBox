// F415: iOS checks a new or regenerated provisioning profile online on an app's first launch; with no network then (or
// one changing) it shows "Unable to Verify App" (R96). No app can run that check ahead, so every signed install's end
// says what to do, as a grey line (nav/progress.js page.help, no button).
// SPDX-License-Identifier: GPL-3.0-or-later
import { helperRow, isSelf } from "./apprun.js";

export const FIRST_LAUNCH_HINT = "If the first launch says Unable to Verify App, turn Airplane Mode off, make sure you're online, tap Cancel and open the app again.";

// An app run's hint: null unless an app signed with a profile installed (not the jailbreak's helper, which needs no
// profile, and not our own IPA, whose page closes).
export const firstLaunchHint = (rows) =>
  (rows.some((r) => r.state === "installed" && r.mode !== "remove" && !helperRow(r) && !isSelf(r)) ? FIRST_LAUNCH_HINT : null);

// The line on a progress page; a HUD without one shows nothing.
export function sayFirstLaunch(page, text = FIRST_LAUNCH_HINT) {
  if (text) page?.help?.(text, { label: "" });
}
