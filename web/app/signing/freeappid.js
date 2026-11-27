// ---- B502a1: a free Apple ID gives each app an App ID of its own ------------------------------------------------
// A free Apple ID's profile installs only the app whose bundle ID is its App ID, so before the app queue signs one, the
// App ID <bundle id>.<TEAMID> is made or reused (core/freeroute.js ensureAppId), its profile downloaded and handed to
// the shell (signing.addProfile; native/sign/FreeAppID.swift picks it when it signs). That needs Apple's session, which
// is kept in the page's memory only (screens/free-apple-id.js freeSession). Without one the sign goes ahead, and the
// shell's app_id_taken refusal shows a sign-in prompt. Loaded lazily (signing/queue.js prepareOnDevice).
//
//   await pinnedProfile(native)        { team, appId } when the shell signs with a free profile for one app, else null
//   await addAppProfile({ native, portal, teamId, bundleId, name })   -> { identifier, made }
//   await withOwnAppId(job, params, sign, { native, discard, log, alert, session, go })
//                                      `sign` (signing.prepare) with the app's profile handed in first. `discard(token)`
//                                      frees a copy signed again because the IPA's bundle ID isn't the one listed.
import { ensureAppId, freeAppId, setupError } from "../core/freeroute.js";
import { b64encode } from "../core/gsa.js";
import { format, settingsRoute } from "../router.js";

export const SIGN_IN_TITLE = "Sign In Needed";
export const SIGN_IN_MESSAGE = "A free Apple ID needs an App ID for each app. Open Use a Free Apple ID, tap Sign In Again, then install the app again.";
export const SIGN_IN_ROW = "Sign in with your free Apple ID in Settings, then install it again";

const lower = (s) => String(s ?? "").toLowerCase();
const same = (a, b) => lower(a) === lower(b);
const known = (id) => (typeof id === "string" && id && !id.startsWith("library:") ? id : null);

export async function pinnedProfile(native) {
  try {
    let st = await native.call("signing.status", {});
    if (typeof st === "string") st = JSON.parse(st);
    const p = st?.identity?.profile;
    return p?.free && !p.wildcard && p.team && p.appId ? { team: p.team, appId: p.appId } : null;
  } catch { return null; }
}

export async function addAppProfile({ native, portal, teamId, bundleId, name = null }) {
  const identifier = freeAppId(bundleId, teamId);
  const { appIds } = await portal.listAppIds(teamId);
  const { appId, made } = await ensureAppId({ portal, teamId, appIds, identifier, name: name || "App" });
  const data = (await portal.downloadProfile(teamId, appId.appIdId))?.encodedProfile;
  if (!data) throw new Error("Apple sent no profile.");
  await native.call("signing.addProfile", { profile: b64encode(new Uint8Array(data)) });
  return { identifier, made };
}

const liveSession = async () => {
  const m = await import("../screens/free-apple-id.js");
  const s = m.freeSession();
  return s ? { ...s, end: m.endFreeSession } : null;
};

const openSigning = () => { location.hash = format(settingsRoute(["signing"])).replace(/^#/, ""); };

// One prompt at a time, and never waited for: the run's other rows go on.
let asking = false;
function askSignIn(alert, go) {
  if (asking || !alert) return;
  asking = true;
  Promise.resolve(alert({ title: SIGN_IN_TITLE, message: SIGN_IN_MESSAGE, buttons: ["Cancel", "Open"], cancel: 0 }))
    .then((r) => { if (r?.index === 1) go(); }, () => {})
    .finally(() => { asking = false; });
}

// An app installed under the held profile's App ID stays there (FreeAppID.profile): no App ID is spent on it.
async function staysOnHeld(native, held, original) {
  try {
    const apps = (await native.call("signing.installed", {}))?.apps ?? [];
    return apps.some((a) => same(a.bundleId, held.appId) && same(a.originalBundleId, original));
  } catch { return false; }
}

export async function withOwnAppId(job, params, sign, { native, discard = () => {}, log = () => {}, alert = null,
  session = liveSession, go = openSigning } = {}) {
  // With no session nothing is asked of the shell first: only its refusal (a free profile's alone) matters.
  const held = native?.call && await session() ? await pinnedProfile(native) : null;
  let failure = null; // why no profile could be handed in: the reason of a refusal that follows
  const live = async () => {
    const s = await session();
    return s && s.teamId === held?.team ? s : null;
  };
  const give = async (bundleId, original) => {
    const s = await live();
    if (!s) return false;
    if (!same(freeAppId(bundleId, held.team), held.appId) && await staysOnHeld(native, held, original)) return false;
    try {
      const r = await addAppProfile({ native, portal: s.portal, teamId: held.team, bundleId, name: job?.name });
      log(`${r.made ? "Made" : "Using"} the App ID ${r.identifier}`);
      return true;
    } catch (e) {
      if (e?.kind === "session") s.end?.();
      else failure = e;
      log(`No App ID of its own: ${e?.message ?? e}`);
      return false;
    }
  };

  const typed = known(params?.bundleId);
  const listed = typed || known(job?.id);
  // A Re-sign from the record keeps the installed bundle ID: only an app under an App ID of this team has one to renew.
  const resign = Boolean(params?.record);
  if (held && listed && (!resign || same(freeAppId(listed, held.team), listed))) await give(listed, known(job?.id) ?? listed);

  let r;
  try {
    r = await sign();
  } catch (e) {
    if (e?.code !== "app_id_taken") throw e;
    if (failure) throw Object.assign(new Error(setupError(failure).message), { code: e.code });
    if (await live()) throw e;
    askSignIn(alert, go);
    throw Object.assign(new Error(SIGN_IN_ROW), { code: e.code });
  }
  // The IPA's own bundle ID isn't the one listed: its App ID, then signed again.
  const real = known(r?.originalBundleId);
  if (held && !typed && !resign && real) {
    const want = freeAppId(real, held.team);
    if (!same(want, freeAppId(listed ?? "", held.team)) && !same(r.bundleId, want) && await give(real, real)) {
      discard(r.token);
      r = await sign();
    }
  }
  return r;
}
