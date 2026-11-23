// ---- Settings > Installation's route (core/installroute.js) -----------------------------------------------------
// The bridge params one install adds for the chosen route: { route: "idevice" } (This iPhone: paired, with the
// built-in VPN), {} (the Signing Server), or null when the install was cancelled. When This iPhone can't be used, an
// alert says the install goes through the server. A run of installs (the IPA queue, Re-sign All) asks once: the answer
// holds for ROUTE_HOLD ms.
export const ROUTE_HOLD = 60_000;
let heldRoute = null;
export async function chooseRoute({ native, alert = showAlert, storage = storageOf(), now = Date.now } = {}) {
  const choice = storedRoute(storage);
  if (choice !== "iphone") return {};
  if (heldRoute && now() - heldRoute.at < ROUTE_HOLD) return heldRoute.params;
  let status = null;
  try { status = await bridge(native).call("idevice.status", {}); } catch { status = null; }
  const d = decideRoute(choice, status);
  if (d.alert) {
    const a = ROUTE_ALERTS[d.alert];
    const { index } = await alert({ title: a.title, message: a.message, buttons: a.buttons, cancel: 0 });
    // F372: on cellular without the Cellular Shortcuts: Set Up opens their page and this install stops; Use Server
    // goes on through the Signing Server (no way on through This iPhone: it always fails there)
    if (a.setup != null) {
      if (index === a.setup) { heldRoute = null; openRoute(["installation", "shortcuts"]); return null; }
      const params = routeParams(a.goes ? d : { route: "server" }); // F394: goes on without the Install Switch
      heldRoute = { at: now(), params };
      return params;
    }
  }
  const params = routeParams(d);
  heldRoute = { at: now(), params };
  return params;
}
export const forgetRoute = () => { heldRoute = null; };

// B316: a This iPhone install that failed to reach the phone, worded by core routeFailureOf with idevice.status read
// now and remembered, so Installation & Signing and Home show the broken state until a check passes. Other failures keep deviceError's words.
export async function routeWords(err, why, native) {
  let st = null;
  try { st = await bridge(native).call("idevice.status", {}); } catch { st = null; }
  const f = routeFailureOf(err, st);
  if (!f) return why;
  rememberRouteFailure(f);
  return { ...why, title: f.title, message: f.message, fix: f.fix, button: f.button };
}
// The fix button of a failure's alert: Pairing, the main page's Check Connection, or the Install Switch's page.
export function runFix(fix, { go = openRoute } = {}) {
  if (fix === "pair") return go(["installation", "pair"]);
  if (fix === "check") return go(["installation"]);
  if (fix === "shortcuts") return go(["installation", "shortcuts"]); // F372: Cellular Shortcuts
  return undefined;
}
import { showBanner } from "../nav/banner.js";
import { phaseLabel, deviceError, rateText } from "../core/signing.js"; // rateText: B262
import { IFIZBOX_ID } from "../core/websign.js";
import { withKeep } from "../core/keepid.js";
import { progressHUD, RESTART_BY_HAND, RETURN_LABEL, lockSelfUpdate, WAITING_LABEL } from "../nav/progress.js";
import { recordSelfUpdate } from "../core/selfupdate.js";
import { showAlert } from "../nav/alert.js";
import { NAME } from "../brand.js";
import { storedRoute, decideRoute, ALERTS as ROUTE_ALERTS, routeParams } from "../core/installroute.js";
import { routeFailureOf, rememberRouteFailure, clearRouteFailure } from "../core/installroute.js"; // B316
import { SELF_RESTART } from "../core/apprun.js";
import { KNOWN_MALWARE, askInsecure, bridge, failed, keepIpaHash, refusing, stopNative, storageOf,
  untilCancel } from "./common.js";
import { getServer, defaultServer } from "./identity.js";
import { serverFallback, switchFailedAlert, USE_SERVER, USE_SERVER_LINE } from "../core/installroute.js"; // F366
import { isSelfIpa, finishHere, hereLabel, shownName } from "./common.js";
import { lastDevice, openRoute } from "./device.js";
import { followHereSelf, followSelfUpdate } from "./selfupdate.js";

// Signs `url` (an IPA) on the phone and opens the install link: true once iOS was asked to install; false after an
// error, which an alert explains (no_server and no_identity then open Settings > Signing).
// F68: `params` replaces { url } with the look-first sheet's { token, name?, bundleId?, icon?, removeExtensions? }
// (core/signing.js installParams); `after(result, h)` runs with the HUD still up once iOS has the link (the sheet
// follows iOS's own progress there) and hides it itself.
let installing = false; // one install at a time: a second tap (or a doubled handler) while one runs is dropped
export async function installOnDevice(opts, deps) {
  if (installing) return false;
  installing = true;
  // B252: the app keeps running in the background from Confirm on (the route check, then the signing), not only
  // once the IPA downloads or copies; signing.install holds it too while it runs, so this ends with the call
  const keep = deps?.keep ?? holdApp;
  keep(deps?.native, true);
  try { return await installOnDeviceOnce(opts, deps); } finally { installing = false; keep(deps?.native, false); }
}

// B252: signing.hold {on} (Sideload.hold): KeepAlive for the page's install, from Confirm until it ends. Not waited
// for; an older shell without the call refuses it and the install goes on as before.
export function holdApp(native, on) {
  try { Promise.resolve(bridge(native).call("signing.hold", { on })).catch(() => {}); } catch { /* no bridge */ }
}

// F366: the failed install again through the default Signing Server, once (the alert's button or the log's line).
// `inline`: from inside the failed install (its alert), which still holds installOnDevice's one-at-a-time.
function serverRetry(opts, deps) {
  let used = false;
  return {
    run({ inline = false } = {}) {
      if (used) return Promise.resolve(false);
      used = true;
      const o = { ...opts, server: true };
      return inline ? installOnDeviceOnce(o, deps) : installOnDevice(o, deps);
    },
  };
}

// F400: `listed` ({ version, size }, core/appqueue.js listedOf): what the source lists for `url`; the shell uses an IPA
// it kept from a failed install of that url only when it still matches
async function installOnDeviceOnce({ url, name = "", onInstalled = () => {}, params = null, after = null, host = false, server = false, listed = null },
  { native, hud = progressHUD, alert = showAlert, go = openRoute, later = setTimeout, follow = null } = {}) {
  forgetRoute();
  // F366: `server`: this install goes through the default Signing Server whatever Install Apps With says
  const route = server ? {} : await chooseRoute({ native, alert });
  if (!route) return false;
  const manifestServer = server ? defaultServer() : getServer();
  // This iPhone: installd puts the app (iFizBox too) in place itself, so no Signing Server and no hosting.
  const self = isSelfIpa(url) || host; // iFizBox itself, whichever route
  if (route.route) host = false;
  const h = hud("Downloading");
  h.onCancel?.(() => stopNative(native));
  let lastHere = null;
  let rate = 0; // B262
  let result;
  try {
    // manifestServer: the signing server hands iOS the manifest while iFizBox serves the IPA over plain HTTP at
    // 127.0.0.1 (nothing to set up on the phone; the server sees only the app's ID, version and name).
    result = await untilCancel(h, askInsecure((extra) => bridge(native).call("signing.install", { ...withKeep(params ?? { url }), ...(listed ? { listed } : {}), manifestServer, ...refusing(), ...(host ? { host: true } : {}), ...route, ...extra }, (ev) => {
      if (ev?.log) h.page?.raw?.(ev.log); // the shell's console lines (Sideload.swift install's log)
      // B111: This iPhone: the copy's and installd's own percents ({here}), not the overall "Installing on this iPhone"
      const here = route.route ? hereLabel(ev) : null;
      if (here) {
        if (ev.here !== lastHere) {
          lastHere = ev.here;
          if (ev.here === "installing" && self) h.page?.step?.(SELF_RESTART);
        }
        h.set(here.label);
        return;
      }
      if (route.route && lastHere && ev?.phase === "here") return; // a newer shell sends both: {here} wins
      const t = phaseLabel(ev);
      // B262: the download's last MB/s (the shell's once-a-second {rate}) stays on the label between its ticks
      if (ev?.phase === "downloading" && ev.rate != null) rate = Number(ev.rate) || 0;
      if (t) h.set(ev?.phase === "downloading" && rate > 0 ? `${t}, ${rateText(rate)}` : t);
    }), { alert, url: params ? null : url }));
  } catch (e) {
    if (h.cancelled) return false;
    if (e?.code === "cancelled") { h.hide(); return false; } // B104: Cancel on This Download Is Not Secure
    let why = deviceError(e, name);
    if (route.route) why = await routeWords(e, why, native); // B316: the route's own words; kept until a check passes
    failed(h, why.message);
    const fix = why.fix && why.button ? why : null;
    // F366: This iPhone couldn't be reached: the Signing Server for this install, besides the fix (alert and log)
    const fallback = serverFallback(e, route) ? serverRetry({ url, name, onInstalled, params, after, host, ...(listed ? { listed } : {}) }, { native, hud, alert, go, later, follow }) : null;
    if (fallback) h.page?.help?.(USE_SERVER_LINE, { label: USE_SERVER, action: () => { fallback.run(); } });
    const buttons = [...(fix ? ["OK", fix.button] : ["OK"]), ...(fallback ? [USE_SERVER] : [])];
    if (e?.code === "switch_failed" && fix && fallback) { // B395: one plain alert
      const { index } = await alert(switchFailedAlert(fix)) || {};
      if (index === 1) runFix(fix.fix, { go });
      if (index === 2) return fallback.run({ inline: true });
      return false;
    }
    const { index } = await alert({ title: e?.code === "malware" ? KNOWN_MALWARE : why.title, message: why.message, buttons, ...(buttons.length > 1 ? { cancel: 0 } : {}) }) || {};
    if (why.open === "signing") go(["signing"]);
    if (fix && index === 1) runFix(fix.fix, { go });
    if (fallback && index === buttons.length - 1) return fallback.run({ inline: true });
    return false;
  }
  if (route.route) clearRouteFailure(); // B316: an install went through: the route works
  keepIpaHash(storageOf(), result, { bundleId: params?.bundleId ?? null }); // F292
  if (h.cancelled) return false;
  if (route.route && !self && result?.bundleId !== IFIZBOX_ID) {
    // B111: This iPhone answers once installd has the app: no iOS prompt to follow, so Installed and Open <app>
    onInstalled(result);
    finishHere(h, result, { native, name, later });
    return true;
  }
  if (route.route) {
    // B123: This iPhone, iFizBox itself: installd ends iFizBox while it installs over it, so an answer means it
    // didn't. The new version is in place: say to close it by hand (no locked "Closing" that never closes)
    onInstalled(result);
    if (typeof h.finish === "function") {
      // B159: unless the shell answered because installd stood waiting for it, and is closing itself now
      if (await followHereSelf(h, { native, later })) return true;
      h.page?.step?.(RESTART_BY_HAND);
      h.finish({ label: RETURN_LABEL, status: "Installed" });
    } else later(() => (h.done ? h.done("Done") : h.hide()), 1200);
    return true;
  }
  h.set("Installing");
  onInstalled(result);
  // iFizBox itself (host): iOS's Install prompt is up, and iFizBox closes once it's answered so the install finishes
  // (native CloseForUpdate): say so first (user 2026-11-18).
  if (host) showBanner({ title: NAME, message: `Press Install and keep ${NAME} open: it closes by itself once iOS has downloaded the new version. Open it again once the new icon appears.`, wait: true });
  if (after) { after(result, h); return true; }
  // F169: a plain Install ends through followInstall (signing-sheet.js): Done once iOS has the link (user 2026-11-18).
  // Not for iFizBox itself (host, or its own IPA or ID): iOS closes iFizBox while it installs over it.
  if (result?.bundleId && !host && !isSelfIpa(url) && result.bundleId !== IFIZBOX_ID) {
    const followInstall = follow ?? (await import("../signing-sheet.js")).followInstall;
    // B150: the caller's name (the source's, as the app was picked) before the IPA's own
    followInstall(bridge(native), result.bundleId, h, { later, name: shownName(name, result), device: result.device ?? lastDevice });
    return true;
  }
  // B49: iFizBox itself: the page ends locked on "Closing iFizBox" (no Close to tap) until iOS closes the app.
  // B83: the shell closes it only once iOS has the whole IPA; the page follows that, and offers Try Again if iOS
  // never took it. The version is kept so the next launch can tell it didn't land.
  if (host || isSelfIpa(url) || result?.bundleId === IFIZBOX_ID) {
    if (host) recordSelfUpdate(storageOf(), result?.version);
    // B123: hosted, "Waiting for iOS" until the shell says it is closing
    lockSelfUpdate(h, { later, ...(host ? { label: WAITING_LABEL } : {}) });
    if (host) followSelfUpdate(h, { native, waiting: true, later, retry: () => installOnDevice({ url, name, onInstalled, params, after, host, ...(listed ? { listed } : {}) }, { native, hud, alert, go, later, follow }) });
    return true;
  }
  // iOS asks "Install …?" over the app: the progress page ends on Done (signed and handed to iOS), Return under it.
  later(() => (h.done ? h.done("Done") : h.hide()), 1200);
  return true;
}
