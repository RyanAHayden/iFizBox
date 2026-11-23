// ---- F235: the IPA queue's run, sign ahead and install one at a time (core/apprun.js, screens/apprun.js) --------
//
//   prepareParams(job)                 signing.prepare's params for a core/appqueue.js job: a Re-sign without a url signs
//                                      from the phone's record, a My IPAs job (`library`) from its file, a Custom Install
//                                      with its edits (always from the url: a look's token may be spent or stale)
//   await prepareOnDevice(job, { tag, signal, progress, log })   download and sign, keep the signed copy
//                                      -> { token, bundleId, name, version, expires }; progress(phase, fraction) with
//                                      phase "downloading" | "signing"; the signal's abort sends signing.cancel {tag}
//   await openPrepared(row, { tag, signal, progress, log, host, wait })   hand it to iOS (progress("asking")), then
//                                      wait for iOS's install (progress("installing", f)) -> { installed, expires,
//                                      dismissed? (B85: iOS's prompt closed and iOS never asked for the IPA) };
//                                      B146: on the prompt route installed is true or null (Sent to iOS), never false
//                                      unless dismissed; This iPhone's installd answer is passed as it is.
//                                      B200: it answers once iOS has the whole IPA ({installed: null, handedOff,
//                                      later: a promise for true | null, the watch's own end}), not when iOS finishes
//                                      again (B91): signing.reprompt instead of signing.open (the IPA is still
//                                      served), then the same wait; throws code "gone" when it isn't
//                                      host (iFizBox's own) doesn't wait: iOS closes iFizBox to install it
//   await repromptPrepared(row)        B85: iOS's Install prompt for that app again (signing.reprompt) -> true | false
//   discardPrepared(token)             frees a signed copy that won't be installed
// Errors come as deviceError's message (core/signing.js), so a row's "Failed: ..." reads as the alerts do.
import { deviceError } from "../core/signing.js";
import { withKeep } from "../core/keepid.js";
import { sourceCredit } from "../core/installed.js";
import { recordSelfUpdate } from "../core/selfupdate.js";
import { showAlert } from "../nav/alert.js";
import { askInsecure, bridge, keepIpaHash, refusing, storageOf } from "./common.js";
import { getServer, defaultServer } from "./identity.js";
import { serverFallback } from "../core/installroute.js"; // F366
import { chooseRoute, holdApp } from "./route.js";
import { withSavedIpa } from "../core/appqueue.js"; // F379
export { hereLabel, shownName, finishHere } from "./common.js";

export const ASK_WAIT = 600; // seconds the queue waits for Install on iOS's prompt before the row fails
const SENT = Symbol("sent"); // B200: openPrepared's race: iOS had the whole IPA before the watch answered

export function prepareParams(job) {
  if (!job) return null;
  if (job.mode === "resign" && !job.url && !job.library) return { record: job.id };
  const edits = { ...(job.options?.edits ?? {}) };
  delete edits.token;
  delete edits.url;
  // F237: Keep Bundle IDs off goes with the job, unless its Custom Install chose (edits.keepBundleId)
  if (job.library) return withKeep({ library: job.library, ...edits });
  const credit = sourceCredit(job); // B247: the source's app it is, kept on the shell's signed record
  return withKeep({ url: job.url, ...edits, ...(credit ? { credit } : {}) });
}

// native.call that rejects with code "cancelled" the moment `signal` aborts, after asking the shell to stop `tag`.
function abortable(native, method, params, onEvent, { tag, signal }) {
  const n = bridge(native);
  return new Promise((resolve, reject) => {
    const stop = () => {
      try { Promise.resolve(n.call("signing.cancel", { tag })).catch(() => {}); } catch { /* no bridge */ }
      reject(Object.assign(new Error("Cancelled"), { code: "cancelled" }));
    };
    if (signal?.aborted) { stop(); return; }
    signal?.addEventListener?.("abort", stop, { once: true });
    Promise.resolve(n.call(method, { ...params, tag }, onEvent)).then(resolve, reject);
  });
}

const rowError = (e, name) => {
  if (e?.code === "cancelled") return e;
  const why = deviceError(e, name);
  return Object.assign(new Error(why.message), { code: e?.code ?? null });
};

export async function prepareOnDevice(job, { tag, signal = null, progress = () => {}, log = () => {}, native, alert = showAlert } = {}) {
  job = await withSavedIpa(job, { call: (m, p) => bridge(native).call(m, p) }); // F379: a Re-sign signs the saved IPA
  let params = prepareParams(job);
  // F302a: the app's kept tweaks go with a plain install, an update and a tweak update (screens/tweaks.js), a line each
  try { params = await (await import("../screens/tweaks.js")).keptTweakParams(params, job, { log }); } catch (e) {
    throw Object.assign(new Error(`Can't inject the tweaks: ${String(e?.message ?? e)}`), { code: "tweaks" });
  }
  try {
    // B104: an http link with no https twin asks first (askInsecure); Cancel ends the row as its stop does
    const r = await askInsecure((extra) => abortable(native, "signing.prepare", { ...params, ...refusing(), ...extra }, (ev) => {
      if (ev?.log) { log(ev.log); return; }
      // B152: the signer's own phase (reading, signing) goes along, so the run gives each its share of Signing
      // B262: the download's once-a-second {bytes, total, rate} go along too, for the row's MB of MB and MB/s
      const info = ev?.phase === "downloading" && ev.bytes != null ? { bytes: ev.bytes, total: ev.total, rate: ev.rate } : null;
      if (ev?.phase) progress(ev.phase === "downloading" ? "downloading" : "signing", Number(ev.progress) || 0, ev.phase, ...(info ? [info] : []));
    }, { tag, signal }), { alert, url: params?.url ?? null });
    keepIpaHash(storageOf(), r, { bundleId: job?.bundleId ?? (typeof job?.id === "string" && !job.id.startsWith("library:") ? job.id : null), version: job?.version ?? null }); // F292
    return r;
  } catch (e) {
    // F302a: an App Store copy: remembered, so Add to App lists it under Can't Take Tweaks
    if (e?.code === "encrypted" && typeof job?.id === "string" && !job.id.startsWith("library:")) {
      import("../screens/tweaks.js").then((t) => t.markEncrypted(job.id), () => {});
    }
    throw rowError(e, job?.name || job?.id || "");
  }
}

// F366: `server`: this row goes through the default Signing Server whatever Install Apps With says (the run's Use the
// Signing Server). A This iPhone failure that offers it (core/installroute.js serverFallback) throws with `fallback`,
// the failure's { title, short, fix, button }.
export async function openPrepared(row, { tag, signal = null, progress = () => {}, log = () => {}, host = false, wait = ASK_WAIT, native, again = false, server = false } = {}) {
  const name = row?.name || row?.id || "";
  let opened;
  let route = null;
  if (again && !host) {
    // B91: a row iOS didn't download, tapped: the shell's IPA (still served) gets iOS's prompt again, no new signing;
    // code "gone" when it isn't served any more
    if (!(await repromptPrepared(row, native))) throw Object.assign(new Error("no longer served"), { code: "gone" });
    opened = { bundleId: row.bundleId, expires: row.expires ?? null };
  } else try {
    // B110: Open LocalDevVPN keeps this row (and so the queue, which installs one at a time) waiting on the run's page
    // ("vpn": core/apprun.js says "Waiting for LocalDevVPN…"); the run's Cancel or the row's stop aborts the signal
    route = server ? {} : await chooseRoute({ native, signal: signal ?? new AbortController().signal, onWait: () => progress("vpn", 0) });
    if (!route) throw Object.assign(new Error("Cancelled"), { code: "cancelled" });
    if (route.route) host = false; // This iPhone: installd updates iFizBox in place
    // B111: This iPhone has no iOS prompt: the row shows the copy and installd's percent (herePhase), and the reply
    // comes once installd has the app
    if (route.route) progress("copying", 0);
    opened = await abortable(native, "signing.open", { token: row.token, manifestServer: server ? defaultServer() : getServer(), ...(host ? { host: true } : {}), ...route },
      (ev) => {
        if (ev?.log) { log(ev.log); return; }
        const p = route.route ? herePhase(ev) : null;
        if (p) progress(p.phase, p.fraction);
      }, { tag, signal });
    if (route.route) return { installed: opened?.installed ?? true, expires: opened?.expires ?? null };
  } catch (e) {
    const err = rowError(e, name);
    const fallback = route ? serverFallback(e, route) : null; // F366
    throw fallback ? Object.assign(err, { fallback }) : err;
  }
  progress("asking", 0);
  if (host) recordSelfUpdate(storageOf(), opened?.version || row?.version); // B83: the next launch checks it landed
  if (host) return { installed: null, expires: opened?.expires ?? null, host: true };
  const bundleId = opened?.bundleId || row.bundleId;
  if (!bundleId) return { installed: null, expires: opened?.expires ?? null };
  // B200: once iOS has every byte of the IPA (signing.progress's {served: true}), the install is iOS's: the call
  // answers then (Sent to iOS, handedOff) so the queue starts the next app, and `later` carries the watch's own
  // answer (true: the run confirms Installed). Its progress events after that are dropped (the row has ended).
  let release = null;
  const sent = new Promise((resolve) => { release = resolve; });
  let handed = false;
  const watched = abortable(native, "signing.progress", { bundleId, wait }, (ev) => {
    if (ev?.log) log(ev.log);
    if (handed) return;
    if (ev?.served === true) { handed = true; release(); }
    else if (ev?.busy === true) progress("busy", 0); // B312: iOS is installing this app for another app
    else if (ev?.busy === false) progress("asking", 0);
    else if (ev?.phase === "installing") progress("installing", Number(ev.progress) || 0);
  }, { tag, signal });
  let r;
  try {
    r = await Promise.race([watched, sent.then(() => SENT)]);
  } catch (e) {
    if (e?.code === "cancelled") throw e;
    if (e?.code === "install_busy" || e?.code === "install_stalled") throw rowError(e, name); // B312: says why
    return { installed: null, expires: opened?.expires ?? null }; // iOS can't be asked: the prompt was shown
  }
  if (r === SENT) {
    const later = watched.then((x) => (x?.installed === true ? true : null), () => null);
    return { installed: null, expires: opened?.expires ?? null, handedOff: true, later };
  }
  // B85: dismissed: iOS's prompt closed and iOS never asked for the IPA (the user tapped Cancel on it)
  if (r?.dismissed) return { installed: r?.installed ?? null, expires: opened?.expires ?? null, dismissed: true };
  // B146: once iOS took the IPA, "not installed" can't be told apart from "installed but not seen" (isInstalled is
  // unreliable on iOS 27, a re-signed app may not show): the row ends Sent to iOS (null), never Failed
  return { installed: r?.installed === true ? true : null, expires: opened?.expires ?? null };
}

// B111: signing.open's event on the This iPhone route -> the run's { phase: "copying" | "installing", fraction 0..1 },
// or null (not a step event)
export function herePhase(ev) {
  if (ev?.phase !== "copying" && ev?.phase !== "installing") return null;
  const f = Number(ev.progress);
  return { phase: ev.phase, fraction: Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0 };
}

// B85: the run's "Tap Install on the iOS prompt" row: iOS's prompt for that app again -> true when the shell re-opened it
export async function repromptPrepared(row, native) {
  if (!row?.bundleId) return false;
  try { return Boolean((await bridge(native).call("signing.reprompt", { bundleId: row.bundleId }))?.reopened); } catch { return false; }
}

// B257: the sign-ahead run keeps the app running in the background (signing.hold, Sideload.hold) from Confirm until it
// ends, so leaving the app right after Confirm doesn't stop the route check before signing.open or the gaps between
// the shell's own holds. heldLanes(lanes) -> the same lanes, whose sign and install send signing.hold {on} as each
// starts (which also renews the shell's 10 minute limit) and {on: false} once none has run for `idleMs`; it starts
// held (Confirm already sent {on}: hold()). release() lets go at once (the run's page closed).
export const HOLD_IDLE = 2000; // ms with no sign or install running before the hold ends (a retry soon after reuses it)
export function heldLanes(lanes, { native, keep = holdApp, idleMs = HOLD_IDLE, later = setTimeout, clear = clearTimeout } = {}) {
  let busy = 0;
  let held = true;
  let timer = null;
  const stopTimer = () => { if (timer !== null) { clear(timer); timer = null; } };
  const off = () => { stopTimer(); if (held) { held = false; keep(native, false); } };
  const idle = () => {
    stopTimer();
    timer = later(() => { timer = null; if (!busy) off(); }, idleMs);
    timer?.unref?.(); // node: don't hold tests open
  };
  const wrap = (f) => (...args) => {
    busy += 1;
    stopTimer();
    held = true;
    keep(native, true);
    let p;
    try { p = Promise.resolve(f(...args)); } catch (e) { p = Promise.reject(e); }
    const done = () => { busy -= 1; if (!busy) idle(); };
    p.then(done, done);
    return p;
  };
  idle(); // held from Confirm: lets go if no lane starts
  const out = { ...lanes, release: off };
  for (const k of ["sign", "install"]) if (typeof lanes?.[k] === "function") out[k] = wrap(lanes[k]);
  return out;
}

export function discardPrepared(token, native) {
  try { Promise.resolve(bridge(native).call("signing.discard", { token })).catch(() => {}); } catch { /* no bridge */ }
}
