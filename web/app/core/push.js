// F280: push notifications in the sideload app (docs/push.md). The shell gets the APNs device token
// (native/Sources/Notifications.swift push.*), this sends it with what the background check follows (app-updates.js
// shellWatch: the apps, their sources and versions, iFizBox itself) to the signing server's /api/push
// (worker/src/push.js), which checks those sources on a schedule and pushes. The local background check keeps running
// either way; push only makes the alert come sooner.
//
// Push can't work (offReason; Settings then shows no Push switch), when:
//   - this iFizBox runs under another bundle ID than brand.js BUNDLE_ID: APNs delivers by the app's Info.plist ID,
//     and the server's key reaches only that topic (a signer renamed this copy: install again keeping the ID);
//   - its provisioning profile has no aps-environment (its App ID has no Push Notifications);
//   - notifications are off for iFizBox in iOS Settings, or iOS gave no token;
//   - the server has no APNs key (a self-hosted Worker without its own: worker/README.md) or no database.
//
//   pushState(storage) / savePushState(storage, s)   {on, token, sent, lastError} in localStorage (PUSH_KEY)
//   offReason(st, server)                 {code, text} | null: st = push.status (+ token), server = GET /api/push
//   registration(st, watch)               the /api/push/register body
//   expiresOf(st)                         iFizBox's own signature end, as `expires`
//   await enablePush(deps) / disablePush(deps) / syncPush(deps) / pushInfo(deps)
//   await autoEnablePush(deps)            on by default: at launch, once the server can push, asking iOS if never
//                                         asked (not after an Off or a denied prompt)
//   pushRows(view, now)                   Settings > Updates > Push Notifications' rows (screens/push-settings.js)
// deps: { native (ifizboxNative), server (the signing server, signing-client.js getServer), fetcher, storage, watch }.
// Device tokens and watch lists go only to that server, never to a log.
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME, BUNDLE_ID } from "../brand.js";
import { nativeBridge } from "../native.js";
import { KEYS } from "./storagekeys.js";

export const PUSH_KEY = KEYS.push;
export const WATCH_KEY = KEYS.pushWatch; // the last watch app-updates.js built, for enablePush

export function pushState(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem?.(PUSH_KEY) ?? "null");
    if (v && typeof v === "object") return { on: v.on === true, token: typeof v.token === "string" ? v.token : null,
      sent: typeof v.sent === "string" ? v.sent : null, lastError: typeof v.lastError === "string" ? v.lastError : null };
  } catch { /* unreadable: off */ }
  return { on: false, token: null, sent: null, lastError: null };
}
export function savePushState(storage = globalThis.localStorage, s) {
  try { storage?.setItem?.(PUSH_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
export function rememberWatch(watch, storage = globalThis.localStorage) {
  try { storage?.setItem?.(WATCH_KEY, JSON.stringify({ apps: watch?.apps ?? [], known: watch?.known ?? [],
    ...(Array.isArray(watch?.counted) ? { counted: watch.counted } : {}) })); } catch { /* full */ }
}
export function storedWatch(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage?.getItem?.(WATCH_KEY) ?? "null"); if (v && Array.isArray(v.apps)) return v; } catch { /* none */ }
  return { apps: [], known: [] };
}

export const RENAMED_TEXT = (id) => `This ${NAME} runs as ${id}: its signer gave it another bundle ID, and push `
  + `notifications reach only ${BUNDLE_ID}. Install ${NAME} again with Keep Bundle IDs on (the default): the new copy `
  + `keeps ${BUNDLE_ID} and installs beside this one, so delete this one afterwards (touch and hold its icon > Remove App).`;
export const NO_APS_TEXT = `This ${NAME}'s provisioning profile has no Push Notifications (aps-environment). Sign `
  + `${NAME} with a profile whose App ID has Push, such as RSideload's or SideDrop's, and turn Push on again.`;
export const DENIED_TEXT = `Notifications are off for ${NAME} in iOS Settings, so iOS gives it no push token.`;
export const NO_KEY_TEXT = (host) => `${host} has no APNs key, so it can't send push notifications. A server you run `
  + `yourself needs its own key (worker/README.md).`;
export const FALLBACK_TEXT = "Update alerts still come from the background check, when iOS runs it.";

const hostOf = (server) => { try { return new URL(server).host; } catch { return "The signing server"; } };

// Why push can't work, or null. `st`: push.status (mode, bundleId, environment, authorization); `server`: GET
// /api/push ({enabled, reason, topics}) or null when it couldn't be asked.
export function offReason(st, server = null, serverUrl = "") {
  if (!st) return { code: "no_app", text: `Push notifications need the ${NAME} app.` };
  if (st.mode && st.mode !== "sideload") return { code: "jailbreak", text: "The jailbreak build's alerts come from its own daemon." };
  const topics = server?.topics?.length ? server.topics : [BUNDLE_ID];
  if (st.bundleId && !topics.includes(st.bundleId)) return { code: "renamed", text: RENAMED_TEXT(st.bundleId) };
  if (!st.environment) return { code: "no_aps", text: NO_APS_TEXT };
  if (st.authorization === "denied") return { code: "denied", text: DENIED_TEXT };
  if (server && server.enabled === false) {
    return server.reason === "no_database"
      ? { code: "no_database", text: `${hostOf(serverUrl)} keeps no push database, so it can't send push notifications.` }
      : { code: "no_key", text: NO_KEY_TEXT(hostOf(serverUrl)) };
  }
  return null;
}

export function expiresOf(st) {
  const at = Date.parse(st?.profileExpires ?? "");
  return Number.isFinite(at) ? [{ id: BUNDLE_ID, name: NAME, at: new Date(at).toISOString() }] : [];
}

export function registration(st, watch = { apps: [], known: [] }) {
  return { token: st.token, environment: st.environment, topic: st.bundleId, team: st.team ?? "", version: st.version ?? "",
    ios: st.ios ?? "", apps: (watch.apps ?? []).map(({ id, name, version, source }) => ({ id, name, version, source })),
    known: watch.known ?? [], ...(Array.isArray(watch.counted) ? { counted: watch.counted } : {}), expires: expiresOf(st) };
}

const errorOf = async (r) => {
  try { const j = await r.json(); return j?.error || `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; }
};
async function post(server, path, body, fetcher) {
  const r = await fetcher(`${server}/api/push/${path}`, { method: "POST", cache: "no-store", credentials: "omit",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(await errorOf(r)), { status: r.status });
  return r.json();
}
export async function serverInfo(server, fetcher = globalThis.fetch) {
  try {
    const r = await fetcher(`${server}/api/push`, { cache: "no-store", credentials: "omit" });
    if (r.status === 404) return { enabled: false, reason: "no_key", topics: [BUNDLE_ID] }; // an older server
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const defaults = (d = {}) => ({ native: nativeBridge(), fetcher: globalThis.fetch?.bind(globalThis),
  storage: globalThis.localStorage, ...d });

// Push on: iOS's permission (asked once), the token, then the server. -> {ok, reason?: {code, text}}.
export async function enablePush(deps = {}) {
  const { native, server, fetcher, storage } = defaults(deps);
  const watch = deps.watch ?? storedWatch(storage);
  const fail = (reason) => { savePushState(storage, { ...pushState(storage), on: true, lastError: reason.text }); return { ok: false, reason }; };
  const st0 = await native.call("push.status", {});
  const info = await serverInfo(server, fetcher);
  const pre = offReason(st0, info, server);
  if (pre) return fail(pre);
  let st;
  try { st = { ...st0, ...(await native.call("push.register", {})) }; } catch (e) {
    const denied = /denied/.test(String(e?.code ?? e?.message ?? e));
    return fail(denied ? { code: "denied", text: DENIED_TEXT } : { code: "no_token", text: `iOS gave no push token: ${e?.message ?? e}` });
  }
  if (!st.token) return fail({ code: "no_token", text: "iOS gave no push token." });
  const body = registration(st, watch);
  try { await post(server, "register", body, fetcher); } catch (e) {
    return fail({ code: "server", text: `${hostOf(server)} refused the push registration: ${e.message}` });
  }
  savePushState(storage, { on: true, token: st.token, sent: JSON.stringify(body), lastError: null });
  handOver(native, server, body); // B264
  return { ok: true };
}

// F285: Push is on by default. At launch, once the server says it can push (enabled) and nothing here blocks it
// (offReason null, iOS notifications already allowed: no permission prompt at launch), Push turns itself on, unless
// the user turned it off themselves (userTurnedOff, remembered by the switch) or it's on already. While the server has
// no key it stays off, and turns on by itself the first launch after the key is there. -> {enabled, reason?}.
export const USER_OFF_KEY = KEYS.pushUserOff;
export function userTurnedOff(storage = globalThis.localStorage) {
  try { return storage?.getItem?.(USER_OFF_KEY) === "1"; } catch { return false; }
}
export function setUserTurnedOff(off, storage = globalThis.localStorage) {
  try { if (off) storage?.setItem?.(USER_OFF_KEY, "1"); else storage?.removeItem?.(USER_OFF_KEY); } catch { /* private mode */ }
}
// notDetermined: push.register asks iOS once; a No leaves Push off (denied, never asked again)
const ALLOWED = ["authorized", "provisional", "notDetermined"];
export async function autoEnablePush(deps = {}) {
  const { native, server, fetcher, storage } = defaults(deps);
  if (!native?.call || !server || pushState(storage).on || userTurnedOff(storage)) return { enabled: false };
  let st;
  try { st = await native.call("push.status", {}); } catch { return { enabled: false }; } // an older shell
  if (!ALLOWED.includes(st?.authorization)) return { enabled: false };
  const info = await serverInfo(server, fetcher);
  if (info?.enabled !== true || offReason(st, info, server)) return { enabled: false };
  const before = pushState(storage);
  const r = await enablePush(deps);
  if (r.ok) return { enabled: true };
  savePushState(storage, before); // failed quietly: still off, tried again next launch
  return { enabled: false, reason: r.reason };
}

// Push off: the server forgets this iPhone (token and list), iOS stops the token.
export async function disablePush(deps = {}) {
  const { native, server, fetcher, storage } = defaults(deps);
  const s = pushState(storage);
  if (s.token) { try { await post(server, "unregister", { token: s.token }, fetcher); } catch { /* the next run's 410 does it */ } }
  if (native?.call) handOver(native, server); // B264: nothing for the shell to send again
  try { await native?.call?.("push.unregister", {}); } catch { /* nothing to stop */ }
  savePushState(storage, { on: false, token: null, sent: null, lastError: null });
  return { ok: true };
}

// B264: the shell keeps what the server has (push.registered), so an update handed to iOS while this page sleeps in
// the background reaches the server's badge too (BackgroundCheck.appHandedOff sends it again with the new version).
// No body (Push off): the shell forgets it and sends nothing.
function handOver(native, server, body = null) {
  try { Promise.resolve(native.call("push.registered", body ? { server, body } : {})).catch(() => {}); } catch { /* an older shell */ }
}

// The watch list changed (app-updates.js): register again when push is on and the body differs. Never throws.
export async function syncPush(deps = {}) {
  const { native, server, fetcher, storage } = defaults(deps);
  if (deps.watch) rememberWatch(deps.watch, storage);
  const s = pushState(storage);
  if (!s.on || !native?.call) return { sent: false };
  try {
    const st = { ...(await native.call("push.status", {})), token: s.token };
    if (!st.token || offReason(st)) return { sent: false };
    const body = registration(st, deps.watch ?? storedWatch(storage));
    const json = JSON.stringify(body);
    if (json === s.sent) { handOver(native, server, body); return { sent: false }; }
    await post(server, "register", body, fetcher);
    savePushState(storage, { ...s, sent: json, lastError: null });
    handOver(native, server, body);
    return { sent: true };
  } catch { return { sent: false }; }
}

// What Settings shows: {state, st, server, status (POST /api/push/status), reason}.
export async function pushInfo(deps = {}) {
  const { native, server, fetcher, storage } = defaults(deps);
  const state = pushState(storage);
  let st = null;
  try { st = await native?.call?.("push.status", {}); } catch { st = null; }
  const info = await serverInfo(server, fetcher);
  let status = null;
  if (state.token) { try { status = await post(server, "status", { token: state.token }, fetcher); } catch { status = null; } }
  return { state, st, server: info, status, reason: offReason(st, info, server) };
}

// iFizBox's own update now keeps BUNDLE_ID when signed (websign-job.js, native SignOptions.keeps), so on a copy a
// signer renamed it installs as a second iFizBox. Said once, before the first such install:
//   await renamedUpdateNotice({ native, alert, storage }) -> "install" | "cancel"
export const RENAMED_WARNED_KEY = KEYS.pushRenamedWarned;
export async function renamedUpdateNotice({ native = nativeBridge(), alert, storage = globalThis.localStorage } = {}) {
  let id = null;
  try { id = (await native?.call?.("push.status", {}))?.bundleId ?? null; } catch { return "install"; } // an older shell
  if (!id || id === BUNDLE_ID) return "install";
  try { if (storage?.getItem?.(RENAMED_WARNED_KEY) === id) return "install"; } catch { /* ask */ }
  const { index } = await alert({ title: "Installs Beside This One",
    message: `This ${NAME} runs as ${id}. The update keeps ${NAME}'s own ID, ${BUNDLE_ID}, which push notifications need, `
      + `so iOS installs it as a second ${NAME} beside this one. Open the new one, then delete this one (touch and hold its `
      + "icon > Remove App).", buttons: ["Cancel", "Install"], cancel: 0 });
  if (index !== 1) return "cancel";
  try { storage?.setItem?.(RENAMED_WARNED_KEY, id); } catch { /* asked again next time */ }
  return "install";
}

const ago = (iso, now) => {
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return "None Yet";
  const m = Math.round((now - t) / 60000);
  return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// Settings' group: {header, rows: [{label, detail?, toggle?, on?}], footer}, or null when push can't work here
// (offReason): no switch and no explanation, the background check still alerts.
export function pushRows(view, now = Date.now()) {
  const { state, status, reason } = view ?? {};
  if (reason) return null;
  const on = Boolean(state?.on);
  const rows = [{ label: "Push", toggle: true, on }];
  let footer;
  if (on && state?.lastError) {
    footer = `${state.lastError} ${FALLBACK_TEXT}`;
  } else if (on && status && status.registered === false) {
    footer = "The server no longer knows this iPhone. Turn Push off and on again.";
  } else if (on) {
    rows.push({ label: "Last Push", detail: ago(status?.lastPush, now) });
    footer = "Alerts arrive within half an hour of an update.";
  } else {
    footer = "Push sends this iPhone's push token and the apps you follow to the signing server, which checks them every half hour.";
  }
  return { header: "Push Notifications", rows, footer };
}
