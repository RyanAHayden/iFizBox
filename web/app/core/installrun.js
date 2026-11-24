// F234: the install queue run where one failure doesn't stop the rest (Sileo's queue, the iOS 6 look). Pure JS, no
// DOM: the rows, their order, what a failure takes with it, the run itself, and the words the rows show. The page is
// screens/queuerun.js; the downloads and installs are backend-native.js's queueFetch / queueInstall.
//
//   runRows(plan, jobs, info)  -> [row]  one row per package apt's plan changes, in the order the dpkg lane takes
//                                         them: removals first, then each queued package after what it needs (the
//                                         queue's order otherwise), and iFizBox's own package last (only what
//                                         needs it after it: installing it closes the app). info: catalog.runInfo's { id: { debUrl, sha256,
//                                         md5sum, size, depends, preDepends, installed } } plus `installed`, the
//                                         dpkg versions of every name the rows depend on.
//   row: { id, name, op: install | remove, mode, from, to, size, debUrl, sha256, md5sum, needs: [[{ name, op?,
//          version? }]], added (apt pulled it in), neededBy: [ids], state, error, cause, done, total, viaApt }
//   neededBy(plan, jobs, info)  -> { id: [ids] }  Confirm's "needed by X" under a package apt added
//   deadRows(rows, installed)  -> Map(id -> cause id)  the rows that can't install any more because something they
//                                         need failed (or was skipped, or cancelled): each with the failure at its root
//   createInstallRun({ rows, installed, fetch, install, downloads = 3, hold, onChange, onLog })
//       hold() -> true       F407: the dpkg lane waits (downloads go on) until it says false and .resume() is called
//       fetch(row, hooks)   -> { file } | { viaApt: true }   the download (hooks: { signal, progress(fraction 0..1) });
//                              viaApt: the shell couldn't fetch it, so the install step lets apt download it
//       install(row, hooks) -> { ok, error? }                 dpkg's turn (hooks: { log(kind, text) })
//     .start() -> a promise for the end (every row installed, failed, skipped or cancelled)
//     .retry(id) / .retryAll() / .stop(id) / .cancel() / .rows / .running / .stopping / .current
//   rowStatus(row, names)      -> the row's grey line ("Downloading 1.2 of 4.0 MB", "Needs X, which failed")
//   summaryLine(rows)          -> "4 installed, 1 failed, 1 skipped"
//
// Two stages: downloads, `downloads` at a time in the dpkg lane's order, each with its own failure; then one dpkg
// lane installing finished downloads in that order. A row that fails takes only what needs it (deadRows: every
// alternative of one of its dependency groups failed and no installed version stands in), marked Skipped with the
// failure's name; everything else goes on. Retry puts a failed row back (and what was skipped for it); a skipped
// row's retry retries its cause first. Cancel stops the downloads at once and lets dpkg finish the package it is on.
// SPDX-License-Identifier: GPL-3.0-or-later
import { IdMap, parseRelations, satisfies } from "./apt.js";
import { MODES } from "./queue.js";
import { PACKAGE } from "../brand.js";

export const STATES = ["waiting", "downloading", "ready", "installing", "installed", "failed", "skipped", "cancelled"];
const ENDED = new Set(["installed", "failed", "skipped", "cancelled"]);
export const ended = (row) => ENDED.has(row?.state);
const DEAD = new Set(["failed", "skipped", "cancelled"]);

const relations = (st) => [...parseRelations(st?.preDepends), ...parseRelations(st?.depends)];

// apt's plan (core/queue.js parseSimulation) and the queued jobs -> the rows, in the dpkg lane's order.
export function runRows(plan, jobs = [], info = {}) {
  const queued = new IdMap(jobs.map((j, i) => [j.id, { job: j, i }]));
  const all = [];
  for (const mode of MODES) {
    for (const e of plan?.[`${mode}s`] ?? []) {
      const job = queued.get(e.id)?.job ?? null;
      const inf = info?.[e.id] ?? {};
      const remove = mode === "remove";
      all.push({
        id: e.id, name: job?.name || inf.name || null, op: remove ? "remove" : "install", mode, from: e.from ?? null, to: e.to ?? null,
        size: Number(inf.size) > 0 ? Number(inf.size) : null,
        debUrl: remove ? null : inf.debUrl ?? job?.debUrl ?? null,
        sha256: remove ? null : inf.sha256 ?? job?.debSha256 ?? null,
        md5sum: remove ? null : inf.md5sum ?? job?.debMd5 ?? null,
        linked: Boolean(job?.debUrl), // F131: a full-URL Filename (apt can't fetch it): no apt fallback
        needs: remove ? [] : relations(inf), added: !job, neededBy: [],
        state: "waiting", error: null, cause: null, done: 0, total: null, viaApt: false,
      });
    }
  }
  const byId = new IdMap(all.map((r) => [r.id, r]));
  for (const r of all) {
    for (const g of r.needs) for (const alt of g) {
      const d = byId.get(alt.name);
      if (d && d !== r && !d.neededBy.includes(r.id)) d.neededBy.push(r.id);
    }
  }
  // The lane: removals as apt listed them, then the queue's order (apt-added packages where apt listed them, after
  // the queued ones) with each row after the rows it needs.
  const rank = (r) => (queued.has(r.id) ? queued.get(r.id).i : jobs.length + all.indexOf(r));
  const base = all.filter((r) => r.op === "install").sort((a, b) => rank(a) - rank(b));
  const out = all.filter((r) => r.op === "remove");
  const seen = new Set(out.map((r) => r.id));
  const visiting = new Set();
  const visit = (r) => {
    if (seen.has(r.id) || visiting.has(r.id)) return; // a dependency loop: dpkg configures those together anyway
    visiting.add(r.id);
    for (const g of r.needs) for (const alt of g) { const d = byId.get(alt.name); if (d && d.op === "install") visit(d); }
    visiting.delete(r.id);
    seen.add(r.id);
    out.push(r);
  };
  for (const r of base) visit(r);
  return selfLast(out, byId);
}

// iFizBox's own package goes last in the lane, with only what needs it (transitively) after it: once dpkg puts the
// new Info.plist on disk the app's Replaced watcher (native App.swift) closes the app, and rows after it would never
// run. Nothing before it can need a row after it (that row needs iFizBox, so the row before would too), so the
// dependency order holds.
function selfLast(out, byId) {
  const self = out.find((r) => r.id === PACKAGE && r.op === "install");
  if (!self) return out;
  const tail = new Set([self.id]);
  for (const queue = [self]; queue.length;) {
    for (const id of queue.pop().neededBy) {
      const r = byId.get(id);
      if (r && r.op === "install" && !tail.has(id)) { tail.add(id); queue.push(r); }
    }
  }
  return [...out.filter((r) => !tail.has(r.id)), ...out.filter((r) => tail.has(r.id))];
}

// Confirm's Modifications: for each package apt added (not queued), the rows that need it.
export function neededBy(plan, jobs = [], info = {}) {
  const out = {};
  for (const r of runRows(plan, jobs, info)) if (r.added && r.op === "install" && r.neededBy.length) out[r.id] = r.neededBy;
  return out;
}

// Rows that can't install because a row they need is dead (failed, skipped, cancelled), to a fixpoint. A group is
// lost when every alternative names a dead row whose installed version (installed[name]) doesn't stand in for it;
// a name that isn't a row (installed already, or provided by something) always counts as there.
// -> Map(id -> the dead row at the root of it)
export function deadRows(rows, installed = {}) {
  const byId = new IdMap(rows.map((r) => [r.id, r]));
  const dead = new Map(); // id -> root cause id
  for (const r of rows) if (DEAD.has(r.state) && r.state !== "skipped") dead.set(r.id, r.id);
  const lost = (alt) => {
    const d = byId.get(alt.name);
    if (!d || !dead.has(d.id)) return null;
    const have = installed?.[alt.name] ?? (d.from || null);
    if (have && d.op === "install" && (!alt.op || satisfies(have, alt.op, alt.version))) return null;
    return dead.get(d.id);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rows) {
      if (dead.has(r.id) || r.op !== "install" || r.state === "installed") continue;
      for (const g of r.needs) {
        const causes = g.map(lost);
        if (causes.every((c) => c)) { dead.set(r.id, causes[0]); changed = true; break; }
      }
    }
  }
  for (const [id, c] of dead) if (id === c) dead.delete(id);
  return dead;
}

export function createInstallRun({ rows, installed = {}, fetch, install, downloads = 3, hold = () => false, onChange = () => {}, onLog = () => {} }) {
  const fetching = new Map(); // id -> AbortController-like { aborted, abort() }
  let lane = null;            // the row dpkg is on
  let stopping = false;
  let finish = null;
  let promise = null;
  const files = new Map();    // id -> what fetch gave
  const changed = (r) => { try { onChange(r); } catch { /* the page's bug isn't the run's */ } };
  const log = (r, kind, text) => { try { onLog({ pkg: r?.id ?? null, kind, text }); } catch { /* as above */ } };
  const set = (r, state, extra = {}) => { Object.assign(r, { state }, extra); changed(r); };

  // A row that failed takes what needs it out of the run (and stops their downloads).
  const replan = () => {
    for (const [id, cause] of deadRows(rows, installed)) {
      const r = rows.find((x) => x.id === id);
      if (!r || ended(r) || r === lane) continue;
      fetching.get(id)?.abort();
      fetching.delete(id);
      files.delete(id);
      set(r, "skipped", { cause, causeCancelled: verbOf(rows, cause) !== "failed" });
      log(r, "warning", `${r.name || r.id}: skipped (needs ${nameOf(rows, cause)}, which ${verbOf(rows, cause)})`);
    }
  };

  const stopper = () => {
    const ctl = { aborted: false, fns: [], abort() { if (ctl.aborted) return; ctl.aborted = true; for (const f of ctl.fns.splice(0)) { try { f(); } catch { /* stopped anyway */ } } },
      onabort(f) { if (ctl.aborted) f(); else ctl.fns.push(f); } };
    return ctl;
  };

  async function download(r) {
    const ctl = stopper();
    fetching.set(r.id, ctl);
    set(r, "downloading", { done: 0, fraction: 0, total: r.size, error: null });
    log(r, "step", `Downloading ${r.name || r.id}${r.size ? ` ${sizeText(r.size)}` : ""}`);
    let got = null, err = null;
    try {
      got = await fetch(r, { signal: ctl, progress: (fraction) => {
        if (ctl.aborted || r.state !== "downloading") return;
        r.fraction = Math.max(0, Math.min(1, Number(fraction) || 0));
        r.done = r.total ? r.fraction * r.total : 0;
        changed(r);
      } });
    } catch (e) { err = e; }
    if (fetching.get(r.id) !== ctl) return pump(); // stopped (cancel, skipped, retried): the row says why already
    fetching.delete(r.id);
    if (ctl.aborted) return pump();
    if (err) {
      set(r, "failed", { error: err?.message || String(err) });
      log(r, "error", `${r.name || r.id}: ${r.error}`);
      if (err?.detail) log(r, "raw", String(err.detail)); // the whole story (both hashes) for the log only
      replan();
    } else {
      files.set(r.id, got ?? {});
      set(r, "ready", { viaApt: Boolean(got?.viaApt), done: r.total ?? r.done });
      log(r, "step", got?.viaApt ? `${r.name || r.id}: apt downloads it as it installs` : `Downloaded ${r.name || r.id}`);
    }
    pump();
  }

  async function runLane(r) {
    lane = r;
    set(r, "installing");
    let res = null;
    try { res = await install(r, { file: files.get(r.id) ?? null, log: (kind, text) => log(r, kind, text) }); } catch (e) { res = { ok: false, error: e?.message || String(e) }; }
    files.delete(r.id);
    lane = null;
    if (res?.ok) {
      set(r, "installed", { error: null });
      log(r, "step", `${r.op === "remove" ? "Removed" : "Installed"} ${r.name || r.id}`);
    } else {
      set(r, "failed", { error: res?.error || "it failed" });
      log(r, "error", `${r.name || r.id}: ${r.error}`);
      replan();
    }
    pump();
  }

  function pump() {
    if (stopping) {
      if (!lane && !fetching.size) end();
      return;
    }
    // downloads, in lane order
    for (const r of rows) {
      if (fetching.size >= downloads) break;
      if (r.state !== "waiting") continue;
      if (r.op === "remove") { set(r, "ready"); continue; }
      download(r);
    }
    for (const r of rows) if (r.state === "waiting" && r.op === "remove") set(r, "ready");
    // the dpkg lane: the first row not ended, once it is ready
    if (!lane && !hold()) {
      const next = rows.find((r) => !ended(r));
      if (next?.state === "ready") runLane(next);
    }
    if (!lane && !fetching.size && rows.every(ended)) end();
  }

  function end() {
    stopping = false;
    const f = finish;
    finish = null;
    promise = null;
    f?.(rows);
  }

  const run = {
    rows,
    get running() { return Boolean(finish); },
    get stopping() { return stopping; },
    get current() { return lane; },
    start() {
      if (promise) { replan(); pump(); return promise; }
      promise = new Promise((resolve) => { finish = resolve; });
      const p = promise;
      replan();
      pump();
      return p;
    },
    resume() { if (finish) pump(); }, // F407: hold() has changed its mind
    // Cancel: downloads stop now, rows not started are cancelled, dpkg finishes the package it is on.
    cancel() {
      if (!finish || stopping) return false;
      stopping = true;
      for (const [id, ctl] of fetching) { ctl.abort(); fetching.delete(id); }
      for (const r of rows) if (!ended(r) && r !== lane) set(r, "cancelled", { error: null });
      files.clear();
      pump();
      return true;
    },
    // A row's own stop (waiting, downloading or waiting to install; not the one dpkg is on): it is cancelled, and
    // what needs it is skipped.
    stop(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || ended(r) || r === lane || !finish) return false;
      fetching.get(id)?.abort();
      fetching.delete(id);
      files.delete(id);
      set(r, "cancelled", { error: null });
      log(r, "warning", `${r.name || r.id}: stopped`);
      replan();
      pump();
      return true;
    },
    // A failed row again (and what was skipped for it); a skipped row retries its cause, then itself.
    retry(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || !ended(r) || r.state === "installed" || stopping) return null;
      if (r.state === "skipped" && r.cause) return run.retry(r.cause) ?? reset([r]);
      return reset([r, ...rows.filter((x) => x.state === "skipped" && x.cause === r.id)]);
    },
    // Retry All: every failed, skipped and cancelled row.
    retryAll() {
      if (stopping) return null;
      const again = rows.filter((x) => DEAD.has(x.state));
      return again.length ? reset(again) : null;
    },
  };
  function reset(list) {
    for (const x of list) set(x, "waiting", { error: null, cause: null, done: 0, fraction: 0, viaApt: false });
    return run.start();
  }
  return run;
}

const nameOf = (rows, id) => rows.find((r) => r.id === id)?.name || id;
const verbOf = (rows, id) => (rows.find((r) => r.id === id)?.state === "cancelled" ? "was cancelled" : "failed");

// "1.2" (MB, one decimal), the row's sizes.
export const mb = (bytes) => (Math.max(0, Number(bytes) || 0) / 1e6).toFixed(1);
// "4.0 MB", or "568 KB"-style under a megabyte (a tiny package isn't "0.0 MB"): `of` gives the total's unit.
export function sizeText(bytes, of = bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  return Number(of) >= 1e6 ? `${mb(n)} MB` : `${Math.max(n ? 1 : 0, Math.round(n / 1e3))} KB`;
}

export function rowStatus(row, names = {}) {
  const remove = row.op === "remove";
  switch (row.state) {
    case "waiting": return "Waiting";
    case "downloading": return row.total ? `Downloading ${sizeText(row.done, row.total).replace(/ [KM]B$/, "")} of ${sizeText(row.total)}`
      : row.fraction > 0 ? `Downloading ${Math.round(row.fraction * 100)}%` : "Downloading";
    case "ready": return remove ? "Waiting to remove" : "Waiting to install";
    case "installing": return remove ? "Removing" : row.viaApt ? "Downloading and installing" : "Installing";
    case "installed": return remove ? "Removed" : "Installed";
    case "failed": return row.error ? `Failed: ${row.error}` : "Failed";
    case "skipped": return `Needs ${names[row.cause] || row.cause}, which ${row.causeCancelled ? "was cancelled" : "failed"}`;
    case "cancelled": return "Cancelled";
    default: return "";
  }
}

// The end of the Packages list and of the log: "4 installed, 1 removed, 1 failed, 1 skipped, 2 cancelled".
export function summaryLine(rows) {
  const n = (f) => rows.filter(f).length;
  const parts = [
    [n((r) => r.state === "installed" && r.op !== "remove"), "installed"],
    [n((r) => r.state === "installed" && r.op === "remove"), "removed"],
    [n((r) => r.state === "failed"), "failed"],
    [n((r) => r.state === "skipped"), "skipped"],
    [n((r) => r.state === "cancelled"), "cancelled"],
  ].filter(([c]) => c);
  return parts.length ? parts.map(([c, w]) => `${c} ${w}`).join(", ") : "Nothing to do";
}

// The bottom status while it runs: "Installing Foo (3 of 6)" or the downloads.
export function runStatus(rows, names = {}) {
  const label = (r) => names[r.id] || r.name || r.id;
  const at = rows.find((r) => r.state === "installing");
  const pos = (r) => `${rows.indexOf(r) + 1} of ${rows.length}`;
  if (at) return `${at.op === "remove" ? "Removing" : "Installing"} ${label(at)} (${pos(at)})`;
  const dl = rows.filter((r) => r.state === "downloading");
  if (dl.length) return dl.length === 1 ? `Downloading ${label(dl[0])}` : `Downloading ${dl.length} packages`;
  return "Preparing";
}

// The bar under it: rows ended plus the share each download has done, over every row.
export function runPercent(rows) {
  if (!rows.length) return 100;
  let n = 0;
  for (const r of rows) {
    if (ended(r)) n += 1;
    else if (r.state === "installing") n += 0.75;
    else if (r.state === "ready") n += 0.5;
    else if (r.state === "downloading") n += 0.5 * (r.fraction || 0);
  }
  return Math.round((n / rows.length) * 100);
}
