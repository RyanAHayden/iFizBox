// F235: the IPA queue's run (app pages' Install / Upgrade, Changes' Upgrade (N), Re-sign and Re-sign All through the
// app Confirm) on F234's black page with rows (nav/progress.js; the brain is core/apprun.js; the looks are
// progress.css's .qr-* rows, shared with screens/queuerun.js):
//
//   Apps (the default; a run of one app opens on the Log instead): one row per queued app, in the run's order (iFizBox's own IPA last): its name, a grey line
//     (Waiting / Downloading 12.0 of 48.0 MB / Signing 40% / Signed / Tap Install on the iOS prompt / Installing /
//     Installed / Re-signed, expires <date> / Failed: why / Cancelled), an iOS 6 progress bar while it works, and the
//     round stop button on a working row: it cancels only that app (its download, its signing or iOS's prompt) and the
//     next goes on. A failed or cancelled row's tap retries it once the run has ended; a "Tap Install on the iOS
//     prompt" row's tap shows iOS's prompt for it again (B85, signing.reprompt: the user dismissed it); any other row
//     opens the Log with that app's lines only. A prompt that closed without iOS asking for the IPA (the user's Cancel,
//     or iOS couldn't reach iFizBox: it can't tell which) ends its row "Failed: iOS didn't download it" and the next
//     app goes on; that row's tap (Try Again) asks iOS again with the IPA still served (B91: the Signing Server's copy
//     after a freeze), and only that tap opens a new prompt. A row the App Store's install coordinator blocked (IX
//     Code 46, "Failed: the App Store version is installed. Delete it, then Retry, or tap to install it with its own
//     bundle ID") goes again on its tap with Keep Bundle IDs off for that app (run.ownIdRetry); the Log's red line is
//     that same short line, installd's error grey below it. The summary ("2 installed, 1 failed") ends the list and the log.
//   Log: one line per phase per app (Downloading Delta 48 MB, Signed Delta, Asked iOS to install Delta, Installed
//     Delta / the reason it failed) with the shell's own lines grey under its app. Percents only move the rows' bars
//     and the bottom status.
//   The nav bar, as F234's (B224: Cydia's on the 4S, "Running" then "Complete", plain buttons; Apps | Log on a band
//     under it): Cancel at the top left while it runs (every app not finished is abandoned; then the app Confirm
//     again with what finished cleared and the footer "Stopped. N installed and cleared from the queue."), Retry All
//     at the top right after failures (Close at the top left), no bar buttons when clean. A pass that starts after the run ended (Retry All, a
//     row's retry, Try Again) empties the Log first: the last pass's lines belong to it only (B153).
//   The bottom: the status and the bar while it runs, then Return to iFizBox. When iFizBox's own IPA went to iOS
//     (B123, followSelf): locked on "Waiting for iOS" while the shell waits for iOS to download it, "Closing iFizBox"
//     once the shell closes, Try Again (the row Failed) when iOS never took it, and an honest "close it from the app
//     switcher" with Return wherever iFizBox didn't close by itself.
//
// What iOS took leaves the queue (and is recorded for Installed) as it goes; failed and cancelled apps stay queued.
// An app handed to iOS while iFizBox was in the background ends "Sent to iOS", and turns Installed once iOS says it has
// it when iFizBox is back in front (followHandoff, B76).
// B175: a finished run's page closes when iFizBox is back in front or a link comes (incoming.js, through runPage()).
// SPDX-License-Identifier: GPL-3.0-or-later
import { el, barButton } from "../nav/ui.js";
import { openProgress, openOn, RETURN_LABEL, CLOSING_LABEL, WAITING_LABEL, TRY_AGAIN_LABEL, CLOSE_GRACE, CLOSE_BY_HAND,
  RESTART_BY_HAND } from "../nav/progress.js";
import { fitFileNames } from "../core/midtrunc.js";
import { appRows, createAppRun, rowStatus, summaryLine, runStatus, runPercent, ended, isSelf, DIDNT_DOWNLOAD, barOf } from "../core/apprun.js";
import { recordWhen } from "../core/apprun.js"; // B136
import { apps as appStore, undoRecord } from "../core/installed.js"; // B170
import { SELF_UPDATE_LINES, SELF_UPDATE_FAILED, HERE_CLOSING_LINE, DOWNLOAD_HINT, DOWNLOAD_BY_HAND } from "../signing/selfupdate.js";
import { nativeBridge, hasNativeCall } from "../native.js";

// The phone's side of a run, from signing-client.js (prepareOnDevice, openPrepared, discardPrepared). Each attempt of a
// row gets its own tag, so signing.cancel {tag} stops that try only.
// B139: the shell remembers cancelled tags for its whole life (native SignJob: a job begun under one starts cancelled),
// so the tags carry this run's own id (`run`): a new run of the same queue counting from #1 again reused a tag an
// earlier run's Stop or Cancel had cancelled, and that app ended "Failed: Cancelled" though nobody cancelled it.
// F287: the backend's keepAwake (backend-native.js: the shell's idle timer; backend-http.js: Screen Wake Lock), loaded
// only where there is a screen to keep on (the app's bridge, or a browser with navigator.wakeLock): never in node.
const screenAwake = (on) => (hasNativeCall() || globalThis.navigator?.wakeLock
  ? import("../backend.js").then((m) => m.getBackend().keepAwake?.(on)) : undefined);

// B175: the app run's page that is up, or null: { busy (the run works, or iFizBox's own update waits locked for iOS),
// aside (put aside by Open Now), ended() (a promise for the run being over, or the page gone), dismiss() (closes it;
// rows iOS hasn't confirmed are still asked about), putAside() }. incoming.js closes a finished one before a link.
let shown = null;
export const runPage = () => shown;

// B278: a record of an installed app that didn't land is written again this many times, this far apart (and on each
// of RECORD_FRONTS returns to the front)
export const RECORD_TRIES = 5;
export const RECORD_RETRY = 3000;
export const RECORD_FRONTS = 3;

let runs = 0;
export const laneRunId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${++runs}`;
export function phoneLanes(sc, { native, run = laneRunId() } = {}) {
  let n = 0;
  const tagOf = (r) => `${r.id}#${++n}${run ? `@${run}` : ""}`;
  const served = new Map(); // B91: row id -> the tag its served IPA runs under (Try Again's Stop stops that serving)
  return {
    sign: (r, { signal, progress }, log = () => {}) => sc.prepareOnDevice(r.job, { tag: tagOf(r), signal, progress, log, native }),
    install: (r, { signal, progress, again = false }, log = () => {}) => {
      const tag = (again && served.get(r.id)) || tagOf(r);
      served.set(r.id, tag);
      return sc.openPrepared(r, { tag, signal, progress, log, host: isSelf(r), native, ...(again ? { again: true } : {}) });
    },
    discard: (r) => sc.discardPrepared(r.token, native),
    // B123: iFizBox's own update once its IPA is with iOS (signing.selfUpdate): onState(state) -> the last state | null
    selfUpdate: (onState) => (sc.watchSelfUpdate ? sc.watchSelfUpdate(onState, native) : Promise.resolve(null)),
    // B85: the "Tap Install on the iOS prompt" row's tap: iOS's prompt for that app again
    reprompt: (r) => sc.repromptPrepared?.(r, native) ?? false,
    // B111: a This iPhone install's Open <app> (iOS has it the moment the row ends)
    open: (r) => {
      const n = native ?? nativeBridge();
      try { Promise.resolve(n?.call?.("signing.openApp", { bundleId: r.bundleId })).catch(() => {}); } catch { /* no bridge */ }
    },
    // B76: which of these apps iOS has now ({ bundleId: true | false | null }); apps.isInstalled works in both builds
    isInstalled: async (bundleIds) => {
      const n = native ?? nativeBridge();
      if (!n?.call) return {};
      try { return (await n.call("apps.isInstalled", { bundleIds }))?.installed ?? {}; } catch { return {}; }
    },
  };
}

// B71a: the jailbreak app's side of a run: no signing. The "sign" lane only checks the IPA's own MinimumOSVersion
// (ipa-install.js ipaNeeds, B72: nothing is downloaded for an app this iPhone's iOS can't run); the install lane hands
// the IPA to the helper's install-ipa (ipa-install.js runIpaInstall: the shell downloads it, installd installs it, its
// lines and percent on the row) or a Remove to the helper's uninstall-app (backend.uninstallApp, the Installed tab's
// Delete). Rows' jobs carry `helper: true` (core/apprun.js helperRow: its words). Every call can be stood in for (tests).
export function helperLanes({ backend, install, needs, native } = {}) {
  return {
    sign: async (r) => {
      if (r.job?.op !== "remove") {
        const n = needs ? await needs(r.job.url).catch(() => null) : null;
        if (n) throw new Error(`needs iOS ${n.min} (this iPhone has ${n.ios})`);
      }
      return { token: r.job?.op === "remove" ? "remove" : r.job?.url || "ipa", bundleId: r.id };
    },
    install: async (r, { signal, progress }, log = () => {}) => {
      progress("installing", 0);
      if (r.job?.op === "remove") {
        if (typeof backend?.uninstallApp !== "function") throw new Error("This build can't delete apps.");
        await backend.uninstallApp(r.id, (ev) => {
          const line = String(ev?.line ?? "").trim();
          const m = /^pmstatus:[^:]*:([\d.]+):(.+)$/.exec(line);
          if (m) progress("installing", Number(m[1]) / 100);
          else if (line) log(line);
        });
        return { installed: true };
      }
      const view = {
        line: (type, text) => { if (type !== "status") log(type === "error" ? `E: ${text}` : text); },
        status: () => {},
        progress: (pct) => progress("installing", Math.min(99, Number(pct) || 0) / 100),
      };
      const res = await install({ url: r.job.url, name: r.name }, view, { ...(native ? { native } : {}), signal });
      if (res?.cancelled) throw new Error("cancelled");
      if (!res?.ok) throw new Error(res?.error?.message || res?.error?.title || "the helper didn't install it");
      return { installed: true };
    },
    discard: () => {},
  };
}

// B76: iFizBox leaving the screen while an app is with iOS hands that app to iOS (run.away(): a false from the watch
// then reads "Sent to iOS", not Failed), and coming back asks iOS which "Sent to iOS" rows it has (run.confirm: Installed).
// Also asked when such a row ends while iFizBox is in front. -> { check, stop }
// B136: `answered(row, onPhone)` hears iOS's answer for each row asked (true, false, or null when iOS gave none), so
// the run records an app only once iOS has it (core/apprun.js recordWhen).
// B156: a "no" can come while iOS is still installing (the icon still loading on the home screen), and nothing asked
// again, so the app was never recorded. A row iOS said no to is asked again every `retryMs`, `tries` times, while
// iFizBox is in front; stop() ends it.
// B170: no answer (null: the user's Cancel on iOS's own prompt looks like this) is asked again the same way and on each
// return to the front (which starts the tries over); it never counts as installed. A row that was "Sent to iOS" stays
// asked after iOS confirmed it: a later false turns it "Sent to iOS" again (run.unconfirm) and answered(row, false)
// lets the page undo its record.
export function followHandoff(run, rows, { isInstalled, doc = globalThis.document, answered = () => {}, retryMs = 5000, tries = 12,
  later = (f, ms) => { const t = setTimeout(f, ms); t?.unref?.(); return t; }, clear = (t) => clearTimeout(t) } = {}) {
  const hidden = () => doc?.visibilityState === "hidden";
  let asking = false;
  let timer = null;
  let left = tries;
  let stopped = false;
  const handed = new Set(); // B170: ids of rows that ended "Sent to iOS" in this run
  const again = () => {
    if (stopped || timer || left <= 0) return;
    left--;
    timer = later(() => { timer = null; check(); }, retryMs);
  };
  const check = async () => {
    if (!isInstalled || asking || hidden()) return;
    for (const r of rows) if (r.state === "installed" && r.unsure) handed.add(r.id);
    const sent = rows.filter((r) => r.state === "installed" && handed.has(r.id) && r.mode !== "resign" && r.bundleId && !isSelf(r));
    if (!sent.length) return;
    asking = true;
    let answer = {};
    try { answer = (await isInstalled(sent.map((r) => r.bundleId))) ?? {}; } catch { /* unknown: they stay sent */ }
    asking = false;
    let open = false;
    for (const r of sent) {
      const v = typeof answer[r.bundleId] === "boolean" ? answer[r.bundleId] : null;
      if (v === true) run.confirm(r.id);
      if (v === false && !r.unsure) run.unconfirm?.(r.id); // B170: iOS no longer has it
      if (v !== true) open = true;
      try { answered(r, v); } catch { /* the page's bug isn't the check's */ }
    }
    if (open) again(); // B156; B170: an unknown is asked again too
  };
  const onVisibility = () => {
    if (hidden()) { run.away(); return; }
    left = tries; // B170: each return to the front asks again from the start
    check();
  };
  doc?.addEventListener?.("visibilitychange", onVisibility);
  // B175: the page closed by itself (iFizBox back in front with the run over): no more visibility changes, but the
  // question for the rows iOS hasn't confirmed is asked now and its retries run out (an app installed while iFizBox
  // was away is still recorded).
  const wind = () => {
    if (stopped) return;
    doc?.removeEventListener?.("visibilitychange", onVisibility);
    left = tries;
    check();
  };
  return { check, wind, stop: () => {
    stopped = true;
    if (timer) { clear(timer); timer = null; }
    doc?.removeEventListener?.("visibilitychange", onVisibility);
  } };
}

// jobs: the app queue's (core/appqueue.js). deps: { queue, lanes ({ sign, install, discard }, phoneLanes's),
//   record(job) (Installed's record of an install), reopenConfirm(footer), onClose(result), open (openProgress, tests),
//   stallMs, later, clear (tests), finish(result) (B71a: { label, action } for the bottom button, or null),
//   onAppEnd(row, recorded) (B264: an app's install or re-sign has just ended: the badge counts again; `recorded`
//   settles once Installed's record of it is written, null when none is) } ->a promise for the first end: { ok, stopped, rows, installed }.
export async function runAppRun(jobs, deps) {
  const { queue, lanes, record = async () => {}, reopenConfirm = () => {}, open = openProgress, onAppEnd = () => {} } = deps;
  const page = open({ title: "Running" });
  const rows = appRows(jobs);

  // ---- the log ----
  const line = (kind, text, id = null) => { if (text) page.line(kind, text, id); };

  // ---- Apps ----
  const pane = el("div", "qr-pane");
  const list = el("ul", "qr-list");
  const summary = el("li", "qr-summary");
  summary.hidden = true;
  pane.append(list);
  page.pane(pane);
  const seg = page.segmented(["Apps", "Log"], (i) => {
    if (i === 0) { page.filter(null); page.view("pane"); } else page.view("log");
  });
  openOn(page, seg, rows.length); // F247: one app opens on the Log
  const showLog = (id) => { seg.select(1); page.filter(id); page.view("log"); };

  const views = new Map();
  for (const r of rows) {
    const li = el("li", "qr-row");
    const main = el("button", "qr-main");
    main.type = "button";
    const name = el("div", "qr-name", r.name);
    const status = el("div", "qr-status");
    const bar = el("div", "qr-bar");
    const fill = el("div", "qr-fill");
    bar.append(fill);
    main.append(name, status, bar);
    const act = el("button", "qr-stop");
    act.type = "button";
    act.setAttribute("aria-label", `Stop ${r.name}`);
    li.append(main, act);
    list.append(li);
    main.addEventListener("click", () => {
      if (!run.running && r.state === "failed" && r.busy) ownId(r.id); // B151: the App Store holds its bundle ID
      else if (!run.running && (r.state === "failed" || r.state === "cancelled")) retry(r.id);
      else if (r.state === "asking" && lanes.reprompt) run.reprompt(r.id); // B85: the prompt again
      else showLog(r.id);
    });
    act.addEventListener("click", () => run.stop(r.id));
    views.set(r.id, { li, status, bar, fill, act });
  }
  list.append(summary);
  fitFileNames(list); // B92: an app still known by its file name is cut in the middle, keeping the end and .ipa
  const WORKING =["downloading", "signing", "signed", "asking", "installing"];
  const draw = (r) => {
    const v = views.get(r.id);
    if (!v) return;
    v.li.dataset.state = r.state;
    v.status.textContent = rowStatus(r);
    const busy = ["downloading", "signing", "asking", "installing"].includes(r.state);
    v.bar.hidden = !busy;
    // B152: the app's whole way (barOf: download, signing, iOS's install by weight), never backwards; it sweeps only
    // until the first percent, so it doesn't flip between the sweep and the fill at each stage
    const fill = barOf(r);
    v.bar.classList.toggle("is-indeterminate", !(fill > 0));
    v.fill.style.transform = `scaleX(${fill})`;
    v.act.hidden = !WORKING.includes(r.state) || run.stopping;
  };

  // ---- the run ----
  const cleared = new Set();
  // B136: Installed's record of an app is written once iOS confirmed it (recordWhen), not when a row ends "Sent to
  // iOS": an install iOS never fetched (B128) left the app recorded, and its Search row's swipe did nothing.
  // B170: a row the user cancelled, or one iOS never confirmed (no answer included), is never recorded. Each record
  // keeps the record it replaced, so iOS reporting the app missing later puts that one back (undoRecord).
  // B236: on iOS 27 (no answer for any app) a row whose IPA iOS fetched in full is recorded on the no-answer.
  const store = deps.store ?? appStore;
  const recordOf = async (id) => {
    try { return (await (await store()).all()).find((x) => x.id === id) ?? null; } catch { return null; }
  };
  const recorded = new Map(); // row id -> a promise for { before, wrote } (Installed's record of the app around it)
  const recordIf = (r, onPhone) => {
    if (recorded.has(r.id) || recordWhen(r, onPhone) !== "now") return;
    const id = r.job?.id ?? r.id;
    const p = Promise.resolve().then(async () => {
      const before = await recordOf(id);
      try { await record(r.job); } catch (e) { return missedRecord(r, onPhone, p, before, e); }
      forget(r);
      return { before, wrote: await recordOf(id), ok: true };
    });
    recorded.set(r.id, p);
  };
  // B278: a record that didn't land (record threw: in the background iOS can suspend the page's IndexedDB in the
  // middle of the write) is written again, RECORD_TRIES times RECORD_RETRY apart and on each return to the front,
  // instead of the app staying at its old version in Installed and Changes keeping its upgrade. A This iPhone install
  // ends confirmed, so nothing else would ever ask for its record again.
  // One timer at a time per row; RECORD_FRONTS returns to the front at most, then it gives up (a store that never
  // works again, until iFizBox restarts). The Log says so on the first failure and when it gives up.
  const missed = new Map(); // row id -> { onPhone, left, fronts, waiting }
  const doc = deps.doc ?? globalThis.document;
  const retryLater = deps.later ?? ((f, ms) => { const t = setTimeout(f, ms); t?.unref?.(); return t; });
  const forget = (r) => { if (missed.delete(r.id) && !missed.size) doc?.removeEventListener?.("visibilitychange", onFront); };
  const recordAgain = (r) => {
    const m = missed.get(r.id);
    if (!m || recorded.has(r.id)) return;
    recordIf(r, m.onPhone);
    const p = recorded.get(r.id);
    // written now: the badge counts again (B264), as at the app's end
    if (p) p.then((x) => { if (x?.ok) try { onAppEnd(r, p); } catch { /* counted on the next open */ } }, () => {});
    else forget(r); // the row changed (retried, failed): nothing to record now
  };
  const onFront = () => {
    if (doc?.visibilityState === "hidden") return;
    for (const r of rows) {
      const m = missed.get(r.id);
      if (!m) continue;
      if (m.fronts-- <= 0) { forget(r); line("raw", `Couldn't record ${r.name || r.id} as installed`, r.id); continue; }
      m.left = RECORD_TRIES;
      recordAgain(r);
    }
  };
  const missedRecord = (r, onPhone, p, before, e) => {
    if (recorded.get(r.id) === p) recorded.delete(r.id); // a later recordIf may write it again
    let m = missed.get(r.id);
    if (!m) {
      m = { onPhone, left: RECORD_TRIES, fronts: RECORD_FRONTS, waiting: false };
      if (!missed.size) doc?.addEventListener?.("visibilitychange", onFront);
      missed.set(r.id, m);
      line("raw", `Couldn't record ${r.name || r.id} as installed (${e?.message || e}); trying again`, r.id);
    }
    if (!m.waiting && m.left-- > 0) {
      m.waiting = true;
      retryLater(() => { m.waiting = false; recordAgain(r); }, RECORD_RETRY);
    }
    return { before, wrote: null, ok: false };
  };
  const unrecord = (r) => {
    const p = recorded.get(r.id);
    if (!p) return;
    recorded.delete(r.id);
    p.then(async ({ before, wrote }) => {
      if (!wrote || (before && wrote.date === before.date)) return; // nothing was written (a re-sign, iFizBox)
      await (deps.unrecord ? deps.unrecord(r.job, before, wrote) : undoRecord(await store(), wrote.id, before, wrote));
      line("step", `${r.name || r.id} is no longer recorded as installed`, r.id);
    }).catch(() => {});
  };
  const answered = (r, onPhone) => { if (onPhone === false) unrecord(r); else recordIf(r, onPhone); };
  let sentSelf = false;
  const run = createAppRun({
    rows,
    sign: (r, hooks) => lanes.sign(r, hooks, (text) => line("raw", text, r.id)),
    install: (r, hooks) => lanes.install(r, hooks, (text) => line("raw", text, r.id)),
    discard: (r) => lanes.discard(r),
    ...(lanes.reprompt ? { reprompt: (r) => lanes.reprompt(r) } : {}),
    ...(lanes.local ? { local: (r) => lanes.local(r) } : {}), // B137: This iPhone: no iOS prompt to tap
    ...(deps.stallMs ? { stallMs: deps.stallMs } : {}),
    ...(deps.later ? { later: deps.later, clear: deps.clear } : {}),
    keepAwake: deps.keepAwake ?? screenAwake, // F287: the screen stays on while the run works
    onChange: (r) => {
      draw(r);
      const endedNow = r.state === "installed" && !cleared.has(r.id);
      if (endedNow) {
        cleared.add(r.id);
        if (isSelf(r)) sentSelf = true;
        queue.clear(r.id);
        if (r.unsure) Promise.resolve().then(() => handoff?.check()); // B76: iOS may have it already
      }
      recordIf(r); // B136: only once iOS has it (a confirm comes back here with unsure off)
      // B264: after the record above is asked for (`recorded`: its promise, when one was written), so the count sees it
      if (endedNow) try { onAppEnd(r, recorded.get(r.id) ?? null); } catch { /* the badge counts again on the next open */ }
      tick();
    },
    onLog: ({ id, kind, text }) => line(kind, text, id),
    onStart: (pass) => { if (pass > 1) clearLog(page); }, // B153: a new pass on this page starts with a clean log
  });
  const isInstalled = deps.isInstalled ?? lanes.isInstalled;
  const handoff = followHandoff(run, rows, { isInstalled, answered,
    ...(deps.doc ? { doc: deps.doc } : {}) });
  let winding = false; // B175: closed by dismiss(): the follow winds down instead of stopping
  page.onClose?.(() => (winding && handoff.wind ? handoff.wind() : handoff.stop()));
  let tickQueued = false;
  const tick = () => {
    if (tickQueued) return;
    tickQueued = true;
    Promise.resolve().then(() => {
      tickQueued = false;
      if (run.stopping) page.status("Stopping…");
      else if (run.running) page.status(runStatus(rows));
      page.progress(runPercent(rows));
    });
  };

  // ---- the bar ----
  const cancel = barButton("Cancel"); // B224: Cydia's plain Cancel at the top left, not red
  const closeB = barButton("Close");
  const retryAll = barButton("Retry All");
  let cancelled = false;
  cancel.addEventListener("click", () => {
    if (cancel.disabled) return;
    if (run.cancel()) { cancelled = true; cancel.disabled = true; for (const r of rows) draw(r); tick(); }
  });
  closeB.addEventListener("click", () => page.close());
  retryAll.addEventListener("click", () => { const p = run.retryAll(); if (p) drive(p); });
  const retry = (id) => { const p = run.retry(id); if (p) drive(p); };
  const ownId = (id) => { const p = run.ownIdRetry(id); if (p) drive(p); };

  let first = null;
  let latest = null;
  let settled = () => {}; // B175: wakes runPage().ended() once the run is over
  if (deps.onClose) page.onClose(() => deps.onClose(latest));

  async function drive(promise) {
    cancelled = false;
    page.reopen({ title: "Running", status: runStatus(rows) });
    cancel.disabled = false;
    summary.hidden = true;
    page.bar({ left: cancel });
    for (const r of rows) draw(r);
    await promise;
    return end(cancelled);
  }

  async function end(wasCancel) {
    for (const r of rows) draw(r);
    tick();
    const installed = rows.filter((r) => r.state === "installed");
    const bad = rows.filter((r) => r.state === "failed" || r.state === "cancelled");
    const text = summaryLine(rows);
    summary.textContent = text;
    summary.hidden = false;
    line("step", text);
    const result = { ok: !bad.length, stopped: wasCancel, rows, installed: installed.length };
    if (!first) first = result;
    latest = result;
    if (wasCancel) {
      // Cancel: back to the app Confirm with what finished cleared, and a footer that says so
      await page.close();
      if (queue.size) reopenConfirm(`Stopped. ${installed.length} installed and cleared from the queue.`);
      return result;
    }
    page.bar(bad.length ? { left: closeB, right: retryAll } : {}); // B224: a clean end has none, as the 4S's Complete
    // B49: iFizBox's own IPA is with iOS, which closes iFizBox to install it: nothing to tap
    const fin = sentSelf ? null : deps.finish?.(result); // B71a: the jailbreak run's (AppSync Unified's respring)
    const opener = sentSelf || fin ? null : openRow(rows, lanes); // B111: one app installed on This iPhone
    if (sentSelf) followSelf(text);
    else if (fin) page.finish({ label: fin.label, status: text, action: fin.action ?? (() => false) });
    else if (opener) page.finish({ label: RETURN_LABEL, status: text, action: () => false, also: opener });
    else page.finish({ label: RETURN_LABEL, status: text, action: () => false });
    if (page.hidden) page.show?.(); // B175: put aside for a link (Open Now): back with its result
    settled();
    return result;
  }

  // B123: iFizBox's own IPA went to iOS. Hosted (iOS's prompt): the page locks on "Waiting for iOS" and follows the
  // shell's signing.selfUpdate (native CloseForUpdate), a line a step; "Closing iFizBox" only once the shell says it
  // closes (finished, or an older server's guess), and if iFizBox is still here CLOSE_GRACE later, or the shell can't
  // be followed, the page says to close it from the app switcher. notStarted / stalled: iOS never took it, so the row
  // turns Failed, back in the queue, with Try Again. This iPhone: installd ends iFizBox while it installs over it, so
  // the run ending at all means it didn't: the new version is in place, close it by hand.
  let following = null; // the self row being followed (one follow per send)
  let selfEnd = null; // the follow's latest finish, drawn again when another row's retry ends
  const later = deps.later ?? ((f, ms) => { const t = setTimeout(f, ms); t?.unref?.(); return t; }); // node: don't hold tests
  const selfFinish = (o) => { selfEnd = o; page.finish(o); settled(); };
  function followSelf(text) {
    const self = rows.find((r) => isSelf(r) && r.state === "installed");
    if (!self) return page.finish({ label: RETURN_LABEL, status: text, action: () => false });
    if (following === self && selfEnd) return page.finish({ ...selfEnd, status: text });
    following = self;
    if (self.here) return followHere(self, text);
    selfFinish({ label: WAITING_LABEL, status: text, locked: true });
    const watch = deps.selfUpdate ?? lanes.selfUpdate;
    let closing = false;
    let last = null;
    const live = () => following === self && !page.closed;
    const byHand = () => {
      if (!live()) return;
      line("error", CLOSE_BY_HAND, self.id);
      selfFinish({ label: RETURN_LABEL, status: text, action: () => false });
    };
    let hinted = false;
    // B208: iOS is downloading it and the shell hasn't closed DOWNLOAD_HINT later: how to close it by hand, unlocked
    // (Return), still following (a later finished/guessed locks on Closing again)
    const hint = () => {
      if (!live() || closing) return;
      line("step", DOWNLOAD_BY_HAND, self.id);
      selfFinish({ label: RETURN_LABEL, status: text, action: () => false });
    };
    const onState = (s) => {
      if (!live()) return;
      if (s && s !== last && SELF_UPDATE_LINES[s]) { last = s; line("step", SELF_UPDATE_LINES[s], self.id); }
      if (s === "downloading" && !hinted) { hinted = true; later(hint, DOWNLOAD_HINT); }
      if ((s === "finished" || s === "guessed") && !closing) {
        closing = true;
        selfFinish({ label: CLOSING_LABEL, status: text, locked: true });
        later(byHand, CLOSE_GRACE);
      }
    };
    const over = (s) => {
      onState(s);
      if (!live() || closing) return;
      if (!SELF_UPDATE_FAILED[s]) return byHand(); // an older shell, or none running: nothing will close it
      line("error", SELF_UPDATE_FAILED[s], self.id);
      if (!run.notTaken(self.id, s === "stalled" ? "iOS stopped downloading it" : DIDNT_DOWNLOAD)) return byHand();
      following = null;
      selfEnd = null;
      sentSelf = false;
      cleared.delete(self.id);
      if (!queue.get?.(self.id)) queue.add?.(self.job, { quiet: true });
      const now = summaryLine(rows);
      summary.textContent = now;
      page.bar({ left: closeB, right: retryAll });
      page.finish({ label: TRY_AGAIN_LABEL, status: now, title: "Not Updated", action: () => { retry(self.id); return true; } });
      settled();
    };
    if (typeof watch !== "function") return onState("guessed"); // no shell to follow: Closing, then by hand if it didn't
    Promise.resolve().then(() => watch(onState)).then(over, () => over(null));
  }

  // B159: This iPhone: on iOS 17.4+ installd waits for the running iFizBox to go, so the shell answered once installd
  // stood still and is closing itself (signing.selfUpdate "finished"): locked on "Closing iFizBox", and close it by
  // hand if it is still here CLOSE_GRACE later. Any other answer (installd installed it while iFizBox lived, an older
  // shell): the new version is in place, close it by hand (RESTART_BY_HAND).
  function followHere(self, text) {
    const restart = () => {
      line("step", RESTART_BY_HAND, self.id);
      selfFinish({ label: RETURN_LABEL, status: text, action: () => false });
    };
    const watch = deps.selfUpdate ?? lanes.selfUpdate;
    if (typeof watch !== "function") return restart();
    const live = () => following === self && !page.closed;
    selfFinish({ label: CLOSING_LABEL, status: text, locked: true });
    const over = (s) => {
      if (!live()) return;
      if (s !== "finished") return restart();
      line("step", HERE_CLOSING_LINE, self.id);
      later(() => {
        if (!live()) return;
        line("error", CLOSE_BY_HAND, self.id);
        selfFinish({ label: RETURN_LABEL, status: text, action: () => false });
      }, CLOSE_GRACE);
    };
    Promise.resolve().then(() => watch(() => {})).then(over, () => over(null));
  }

  // B175: this page as runPage() hands it out while it is up
  const waiters = [];
  const busy = () => !page.closed && (run.running || run.stopping || Boolean(selfEnd?.locked && following));
  settled = () => { if (!busy()) for (const f of waiters.splice(0)) f(); };
  let closing = null;
  const handle = {
    get busy() { return busy(); },
    get aside() { return Boolean(page.hidden); },
    ended: () => (busy() ? new Promise((f) => waiters.push(f)) : Promise.resolve()),
    dismiss() {
      if (!closing) { winding = true; closing = Promise.resolve(page.close()).catch(() => {}); }
      return closing;
    },
    // Open Now: the page slides away while the run goes on (end() brings it back)
    putAside() { page.hide?.(); },
  };
  shown = handle;
  page.onClose?.(() => { if (shown === handle) shown = null; for (const f of waiters.splice(0)) f(); });

  // every row starts drawn
  for (const r of rows) draw(r);
  const p = run.start();
  return drive(p).then(() => first, () => first);
}

// B153: the page's log emptied for a new pass (Retry All, a failed row's tap, Try Again, the own-bundle-ID retry after
// the run ended): the lines still waiting for a frame go out first, then every line goes, so none of the last pass's
// ("Downloading X", "X: Cancelled", "1 failed") show under the new one. A page with its own clear() uses that.
export function clearLog(page) {
  if (!page) return;
  if (typeof page.clear === "function") { page.clear(); return; }
  page.flush?.();
  page.out?.replaceChildren?.();
}

// B111: a run of one app that installd installed on This iPhone (row.here, not iFizBox itself) ends with Open <app>
// above Return, as the single install does -> page.finish's `also` ({ label, action }) or null. An upgrade too (B297):
// the new version is in place the same way; a re-sign is not a new app to open.
const OPEN_MODES = new Set(["install", "upgrade"]);
export function openRow(rows, lanes) {
  if (rows.length !== 1 || typeof lanes?.open !== "function") return null;
  const r = rows[0];
  if (r.state !== "installed" || !r.here || r.unsure || !OPEN_MODES.has(r.mode) || !r.bundleId || isSelf(r)) return null;
  return { label: `Open ${r.name}`, action: () => { lanes.open(r); return false; } };
}

export { ended };
