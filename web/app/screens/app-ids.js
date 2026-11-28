// F463d: the Free Apple ID page's App IDs list (the account's, from Apple, with the day each expires), and the app
// forgetting the recorded apps that were deleted from the phone (screens/free-apple-id.js's Ready).
//
//   appIdRows(appIds, now)                  pure: Apple's list as rows [{ label, subtitle, detail }], first to expire first
//   appIdsSection(state, now)               pure: the group for { signedOut | error | appIds (none yet: loading) }
//   appIdsGroup({ session, now, onSignedOut })
//                                           the group, filled once Apple answers. `session`: { portal, teamId } or null
//                                           (Apple's list needs the sign-in); `onSignedOut`: Apple ended the session
//   await forgetDeletedApps({ native, busy })  the bundle IDs forgotten. The phone's apps are signing.phoneApps's
//                                           (installation_proxy); nothing goes while a task runs or on no list
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, el } from "../nav/ui.js";
import { appIdExpired, forgetDeleted } from "../core/freeroute.js";

export const APP_IDS_HEADER = "App IDs";
export const APP_IDS_FOOTER = "The date is when each one expires. A free Apple ID can make 10 a week.";
export const APP_IDS_SIGNED_OUT = "Tap Sign In Again below to see them.";

export function appIdRows(appIds = [], now = new Date()) {
  const when = (a) => {
    const t = new Date(a?.expirationDate ?? NaN).getTime();
    return Number.isNaN(t) ? Infinity : t;
  };
  return [...appIds].sort((a, b) => when(a) - when(b)).map((a) => ({
    label: a.name || a.identifier,
    subtitle: a.identifier,
    detail: appIdExpired(a, now) ? "Expired" : when(a) === Infinity ? "?" : new Date(when(a)).toISOString().slice(0, 10),
  }));
}

const section = (rows, footer) => ({ header: APP_IDS_HEADER, rows, footer });

export function appIdsSection(state, now = new Date()) {
  if (state.signedOut) return section([{ label: "Not Signed In" }], APP_IDS_SIGNED_OUT);
  if (state.error) return section([{ label: "Couldn't Load" }], state.error);
  if (!state.appIds) return section([{ label: "Loading…" }], null);
  if (!state.appIds.length) return section([{ label: "None Yet" }], null);
  return section(appIdRows(state.appIds, now), APP_IDS_FOOTER);
}

export function appIdsGroup({ session, now, onSignedOut = () => {} } = {}) {
  const box = el("div", "free-appids");
  const draw = (state) => box.replaceChildren(grouped([appIdsSection(state, now)]));
  if (!session) { draw({ signedOut: true }); return box; }
  draw({});
  session.portal.listAppIds(session.teamId).then(
    ({ appIds }) => draw({ appIds }),
    (e) => {
      if (e?.kind === "session") { draw({ signedOut: true }); onSignedOut(); }
      else draw({ error: e?.message ?? String(e) });
    });
  return box;
}

// Never throws: without a pairing or the VPN the apps stay listed, and a later visit asks again.
export async function forgetDeletedApps({ native, busy = defaultBusy } = {}) {
  const gone = [];
  try {
    const records = (await native.call("signing.installed", {}))?.apps ?? [];
    if (!records.length || await busy()) return gone;
    const phone = (await native.call("signing.phoneApps", {}))?.apps;
    // asked again: the list takes a moment, and an app installed meanwhile isn't on it
    for (const r of forgetDeleted(records, phone, { busy: !!(await busy()) }).forgotten) {
      if (await busy()) break;
      await native.call("signing.forget", { bundleId: r.bundleId });
      gone.push(r.bundleId);
    }
  } catch (e) { // not paired, no VPN, or the jailbreak app (signing.* is refused there)
    console.warn(`Deleted apps not forgotten: ${e?.message ?? e}`);
  }
  return gone;
}

async function defaultBusy() {
  const { appQueueRunning } = await import("./queue.js");
  const { runPage } = await import("./apprun.js");
  return Boolean(appQueueRunning() || runPage()?.busy);
}
