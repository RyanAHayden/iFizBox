// F235: the IPA queue's run (My IPAs installs, app pages, Changes' upgrades, Re-sign All) on F234's black page with
// rows. Pure JS, no DOM: the rows, the run, and the words the rows and the log show. The page is screens/apprun.js;
// the phone's calls are signing-client.js prepareOnDevice / openPrepared (native signing.prepare / signing.open).
//
//   appRows(jobs)              -> [row]  one row per queued app (core/appqueue.js jobs), in runOrder (iFizBox last)
//   row: { id, name, mode, job, size, state, phase, fraction, error, token, bundleId, expires, unsure, dismissed, again }
//   createAppRun({ rows, sign, install, discard, reprompt, ahead = 2, parallel = 1, stallMs, later, clear, onChange, onLog })
//       sign(row, hooks)    -> { token, bundleId?, expires?, name? }  the download and the signing, ahead of the installs
//                              (hooks: { signal, progress(phase "downloading" | "signing", fraction 0..1) })
//       install(row, hooks) -> { installed: true | false | null, expires? }  hands the signed app to iOS and waits for
//                              its install (hooks: { signal, progress("asking" | "installing", fraction) }): "asking"
//                              while iOS's Install prompt is up, "installing" once iOS reports progress. null: iOS
//                              can't be asked whether it installed (the row ends as sent). B111, This iPhone: no
//                              prompt; progress("copying", f) then ("installing", installd's f), the row's `here`
//                              turns true and its words say Copying to iPhone / Installing. handedOff: true (the
//                              shell's word that iOS had the whole IPA, or iFizBox was in the background) turns a
//                              false into "sent" too (B76, below). later (B200): a promise for the install's
//                              real end when the call answered at the handoff; true turns the "Sent" row Installed.
//                              dismissed: true (B85: iOS's prompt closed and
//                              iOS never asked for the IPA) ends the row Failed ("Failed: iOS didn't download it":
//                              B91, the user's Cancel and a frozen server look the same) and the next app goes on.
//                              hooks.again (B91): that row's Try Again: no new signing; the shell's IPA (still
//                              served) is offered again (signing.reprompt), and the call throws code "gone" when it
//                              isn't served any more (the row then signs again from the start)
//       discard(row)        frees a signed copy that will never be installed (its row stopped, or the run cancelled)
//       reprompt(row)       -> true | false: B85, iOS's prompt for the app with iOS ("asking") again
//       local(row)          -> true when the row's install goes the This iPhone route (B137: its row and the bottom
//                              status say Installing, never Tap Install, until iOS's prompt really shows: promptUp)
//     .start() -> a promise for the end (every row installed, failed or cancelled)
//     .stop(id)   the working row's round stop button: aborts that app only (its download, signing or iOS's prompt);
//                 the next one goes on
//     .cancel()   the red Cancel: every app not finished is abandoned (in-flight ones aborted)
//     .retry(id) / .retryAll()   failed and cancelled rows go again (a new pass when the run had ended); B91: a row
//                 iOS didn't download (dismissed) goes back to iOS's prompt without signing again (hooks.again)
//     .installAgain(ids) B337: failed rows that still hold their signed IPA (token) run only the install again: no
//                 download or signing, progress kept, and the new pass keeps the Log (onStart(pass, { keep: true }))
//     .away()     B76: iFizBox went to the background while a row was with iOS: that row is handed off to iOS
//     .confirm(id) B76: iOS has an app whose row ended "Sent to iOS" (apps.isInstalled on the way back): Installed
//     .unconfirm(id) B170: iOS later says it doesn't have that app: the row is "Sent to iOS" again
//     .reprompt(id) B85: the "Tap Install on the iOS prompt" row's tap: reprompt(row), logged -> a promise for true | false
//     .notTaken(id, why) B123: an ended run's "Sent to iOS" row that iOS never took turns Failed (why) -> true | false
//     .ownIdRetry(id) B151: a row the App Store's install coordinator blocked (IX Code 46: row.busy, coordinatorBusy)
//                 goes again with Keep Bundle IDs off for that app (its own bundle ID) -> the end promise | null
//     .rows / .running / .stopping / .current (the row with iOS) / .pass (B153: how many times it started)
//   onStart(pass)  B153: start() of an idle run (the first, or a retry, Retry All or ownIdRetry after the run ended)
//                 begins pass n: the page clears its log, so a new pass never shows the last one's lines
//   keepAwake(on)  F287: true when a pass starts, false once every row has ended (installed, failed, stopped or
//                 cancelled), exactly once each: the backend's keepAwake keeps the screen from locking meanwhile
//
// B76: a stock phone can't watch iOS's install once iFizBox is in the background, so installed: false after a handoff
// (handedOff, or .away() during the watch) means "lost sight", not "refused": the row ends Done as sent (unsure) and
// leaves the queue. Failed stays for a refusal seen while iFizBox stayed in front (iOS never fetched the IPA).
//   rowStatus(row, { locale, timeZone }) -> the row's grey line ("Downloading 12.0 of 48.0 MB", "Tap Install on the
//                              iOS prompt", "Re-signed, expires Dec 3, 2026")
//   summaryLine(rows)          -> "2 installed, 1 re-signed, 1 failed, 1 cancelled"
//   runStatus(rows) / runPercent(rows)   the bottom status and bar
//   rowProgress(row) / barOf(row)  B152: a row's place in its whole run (stage weights) / the row bar's fill: row.progress,
//                              which never goes backwards within one try (a retry or a fresh signing starts it again)
//   helperRow(row)             B71a: a jailbreak app run's row (job.helper: the root helper installs the IPA or, mode
//                              "remove", uninstalls the app): Waiting, Checking, Installing 40% / Removing, Installed /
//                              Removed; "N removed" in the summary; no Signed line in the log
//   installdText(text, row)    B138: a row's error with installd's raw words made plain (the App ID refusal, error 15:
//                              appIdMismatchText; any other UnknownErrorType: "iOS refused to install it: <why>")
//
// Two lanes. Signing: `ahead` apps at a time in the run's order are downloaded and signed (the sideload app's page
// passes Infinity, F359: every app starts at once). Installing: one app at a
// time: the first signed row is handed to iOS (installLaneNext, B263: never held by a row ahead of it that is still
// downloading or signing), and the next waits for iOS to finish it (or for it to fail or be stopped). F359: on the This
// iPhone route (local(row), no iOS prompt) up to `parallel` rows copy and install together (installLaneStart), each
// joining once the one before it is copying; an iOS prompt row still goes alone. iFizBox's own
// IPA goes only after every other row has ended, so iOS closing iFizBox to install it can't cut the others off.
// A download or signing phase that sends no progress for `stallMs` fails its row ("stopped at Signing 50%"), and that app's job is aborted, so the queue moves on. The log gets one line per phase per
// app (Downloading Delta 48 MB, Signed Delta, Asked iOS to install Delta, Installed Delta / the reason it failed);
// percents only move the row's bar and the bottom status.
// SPDX-License-Identifier: GPL-3.0-or-later
import { runOrder, sizeText, SELF_ID } from "./appqueue.js";
import { VPN_WAIT } from "./installroute.js";
import { NAME } from "../brand.js";
import { isNewer } from "./selfupdate.js"; // B159: staleSelf
import { rateText, busyText } from "./signing.js"; // B262; B312

// B136: an install that failed must not leave the app recorded as installed (Installed's record decides the Search
// row's swipe: a recorded, up-to-date app has none). recordWhen(row, onPhone) says when a row's app goes into that
// record: "now" for an install iOS confirmed (and for rows that change no install record: re-signs, removes, iFizBox
// itself); "wait" for a "Sent to iOS" row iOS hasn't confirmed: onPhone undefined (not asked yet), false (iOS doesn't
// have it: an install iOS never fetched, B128's ECONNREFUSED, or one still going) or null (B170: apps.isInstalled had no
// answer; the user's Cancel on iOS's own prompt looks exactly like that), and a sent row with no bundle ID to ask
// about; "never" for a row that didn't end installed (failed, or cancelled by the red Cancel or its stop).
// B236: iOS 27 never answers apps.isInstalled (null for every app, B229), so a row whose IPA iOS fetched in full
// (row.fetched: the shell's served word, B200's handoff) is recorded on that no-answer. A Cancel on iOS's prompt
// fetches nothing, so B170's cancelled install still waits; a false (iOS says it doesn't have it) still waits too.
export function recordWhen(row, onPhone) {
  if (row?.state !== "installed") return "never";
  if (!row.unsure || row.mode === "resign" || row.mode === "remove" || isSelf(row)) return "now";
  if (row.bundleId && onPhone === true) return "now";
  if (row.bundleId && onPhone === null && row.fetched === true) return "now";
  return "wait";
}

export const APP_STATES = ["waiting","downloading", "signing", "signed", "asking", "installing", "installed", "failed", "cancelled"];
const ENDED = new Set(["installed", "failed", "cancelled"]);
export const ended = (row) => ENDED.has(row?.state);
const SIGNING = new Set(["downloading", "signing"]);
const WITH_IOS = new Set(["asking", "installing"]);
// B65's limit for a phase that goes quiet (core/signing.js STALL_LIMIT), kept here so this module stays pure.
export const APP_STALL = 180_000;

// B152: the signer's own phases under "signing" (native/sign/IPASigner.swift: "reading" hashes the IPA 0..1, then
// "signing" signs its bundles 0..1): each fills its part of the row's Signing, so the bar doesn't empty in between
export const SIGN_STEPS = { reading: [0, 0.5], signing: [0.5, 1] };

const PHASE_WORD = { downloading: "Downloading", signing: "Signing", asking: "Asking iOS", installing: "Installing",
  copying: "Copying to iPhone" };

export function appRows(jobs = []) {
  return runOrder(jobs).map((j) => ({
    id: j.id, name: j.name || j.id, mode: j.mode || "install", job: j, size: Number(j.size) > 0 ? Number(j.size) : null,
    state: "waiting", phase: null, fraction: 0, error: null, token: null, bundleId: null, expires: null, unsure: false,
    dismissed: false, again: false, here: false, local: false, busy: false, progress: 0, fetched: false,
  }));
}

// B111: the This iPhone route (installd over LocalDevVPN): no iOS prompt. install's progress goes "copying" (the IPA's
// bytes to iOS) then "installing" (installd's percent), and the row's `here` says it took that route.
// B173: iFizBox's own IPA: once installd accepted it (its first status), the shell closes iFizBox within a couple of
// seconds so iOS can finish (iOS 17.4+ installd waits for the running copy to go), so the row and the run say so.
export const SELF_CLOSING = "Closing so iOS can finish";
export const SELF_RESTART = SELF_CLOSING; // the older name, still imported by signing-client.js
export const copyingText = (row) => `Copying ${label(row)} to this iPhone`;

// B91: a row whose iOS prompt closed without iOS asking for the IPA: the user's Cancel or a frozen server, iFizBox
// can't tell which, so it doesn't say Cancelled.
export const DIDNT_DOWNLOAD = "iOS didn't download it";

// B139: only the user's Cancel or a row's stop marks an app Cancelled (cancelRow). A call that answers "cancelled"
// when neither was tapped (the shell's job for it was stopped from elsewhere) fails the row with these words instead,
// and the next app goes on.
export const NOT_YOU = "stopped before it finished (not by Cancel)";
const errorText = (e, row) => (e?.code === "cancelled" || /^cancel+ed$/i.test(String(e?.message ?? "").trim())
  ? NOT_YOU : installdText(e?.message || String(e), row));

// B138: installd refuses an update signed for another application-identifier than the installed copy's
// (MismatchedApplicationIdentifierEntitlement). idevice has no type for it, so it comes as its UnknownErrorType, code
// 15, which every unnamed installd error shares: "unknown error `MismatchedApplicationIdentifierEntitlement (...)`
// returned from device (15)". The shell words it before signing when it can tell (Sideload.swift installedAppID,
// code appid_mismatch); this is for when it couldn't. Never the raw UnknownErrorType text.
export const isAppIdMismatch = (text) => /MismatchedApplicationIdentifierEntitlement/.test(String(text ?? ""));
export const appIdMismatchText = (name) => {
  const app = name || "the app";
  return `iOS refused the update: ${app} on this iPhone was signed for another App ID than this copy. Import the `
    + `profile it was installed with and try again, or delete ${app} from the Home Screen and install it again (its data is lost)`;
};
// A row's error text with installd's raw words made plain: the App ID refusal above, and any other UnknownErrorType
// as "iOS refused to install it" with installd's own reason (its ErrorDescription) when there is one.
export function installdText(text, row = null) {
  const t = String(text ?? "");
  if (isAppIdMismatch(t)) return appIdMismatchText(row ? label(row) : "");
  const raw = /unknown error `([^`]*)` returned from device|UnknownErrorType[:(\s]*([^)]*)/i.exec(t); // deviceError capitalises
  if (!raw) return t;
  const what = (raw[1] ?? raw[2] ?? "").trim();
  const why = /\((.+)\)\s*$/.exec(what)?.[1]?.trim(); // "SomeErrorName (installd's description)"
  return `iOS refused to install it${why ? `: ${why}` : ""}`;
}

// B151: installd refuses an app whose bundle ID has an install coordinator someone else holds: "IXErrorDomain
// Code=46 A coordinated app install already exists for <id> (creator App Store) but request by
// mobile_installation_proxy had scope requirement ...". The user's case (2026-11-20): the App Store's copy of the app
// was still installed; once they deleted it, the same IPA installed fine on both routes. So the row says that, and
// Retry is the way out. A different bundle ID has no coordinator either, so a row that can still offers that
// (ownIdRetry): its tap signs and installs the app again with Keep Bundle IDs off for this app only.
export const coordinatorBusy = (text) => {
  const s = String(text ?? "");
  return /coordinated app install already exists/i.test(s) || /IXErrorDomain\b[\s\S]{0,40}\bCode[ =]*46\b/i.test(s);
};
export const BUSY_ROW_KEPT = "the App Store version is installed. Delete it, then Retry";
export const BUSY_ROW = `${BUSY_ROW_KEPT}, or tap to install it with its own bundle ID`;
// The coordinator's bundle ID, as installd names it ("... already exists for com.atebits.Tweetie2 (creator ...").
export function busyBundleId(text) {
  const m = /already exists for ([A-Za-z0-9.-]+)/.exec(String(text ?? ""));
  return m ? m[1] : null;
}
// Whether a row can go again under its own bundle ID: an install with an IPA (a link or My IPAs), not iFizBox
// itself, not the jailbreak app's helper, not a re-sign of a recorded app, and not already off.
export function ownIdOk(row) {
  const j = row?.job;
  if (!j || isSelf(row) || helperRow(row) || row.mode === "remove") return false;
  if (!j.url && !j.library) return false;
  return j.options?.edits?.keepBundleId !== false;
}
// The job with Keep Bundle IDs off for this app (signing-client.js prepareParams sends edits.keepBundleId).
export function ownIdJob(job) {
  const options = job?.options ?? {};
  return { ...job, options: { ...options, edits: { ...(options.edits ?? {}), keepBundleId: false } } };
}

const label = (r) => r.name || r.id;
const pct =(f) => Math.round((Number(f) || 0) * 100);

// "Stopped at Signing 50%: nothing moved for 3 minutes." (B65's words, for one row)
export function stallText(row, limit = APP_STALL) {
  const mins = Math.round(limit / 60_000);
  const span = mins >= 1 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${Math.round(limit / 1000)} seconds`;
  const p = pct(row?.fraction);
  const where = `${PHASE_WORD[row?.phase] ?? "the start"}${p > 0 && p < 100 ? ` ${p}%` : ""}`;
  return `stopped at ${where}: nothing moved for ${span}`;
}

// B263: the row the install lane hands to iOS next: the first signed row in the run's order, whatever the rows ahead
// of it are still doing (a big app still downloading or signing holds nobody). iFizBox's own row only once every
// other row has ended, since installing it closes iFizBox. null: nothing is ready.
export function installLaneNext(rows = []) {
  const next = rows.find((r) => r.state === "signed" && !isSelf(r));
  if (next) return next;
  const self = rows.find((r) => r.state === "signed" && isSelf(r));
  return self && rows.every((r) => r === self || ended(r)) ? self : null;
}

// F359: how many This iPhone installs (core/installroute.js "iphone": installd over LocalDevVPN or Tailscale, no iOS
// prompt) the install lane runs at once; the shell takes as many (native SignBridge.swift HereLane)
export const HERE_PARALLEL = 3;

// F359: whether a row may install beside others: the This iPhone route (local(row)), not iFizBox itself (it goes alone,
// last), not the jailbreak app's helper, and not a Try Again (iOS's prompt again: one prompt at a time)
const wideRow = (r, localRoute) => !isSelf(r) && !helperRow(r) && !r.again && localRoute(r);

// F359: the row the install lane starts now, or null. Nothing with iOS: the next signed row (installLaneNext). Rows
// already with iOS: one more only while every one of them is copying or installing on This iPhone (`here`: its route
// is settled, so no LocalDevVPN alert or iOS prompt can be up), the next is a This iPhone row too, and fewer than
// `parallel` are going. An iOS prompt row, or a row still settling its route, waits for every other to end. So rows
// join one at a time: each as the one before it starts copying (the run asks again then).
export function installLaneStart(rows = [], { parallel = 1, local = () => false } = {}) {
  const next = installLaneNext(rows);
  if (!next) return null;
  const going = rows.filter((r) => WITH_IOS.has(r.state));
  if (!going.length) return next;
  if (going.length >= parallel || !wideRow(next, local)) return null;
  return going.every((r) => r.here && wideRow(r, local)) ? next : null;
}

export function createAppRun({ rows, sign, install, discard = () => {}, reprompt = null, ahead = 2, parallel = 1, stallMs = APP_STALL,
  later = setTimeout, clear = clearTimeout, onChange = () => {}, onLog = () => {}, local = () => false, onStart = () => {}, keepAwake = () => {} }) {
  const awake = (on) => { try { Promise.resolve(keepAwake(on)).catch(() => {}); } catch { /* the screen may lock */ } }; // F287
  const flights = new Map(); // id -> { ctl: AbortController, timer, why }
  let running = false;
  let pass = 0; // B153: each start() of an idle run is a new pass (onStart(pass)), so its page starts a clean log
  let stopping = false;
  let resolveEnd = null;
  let endPromise = null;

  const changed = (r) => { try { onChange(r); } catch { /* the page's bug isn't the run's */ } };
  const log = (r, kind, text) => { try { onLog({ id: r?.id ?? null, kind, text }); } catch { /* as above */ } };

  // B152: row.progress only moves forward; a patch that names `progress` (a new try) sets it outright
  const set = (r, patch) => {
    const before = Number(r.progress) || 0;
    Object.assign(r, patch);
    if (!("progress" in patch)) r.progress = Math.max(before, rowProgress(r));
    changed(r);
  };
  // B137: the row's install starts on the This iPhone route (Settings > Installation): no iOS prompt to tap
  const localRoute = (r) => { try { return Boolean(local(r)); } catch { return false; } };

  const finishRow = (r, state, patch = {}) => {
    const f = flights.get(r.id);
    if (f) { if (f.timer != null) clear(f.timer); flights.delete(r.id); }
    set(r, { state, ...patch });
  };

  // One phase's progress: a new phase gets its log line once; a percent only moves the bar. B152: `step` is the
  // shell's own phase under "signing" (the signer reads the IPA 0..1, then signs it 0..1): each gets its half.
  // B262: `info` ({ bytes, total, rate }, the shell's once-a-second download numbers) goes on the row for its MB/s.
  const progressOf = (r, f) => (phase, fraction = 0, step = null, info = null) => {
    if (f.ctl.signal.aborted || ended(r)) return;
    const first = r.phase !== phase;
    if (first && helperRow(r)) { // B71a: the jailbreak app's helper: one step per app, no signing, no iOS prompt
      if (phase === "installing") log(r, "step", `${r.mode === "remove" ? "Removing" : "Installing"} ${label(r)}`);
    } else if (first) {
      if (phase === "downloading") log(r, "step", `Downloading ${label(r)}${r.size ? ` ${sizeText(r.size)}` : ""}`);
      else if (phase === "signing") log(r, "step", `Signing ${label(r)}`);
      else if (phase === "asking") log(r, "step", `Asked iOS to install ${label(r)}`);
      else if (phase === "copying") log(r, "step", copyingText(r)); // B111: This iPhone
      else if (phase === "installing" && r.here) {
        log(r, "step", `Installing ${label(r)}`);
        if (isSelf(r)) log(r, "step", SELF_CLOSING); // B173: installd accepted it: the shell closes iFizBox now
      } else if (phase === "installing") log(r, "step", `iOS is installing ${label(r)}`);
      else if (phase === "vpn") log(r, "step", VPN_WAIT); // B110: Open LocalDevVPN: the row waits for it
      else if (phase === "busy") log(r, "step", busyText(label(r))); // B312: iOS installs it for another app first
    }
    const settled = !r.here && phase === "copying"; // F359: its This iPhone route is settled: others may join it
    const here = r.here || phase === "copying";
    const state = phase === "copying" ? "installing" : SIGNING.has(phase) || WITH_IOS.has(phase) ? phase : r.state;
    let frac = Math.max(0, Math.min(1, Number(fraction) || 0));
    if (phase === "signing" && SIGN_STEPS[step]) frac = SIGN_STEPS[step][0] + (SIGN_STEPS[step][1] - SIGN_STEPS[step][0]) * frac;
    const dl = phase === "downloading" && info ? { bytes: Number(info.bytes) || 0, total: Number(info.total) || 0, rate: Number(info.rate) || 0 } : {};
    set(r, { phase, state, here, fraction: frac, ...dl });
    if (SIGNING.has(phase)) arm(r, f);
    // F359: the shell signs one app at a time, so a downloaded app waits for the signer with no progress of its own:
    // while another row's signing moves, the downloaded rows' stall clocks start again (a stuck signer still fails)
    if (phase === "signing") for (const o of rows) {
      const of = o !== r && o.state === "downloading" && o.fraction >= 1 ? flights.get(o.id) : null;
      if (of && !of.ctl.signal.aborted) arm(o, of);
    }
    if (settled) pump();
  };

  // B65: a download or signing phase that goes quiet fails its row (and aborts its job); iOS's prompt waits for the user.
  const arm = (r, f) => {
    if (f.timer != null) clear(f.timer);
    f.timer = later(() => {
      f.timer = null;
      if (f.ctl.signal.aborted || ended(r)) return;
      f.why = "stalled";
      f.ctl.abort();
      fail(r, stallText(r, stallMs));
    }, stallMs);
  };

  const fail = (r, why) => {
    if (ended(r)) return;
    const text = String(why || "failed");
    if (coordinatorBusy(text)) { // our one short line as the row's and the Log's red line; installd's dump grey below
      const own = ownIdOk(r);
      const why = own ? BUSY_ROW : BUSY_ROW_KEPT;
      finishRow(r, "failed", { error: why, busy: own });
      log(r, "error", `${label(r)}: ${why}`);
      log(r, "raw", text);
      pump();
      return;
    }
    finishRow(r, "failed", { error: text });
    log(r, "error", `${label(r)}: ${text}`);
    pump();
  };

  const cancelRow = (r) => {
    if (ended(r)) return;
    const f = flights.get(r.id);
    if (f) { f.why = "cancelled"; f.ctl.abort(); }
    if (r.state === "signed" && r.token) { try { discard(r); } catch { /* the token runs out on its own */ } }
    finishRow(r, "cancelled", { token: null });
    log(r, "step", `Cancelled ${label(r)}`);
  };

  const fly = (r) => {
    const f = { ctl: new AbortController(), timer: null, why: null };
    flights.set(r.id, f);
    return f;
  };

  async function startSign(r) {
    const f = fly(r);
    set(r, { state: "downloading", phase: null, fraction: 0, error: null, progress: 0, bytes: 0, total: 0, rate: 0 });
    arm(r, f);
    let res;
    try {
      res = await sign(r, { signal: f.ctl.signal, progress: progressOf(r, f) });
    } catch (e) {
      if (f.why || ended(r)) return; // stopped, cancelled or timed out: its row says so already
      fail(r, errorText(e, r));
      return;
    }
    if (f.why || ended(r)) { if (res?.token) { try { discard({ ...r, token: res.token }); } catch { /* runs out */ } } return; }
    if (f.timer != null) clear(f.timer);
    flights.delete(r.id);
    if (!res?.token) { fail(r, "nothing was signed"); return; }
    const stale = staleSelf(r, res);
    if (stale) { try { discard({ ...r, token: res.token }); } catch { /* runs out */ } fail(r, stale); return; }
    set(r, { state: "signed", phase: null, fraction: 1, token: res.token, bundleId: res.bundleId ?? r.bundleId,
      expires: res.expires ?? r.expires, name: r.job?.name ? r.name : res.name || r.name });
    if (!helperRow(r)) log(r, "step", `Signed ${label(r)}`);
    pump();
  }

  async function startInstall(r) {
    const f = fly(r);
    const again = Boolean(r.again);
    const reinstall = Boolean(r.reinstall); // B337: installAgain's row
    set(r, { state: "asking", phase: null, fraction: 0, again: false, reinstall: false, here: false, local: localRoute(r) });
    let res;
    try {
      res = await install(r, { signal: f.ctl.signal, progress: progressOf(r, f), ...(again ? { again: true } : {}) });
    } catch (e) {
      if (f.why || ended(r)) return;
      if (reinstall && e?.code === "gone") {
        // B337: the shell no longer keeps that signed IPA (its `life` ran out, or an older shell): signed again
        finishRow(r, "waiting", { token: null, phase: null, fraction: 0, progress: 0 });
        log(r, "step", `The signed copy of ${label(r)} is gone; signing it again`);
        pump();
        return;
      }
      if (again && e?.code === "gone") {
        // B91: the shell no longer serves that IPA: the row signs it again from the start
        finishRow(r, "waiting", { token: null, dismissed: false, phase: null, fraction: 0, progress: 0 });
        log(r, "step", `${label(r)} is no longer with iOS; signing it again`);
        pump();
        return;
      }
      fail(r, errorText(e, r));
      return;
    }
    if (f.why || ended(r)) return;
    if (res?.dismissed && res?.installed !== true) {
      // B85: iOS's prompt closed and iOS never asked for the IPA. B91: Cancel and a frozen server look the same, so
      // not "Cancelled": Failed, and its Try Again offers the same IPA again. The next app goes on.
      finishRow(r, "failed", { token: null, dismissed: true, error: DIDNT_DOWNLOAD, phase: null, fraction: 0 });
      log(r, "error", `${label(r)}: ${DIDNT_DOWNLOAD}`);
      pump();
      return;
    }
    const expires = res?.expires ?? r.expires;
    const handedOff = Boolean(res?.handedOff || f.away);
    if (res?.installed === false && !handedOff) { fail(r, "iOS didn't install it"); return; }
    const unsure = res?.installed !== true;
    // B200: `finishing` while the call's `later` (iOS still installing what it fully has) hasn't answered
    const finishing = unsure && typeof res?.later?.then === "function";
    // B236: `fetched`: the call's handedOff is only ever the shell's word that iOS had the whole IPA (f.away is not)
    finishRow(r, "installed", { token: null, expires, unsure, phase: null, fraction: 1, fetched: res?.handedOff === true,
      ...(finishing ? { finishing } : {}) });
    if (r.mode === "resign") log(r, "step", `Re-signed ${label(r)}${expires ? `, expires ${dateText(expires)}` : ""}`);
    else if (r.mode === "remove") log(r, "step", `Removed ${label(r)}`);
    else log(r, "step", unsure ? `Sent ${label(r)} to iOS` : `Installed ${label(r)}`);
    // B200: answered once iOS had the whole IPA: the watch goes on, and its true later makes the row Installed
    if (finishing) {
      const row = r;
      res.later.then((v) => {
        if (!row.finishing) return;
        if (v !== true || row.state !== "installed" || !row.unsure) { set(row, { finishing: false }); return; }
        set(row, { unsure: false, finishing: false });
        if (row.mode !== "resign") log(row, "step", `Installed ${label(row)}`);
      }, () => {});
    }
    pump();
  }

  // A failed or cancelled row going again: from the start, or (B91) a row iOS didn't download straight back to iOS's
  // prompt with the IPA the shell still serves ("signed" with `again`: the install lane offers it in turn).
  const retryPatch = (r) => {
    const back = r.state === "failed" && r.dismissed && Boolean(reprompt) && Boolean(r.bundleId) && !helperRow(r);
    return { state: back ? "signed" : "waiting", again: back, phase: null, fraction: back ? 1 : 0, progress: back ? 0.5 : 0, error: null,
      token: null, unsure: false, dismissed: false, busy: false, finishing: false, fetched: false, reinstall: false };
  };

  function pump() {
    if (!running) return;
    if (!stopping) {
      // the signing lane: `ahead` at a time, in order
      let busy = rows.filter((r) => SIGNING.has(r.state)).length;
      for (const r of rows) {
        if (busy >= ahead) break;
        if (r.state === "waiting") { busy++; startSign(r); }
      }
      // the install lane: one row with iOS at a time, or (F359) up to `parallel` This iPhone rows (installLaneStart)
      const next = installLaneStart(rows, { parallel, local: localRoute });
      if (next) startInstall(next);
    }
    if (rows.every(ended) && !flights.size) {
      running = false;
      stopping = false;
      const done = resolveEnd;
      resolveEnd = null;
      endPromise = null;
      awake(false);
      done?.();
    }
  }

  function start({ keep = false } = {}) {
    if (running) return endPromise;
    running = true;
    stopping = false;
    endPromise = new Promise((res) => { resolveEnd = res; });
    const p = endPromise;
    pass++;
    awake(true);
    try { onStart(pass, keep ? { keep: true } : {}); } catch { /* the page's bug isn't the run's */ }
    // a microtask later, so the caller can draw the rows first
    Promise.resolve().then(pump);
    return p;
  }

  return {
    rows,
    get running() { return running; },
    get stopping() { return stopping; },
    get current() { return rows.find((r) => WITH_IOS.has(r.state)) ?? null; },
    get pass() { return pass; },
    start,
    away() {
      let n = 0;
      for (const r of rows) {
        const f = WITH_IOS.has(r.state) ? flights.get(r.id) : null;
        if (f) { f.away = true; n++; }
      }
      return n > 0;
    },
    confirm(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== "installed" || !r.unsure) return false;
      set(r, { unsure: false });
      if (r.mode !== "resign") log(r, "step", `Installed ${label(r)}`);
      return true;
    },
    // B170: iOS says it doesn't have an app whose row was confirmed after "Sent to iOS" (apps.isInstalled false on a
    // later check): the row reads "Sent to iOS" again (its record is undone by the page) -> true | false
    unconfirm(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== "installed" || r.unsure || r.mode !== "install" || helperRow(r)) return false;
      set(r, { unsure: true });
      log(r, "step", `iOS doesn't have ${label(r)} now`);
      return true;
    },
    async reprompt(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== "asking" || !reprompt || !flights.has(r.id) || !promptUp(r)) return false;
      let ok = false;
      try { ok = Boolean(await reprompt(r)); } catch { ok = false; }
      if (r.state !== "asking") return false;
      log(r, "step", ok ? `Asked iOS again to install ${label(r)}` : `iOS's prompt for ${label(r)} can't be shown again`);
      return ok;
    },
    stop(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || ended(r)) return false;
      cancelRow(r);
      pump();
      return true;
    },
    cancel() {
      if (!running || stopping) return false;
      stopping = true;
      for (const r of rows) cancelRow(r);
      pump();
      return true;
    },
    retry(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || !["failed", "cancelled"].includes(r.state)) return null;
      set(r, retryPatch(r));
      if (running) { pump(); return endPromise; }
      return start();
    },
    // B123: iFizBox's own row was sent to iOS but iOS never took it (signing.selfUpdate notStarted / stalled): the
    // ended run's row turns Failed with `why`, so its tap and Retry All sign and send it again
    notTaken(id, why) {
      const r = rows.find((x) => x.id === id);
      if (!r || running || r.state !== "installed" || !r.unsure) return false;
      set(r, { state: "failed", unsure: false, dismissed: false, error: why, phase: null, fraction: 0, progress: 0 });
      log(r, "error", `${label(r)}: ${why}`);
      return true;
    },
    // B151: a row the App Store's install coordinator blocked (row.busy): signed and installed again from the start
    // with Keep Bundle IDs off for this app only, so it gets its own bundle ID -> the run's end promise | null
    ownIdRetry(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== "failed" || !ownIdOk(r)) return null;
      r.job = ownIdJob(r.job);
      set(r, { ...retryPatch(r), state: "waiting", again: false, fraction: 0, progress: 0, bundleId: null });
      // B153: logged after start(), so a new pass's clean log opens with it
      const p = running ? endPromise : start();
      log(r, "step", `Installing ${label(r)} with its own bundle ID`);
      if (running) pump();
      return p;
    },
    // B337: the Signing Server Fallback's rows: a row whose install failed after its signing (its token kept) goes
    // back to the install lane with the same signed IPA: no new download or signing, its progress kept, and the pass
    // keeps the page's Log (onStart's `keep`) -> the run's end promise | null (no such row)
    installAgain(ids = []) {
      const again = rows.filter((r) => ids.includes(r.id) && r.state === "failed" && r.token && !helperRow(r));
      if (!again.length) return null;
      for (const r of again) set(r, { state: "signed", phase: null, fraction: 1, error: null, again: false, reinstall: true, unsure: false,
        dismissed: false, busy: false, finishing: false, fetched: false });
      if (running) { pump(); return endPromise; }
      return start({ keep: true });
    },
    retryAll() {
      const again = rows.filter((r) => ["failed", "cancelled"].includes(r.state));
      if (!again.length) return null;
      for (const r of again) set(r, retryPatch(r));
      if (running) { pump(); return endPromise; }
      return start();
    },
  };
}

// ---- words ----------------------------------------------------------------------------------------------------

export function dateText(iso, { locale = undefined, timeZone = undefined } = {}) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(locale ?? "en-US", { year: "numeric", month: "short", day: "numeric", timeZone });
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);

// B71a: a row of the jailbreak app's run (job.helper: the helper installs the IPA or uninstalls the app, no signing).
export const helperRow = (row) => Boolean(row?.job?.helper);
function helperStatus(row) {
  const p = pct(row.fraction);
  const verb = row.mode === "remove" ? "Removing" : "Installing";
  switch (row.state) {
    case "waiting": case "signed": return "Waiting";
    case "downloading": case "signing": return "Checking";
    case "asking": return verb;
    case "installing": return p > 0 && p < 100 ? `${verb} ${p}%` : verb;
    case "installed": return row.mode === "remove" ? "Removed" : "Installed";
    default: return null;
  }
}

export function rowStatus(row, opts = {}) {
  const p = pct(row.fraction);
  if (helperRow(row)) { const h = helperStatus(row); if (h != null) return h; }
  switch (row.state) {
    case "waiting": return "Waiting";
    case "downloading": {
      // B262: the shell's own total (and bytes, when it knows no total) before the queue's listed size; its MB/s after
      const total = row.total > 0 ? row.total : row.size;
      const speed = row.rate > 0 ? `, ${rateText(row.rate)}` : "";
      if (total && row.fraction > 0) return `Downloading ${mb(total * row.fraction)} of ${mb(total)} MB${speed}`;
      if (row.bytes > 0) return `Downloading ${mb(row.bytes)} MB${speed}`;
      return p > 0 ? `Downloading ${p}%` : "Downloading";
    }
    case "signing": return p > 0 && p < 100 ? `Signing ${p}%` : "Signing";
    case "signed": return "Signed";
    case "asking":
      if (row.phase === "vpn") return VPN_WAIT;
      if (row.phase === "busy") return busyText(label(row)); // B312
      return promptUp(row) ? "Tap Install on the iOS prompt" : "Installing"; // B137: This iPhone has no prompt
    case "installing":
      if (row.phase === "copying") return p > 0 && p < 100 ? `Copying to iPhone ${p}%` : "Copying to iPhone";
      if (selfClosing(row)) return SELF_CLOSING;
      return p > 0 && p < 100 ? `Installing ${p}%` : "Installing";
    case "installed":
      if (row.mode === "resign") return row.expires ? `Re-signed, expires ${dateText(row.expires, opts)}` : "Re-signed";
      if (!row.unsure) return "Installed";
      return row.finishing ? "Finishing on iOS" : "Sent to iOS"; // B200: handed off, iOS still installing
    case "failed": return row.error ? `Failed: ${row.error}` : "Failed";
    case "cancelled": return "Cancelled";
    default: return "";
  }
}

export function summaryLine(rows) {
  const n = (f) => rows.filter(f).length;
  const parts = [
    [n((r) => r.state === "installed" && r.mode !== "resign" && r.mode !== "remove"), "installed"],
    [n((r) => r.state === "installed" && r.mode === "remove"), "removed"],
    [n((r) => r.state === "installed" && r.mode === "resign"), "re-signed"],
    [n((r) => r.state === "failed"), "failed"],
    [n((r) => r.state === "cancelled"), "cancelled"],
  ].filter(([c]) => c);
  return parts.length ? parts.map(([c, w]) => `${c} ${w}`).join(", ") : "Nothing to do";
}

export function runStatus(rows) {
  const pos = (r) => `${rows.indexOf(r) + 1} of ${rows.length}`;
  const withIos = rows.filter((r) => WITH_IOS.has(r.state));
  if (withIos.length > 1) { // F359: This iPhone rows installing together
    return withIos.every((r) => r.phase === "copying") ? `Copying ${withIos.length} apps to iPhone` : `Installing ${withIos.length} apps`;
  }
  const ios = withIos[0];
  if (ios && helperRow(ios)) return `${ios.mode === "remove" ? "Removing" : "Installing"} ${label(ios)} (${pos(ios)})`;
  if (ios?.phase === "vpn") return VPN_WAIT;
  if (ios?.phase === "busy") return busyText(label(ios)); // B312
  if (ios?.phase === "copying") return `Copying ${label(ios)} to iPhone (${pos(ios)})`; // B111: This iPhone
  if (selfClosing(ios)) return `Installing ${label(ios)}: ${SELF_CLOSING}`;
  if (ios) return ios.state === "asking" && promptUp(ios) ? `Tap Install for ${label(ios)} (${pos(ios)})` : `Installing ${label(ios)} (${pos(ios)})`;
  const s = rows.filter((r) => SIGNING.has(r.state));
  if (s.length && s.every(helperRow)) return "Preparing";
  if (s.length === 1) return `${s[0].state === "signing" ? "Signing" : "Downloading"} ${label(s[0])} (${pos(s[0])})`;
  if (s.length) return `Signing ${s.length} apps`;
  return "Preparing";
}

// Each row counts 1 once ended: half for its download and signing, half for iOS's install. B111: on This iPhone that
// half is the copy (a fifth) and installd's percent (the rest), so the bar follows both to 100%.
// B152: rowProgress is that weight for one row as it stands; the run keeps the most it reached (row.progress), so
// stages that each start at 0 (the signer's reading then signing, iOS's prompt then its install) never pull it back.
export function rowProgress(r) {
  const f = Math.max(0, Math.min(1, Number(r?.fraction) || 0));
  if (ended(r)) return 1;
  if (r?.state === "installing" && r.phase === "copying") return 0.5 + 0.1 * f;
  if (r?.state === "installing" && r.here) return 0.6 + 0.4 * f;
  if (r?.state === "downloading") return 0.25 * f;
  if (r?.state === "signing") return 0.25 + 0.25 * f;
  if (r?.state === "signed" || r?.state === "asking") return 0.5;
  if (r?.state === "installing") return 0.5 + 0.5 * f;
  return 0;
}

// The row's bar: the most it reached in this try (row.progress), or where it stands for a row the run hasn't set.
export const barOf = (r) => (ended(r) ? 1 : Math.max(Number(r?.progress) || 0, rowProgress(r)));

export function runPercent(rows) {
  if (!rows.length) return 100;
  let n = 0;
  for (const r of rows) n += barOf(r);
  return Math.round((n / rows.length) * 100);
}

export const isSelf = (row) => row?.id === SELF_ID;

// B173: iFizBox's own row on the This iPhone route once installd took it (phase "installing", any percent, the copy
// over): the shell is closing iFizBox so iOS can finish -> true. Copying, a prompt, or another app: false.
export const selfClosing = (row) =>
  Boolean(row && isSelf(row) && row.here && row.state === "installing" && row.phase === "installing" && row.mode !== "resign");

// B159: iFizBox's own upgrade (job.version newer than job.installed, the running version) whose signed IPA
// (signing.prepare's version, its CFBundleShortVersionString) isn't newer than the running app: the update must
// install the version it offered (user 2026-11-20: 0.13.0 offered, the source's 0.12.0 IPA signed and installed).
// -> the row's error, or null (not iFizBox, not an upgrade, a re-sign, no version to compare, or newer).
export function staleSelf(row, res) {
  const j = row?.job;
  if (!isSelf(row) || row.mode === "resign" || !j?.installed || !j.version || !res?.version) return null;
  if (!isNewer(j.version, j.installed) || isNewer(res.version, j.installed)) return null;
  return `the downloaded IPA is ${NAME} ${res.version}, not newer than this ${NAME} ${j.installed} (${j.version} was offered), so it wasn't installed`;
}

// B137: whether an "asking" row has iOS's Install prompt to tap. A row on the This iPhone route (`local`, from
// createAppRun's local(row)) has none while its route is settled (idevice.status, the LocalDevVPN alert); it says
// Installing. Its install going through the Signing Server after all sends phase "asking": the prompt is up then.
export const promptUp = (row) => !row?.local || row.phase === "asking";
