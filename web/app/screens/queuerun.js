// F234: the install queue's run where one failure doesn't stop the rest (the brain is core/installrun.js), on the
// black progress page (nav/progress.js) with Packages | Log under its nav bar (user 2026-11-18, mockup in the plan;
// B224: the nav bar itself as Cydia's on the 4S, "Running" then "Complete", plain buttons):
//
//   Packages (the default; a run of one package opens on the Log instead): one row per package apt's plan changes, in the dpkg lane's order: its name, a grey line
//     (Waiting / Downloading 1.2 of 4.0 MB / Waiting to install / Installing / Installed / Failed: why / Needs X,
//     which failed / Cancelled), an iOS 6 progress bar while it downloads, and a stop button until dpkg takes it.
//     Tapping a failed row retries it; a skipped one retries what it needs, then it; any other row opens the Log
//     with that package's lines only. The run's summary ("4 installed, 1 failed, 1 skipped") ends the list (and the
//     log), never above the finish button (B67).
//   Log: the console as before, one line per step per package (Downloading X 4.0 MB, Downloaded X, apt's Unpacking /
//     Configuring lines once each, Installed X or the error); apt's and dpkg's own output grey under its package.
//     Percents only move the rows' bars and the bottom status.
//   Top left: Cancel while it runs, as Cydia's (downloads stop at once, dpkg finishes the package it is on:
//     "Stopping after X…", Cancel greyed; then Confirm again with what finished cleared from the queue and the
//     footer "Stopped. N installed and cleared from the queue."), Close after a run with failures. Top right: Hide
//     while it runs (the page slides away; a strip under every tab's nav bar reopens it, and the Installed badge
//     counts what's left), Retry All once it ended with failures (failed, skipped and cancelled rows). A clean end has no bar
//     buttons, as the 4S's "Complete": the finish button closes it.
//   The bottom: the status and bar while it runs, then the finish button (core/progress.js chooseFinish over what
//     was installed: Restart SpringBoard for a tweak, Reload Data for an app, Return to iFizBox).
//
// F407: queued apps run on the same page (deps.apps; screens/apprun.js as its guest): their rows above the packages',
// "Queue | Log" for the tabs. The apps go first while the packages download; dpkg's lane starts once they have ended
// (core/installrun.js hold), failed apps or not. One Cancel, one Retry All, one summary, one finish button for both.
//
// What installed leaves the queue as it goes; what failed or was skipped stays queued, so Confirm shows it again.
// SPDX-License-Identifier: GPL-3.0-or-later
import { el, barButton } from "../nav/ui.js";
import { openProgress, openOn, rowBar } from "../nav/progress.js";
import { showAlert } from "../nav/alert.js";
import { classify, chooseFinish, selfLevels } from "../core/progress.js";
import { runRows, neededBy, createInstallRun, rowStatus, summaryLine, runStatus, runPercent, ended } from "../core/installrun.js";
import { MODES, runTitle, CONFFILE_TITLE, CONFFILE_BUTTONS, conffileMessage, conffileAnswer, conffileLine } from "../core/queue.js";

// Confirm's Modifications group (`group`, the .group element): under each package apt added (not queued), a small grey
// line "needed by X" (user 2026-11-18). Asks the catalog for the dependencies (runInfo); nothing changes without them.
export async function markNeededBy(group, plan, jobs, names, catalog) {
  if (!group) return;
  const items = [];
  for (const m of ["installs", "reinstalls", "upgrades", "downgrades"]) for (const e of plan[m] ?? []) items.push({ id: e.id, version: e.to });
  let info;
  try { info = await catalog.runInfo?.(items); } catch { return; }
  if (!info) return;
  const needed = neededBy(plan, jobs, info);
  if (!Object.keys(needed).length) return;
  const label = (id) => names[id] || info[id]?.name || id;
  const cells = [...group.querySelectorAll(".confirm-mods")];
  let i = 0;
  for (const mode of MODES) {
    const list = plan[`${mode}s`] ?? [];
    if (!list.length) continue;
    const detail = cells[i++]?.querySelector(".cell-detail");
    if (!detail || !list.some((e) => needed[e.id])) continue;
    detail.replaceChildren(...list.map((e) => {
      const s = el("span", "confirm-name", label(e.id));
      if (needed[e.id]) s.append(el("span", "confirm-needed", `needed by ${needed[e.id].map(label).join(", ")}`));
      return s;
    }));
  }
}

// run: Confirm's { jobs, plan }. deps: { backend, catalog, queue, runLogs, names, finishAction(choice),
//   onEnd({ ok, stopped, installed }), apps (F407: { jobs, start(host) -> runAppRun's on that host, finish() ->
//   { levels, kinds } the apps ask of the finish button, or null }), setBadge(text | null), open (openProgress, for tests) }
// -> a promise for the first end: { ok, stopped, rows }.
export async function runQueue({ jobs, plan }, deps) {
  const { backend, catalog, queue, runLogs, finishAction = async () => false, onEnd = () => {}, setBadge = () => {},
    open = openProgress, alert = showAlert } = deps;
  const names = { ...(deps.names ?? {}) };
  const label = (id) => names[id] || id;
  const page = open({ title: "Running" });

  // ---- rows ----
  const items = [];
  for (const m of ["installs", "reinstalls", "upgrades", "downgrades"]) for (const e of plan[m] ?? []) items.push({ id: e.id, version: e.to });
  let info = {};
  try { info = (await catalog.runInfo?.(items)) ?? {}; } catch { info = {}; }
  const rows = runRows(plan, jobs, info);
  for (const r of rows) { if (r.name && !names[r.id]) names[r.id] = r.name; }
  let kinds = {};
  try { kinds = (await catalog.queueInfo(rows.map((r) => r.id))) ?? {}; } catch { kinds = {}; }

  // ---- the log ----
  const log = [];
  // Each step once per package and pass (apt repeats a status line for every percent, with dpkg's output between);
  // plain output may repeat on purpose (C6's rule).
  const steps = new Set();
  let pass = 0;
  // F363: each pass is kept in Console Logs from its first line (runLogs.start), each line saved as it comes, so a
  // run that hangs or is killed still leaves its log; a retry pass is an entry of its own, holding that pass's lines.
  const allJobs = [...(deps.apps?.jobs ?? []), ...jobs];
  const runJobs = allJobs.map((j) => ({ op: j.op, id: j.id, version: j.version, mode: j.mode }));
  const titleNow = () => runTitle(allJobs.map((j) => ({ ...j, name: j.name || names[j.id] })));
  let live = null;
  let passFrom = 0; // where this pass's lines start in `log`
  const entry = () => {
    if (!live) { passFrom = log.length; live = runLogs.start({ title: titleNow(), jobs: runJobs }); }
    return live;
  };
  const line = (kind, text, pkg = null) => {
    if (!text) return;
    if (kind === "step") {
      const key = `${pass}\n${pkg ?? ""}\n${text}`;
      if (steps.has(key)) return;
      steps.add(key);
    }
    const kept = entry();
    log.push(kind === "raw" ? text : kind === "error" ? `E: ${text}`.replace(/^E: E: /, "E: ") : kind === "warning" ? text : `» ${text}`);
    kept.line(log[log.length - 1]);
    page.line(kind, text, pkg);
  };

  // ---- Packages ----
  const pane = el("div", "qr-pane");
  const list = el("ul", "qr-list");
  const summary = el("li", "qr-summary");
  summary.hidden = true;
  pane.append(list);
  page.pane(pane);
  const seg = page.segmented([deps.apps ? "Queue" : "Packages", "Log"], (i) => {
    if (i === 0) { page.filter(null); page.view("pane"); } else page.view("log");
  });
  if (!deps.apps) openOn(page, seg, rows.length); // F247: one package opens on the Log
  const showLog = (pkg) => { seg.select(1); page.filter(pkg); page.view("log"); };

  const views = new Map();
  for (const r of rows) {
    const li = el("li", "qr-row");
    const main = el("button", "qr-main");
    main.type = "button";
    const name = el("div", "qr-name", label(r.id));
    const status = el("div", "qr-status");
    const { bar, set: setBar } = rowBar(); // B324: <progress> under the native controls hook
    main.append(name, status, bar);
    const act = el("button", "qr-stop");
    act.type = "button";
    act.setAttribute("aria-label", `Stop ${label(r.id)}`);
    li.append(main, act);
    list.append(li);
    main.addEventListener("click", () => {
      if (r.state === "failed" || r.state === "skipped" || (r.state === "cancelled" && !busy)) retry(r.id);
      else showLog(r.id);
    });
    act.addEventListener("click", () => run.stop(r.id));
    views.set(r.id, { li, status, bar, setBar, act });
  }
  list.append(summary);
  const draw = (r) => {
    const v = views.get(r.id);
    if (!v) return;
    v.li.dataset.state = r.state;
    v.status.textContent = rowStatus(r, names);
    const busy = r.state === "downloading" || r.state === "installing";
    v.bar.hidden = !busy;
    v.setBar(r.state === "downloading" ? r.fraction || 0 : 1, r.state === "installing" || (r.state === "downloading" && !r.fraction));
    v.act.hidden = !["waiting", "downloading", "ready"].includes(r.state) || run.stopping;
  };

  // ---- the run ----
  let levels = [];
  let apps = null;  // F407: the apps' half (apprun.js host.attach)
  let busy = false; // a pass is going, the apps' half included
  let asking = Promise.resolve();
  const canAsk = typeof backend.answerConffile === "function";
  const ask = (file, pkg) => {
    asking = asking.then(async () => {
      const { index } = await alert({ title: CONFFILE_TITLE, message: conffileMessage(file), buttons: CONFFILE_BUTTONS, cancel: 0, stacked: true });
      const answer = conffileAnswer(index);
      try { await backend.answerConffile(answer); line("step", conffileLine(file, answer), pkg); } catch (e) { line("error", `Configuration file ${file}: ${e.message || String(e)}`, pkg); }
    });
  };
  const install = async (r, { file }) => {
    const onEvent = ({ fd, line: raw }) => {
      const c = classify({ fd, line: raw });
      if (!c) return;
      switch (c.kind) {
        case "finish": levels.push(c.finish); return;
        case "conffile":
          if (canAsk) ask(c.file, r.id); else line("step", conffileLine(c.file, "keep"), r.id);
          return;
        case "step": line("step", c.pkg ? c.text.replaceAll(c.pkg, label(c.pkg)) : c.text, r.id); return;
        case "error": line("error", c.pkg ? `${label(c.pkg)}: ${c.text}` : c.text, r.id); return;
        case "warning": line("warning", c.text, r.id); return;
        default: line("raw", c.text, r.id);
      }
    };
    let res;
    try { res = await backend.queueInstall(r, { file: file?.file ?? null, onEvent }); } catch (e) { return { ok: false, error: e.message || String(e) }; }
    if (res?.code === 0) return { ok: true };
    // apt's first error is the cause ("Failed to fetch … Hash Sum mismatch"); its last only says it gave up
    const first = String(res?.stderr ?? "").trim().split("\n").find((l) => /^E: |dpkg: error/.test(l));
    return { ok: false, error: first ? first.replace(/^E: /, "").replace(/\s{2,}/g, " ").trim() : `apt-get stopped with exit code ${res?.code}` };
  };
  const run = createInstallRun({
    rows, installed: info.installed ?? {},
    fetch: (r, hooks) => backend.queueFetch(r, hooks),
    install,
    hold: () => Boolean(apps?.run.running),
    onChange: (r) => { draw(r); tick(); },
    onLog: ({ pkg, kind, text }) => line(kind, text, pkg),
  });
  // What installed leaves the queue now; the IDs apt only pulled in aren't queued.
  const cleared = new Set();
  let tickFrame = 0;
  const running = () => run.running || Boolean(apps?.run.running);
  const total = () => rows.length + (apps?.rows.length ?? 0);
  // the status's "(1 of 3)" counts the whole run
  const status = () => {
    const app = Boolean(apps?.run.running);
    return (app ? apps.status() : runStatus(rows, names)).replace(/\((\d+) of \d+\)$/, (_, n) => `(${Number(n) + (app ? 0 : apps?.rows.length ?? 0)} of ${total()})`);
  };
  const tick = () => {
    if (tickFrame) return;
    tickFrame = requestAnimationFrame(() => {
      tickFrame = 0;
      for (const r of rows) if (r.state === "installed" && !cleared.has(r.id)) { cleared.add(r.id); queue.clear(r.id); }
      if (run.stopping || apps?.run.stopping) {
        page.status(run.current ? `Stopping after ${label(run.current.id)}…` : "Stopping…");
      } else if (running()) page.status(status());
      page.progress(apps ? Math.round((apps.percent() * apps.rows.length + runPercent(rows) * rows.length) / total()) : runPercent(rows));
      const left = rows.filter((r) => !ended(r)).length + (apps?.left() ?? 0);
      if (page.hidden) { setBadge(left ? String(left) : null); strip.update(); }
    });
  };

  // ---- the bar ----
  // B224: as Cydia's Running page on the 4S: plain black-bar buttons, Cancel at the top left; no buttons once it ends
  // clean (the 4S's Complete has none: the finish button closes it)
  const hide = barButton("Hide");
  const cancel = barButton("Cancel");
  const closeB = barButton("Close");
  const retryAll = barButton("Retry All");
  const putAway = () => { page.hide(); strip.show(); tick(); };
  hide.addEventListener("click", putAway);
  cancel.addEventListener("click", () => {
    if (cancel.disabled) return;
    const stopped = [apps?.run.cancel(), run.cancel()];
    if (stopped.some(Boolean)) { cancel.disabled = true; apps?.redraw(); for (const r of rows) draw(r); tick(); }
  });
  closeB.addEventListener("click", () => page.close());
  retryAll.addEventListener("click", () => {
    const app = apps?.run.retryAll() ?? null; // first: dpkg's lane waits for it
    const pkg = run.retryAll();
    if (app || pkg) drive({ pkg, app });
  });
  const retry = (id) => {
    const p = run.retry(id);
    if (!p) return;
    if (busy) going.pkg = p; else drive({ pkg: p }); // busy: this pass waits for it too
  };

  // ---- Hide's strip, under every tab's nav bar ----
  const strip = (() => {
    let node = null;
    return {
      show() {
        if (node) return;
        node = el("button", "qr-strip");
        node.type = "button";
        node.append(el("span", "qr-strip-text"), el("span", "qr-strip-show", "Show"));
        node.addEventListener("click", () => { strip.hide(); page.show(); });
        document.body.append(node);
        document.body.classList.add("qr-stripped");
        strip.update();
      },
      update() { if (node) node.firstChild.textContent = running() ? status() : summary_(); },
      hide() { node?.remove(); node = null; document.body.classList.remove("qr-stripped"); setBadge(null); },
    };
  })();
  page.onClose(() => strip.hide());
  if (deps.onClose) page.onClose(() => deps.onClose(latest));

  // ---- F407: the apps' half ----
  const summary_ = () => summaryLine([...(apps?.rows ?? []).map((r) => ({ state: r.state, op: r.mode === "remove" ? "remove" : "install" })), ...rows]);
  const appKey = (id) => (id ? `app:${id}` : null); // a package may have an app's bundle ID
  // what runAppRun gets in place of a page of its own
  const appHost = {
    get busy() { return busy; },
    attach(half) { apps = half; },
    drive: (p) => drive({ app: p }),
    changed: () => tick(),
    page: {
      // a line once nothing runs (a record written late) is for the page only: it would open a new Console Logs entry
      line: (kind, text, id) => (live || apps?.run.running ? line(kind, text, appKey(id)) : page.line(kind, text, appKey(id))),
      pane(n) { pane.replaceChildren(...n.children, list); },
      segmented: () => ({ select: (i) => seg.select(i) }),
      filter: (id) => page.filter(appKey(id)),
      view: (v) => page.view(v),
      status() {}, progress() {}, bar() {}, reopen() {}, finish() {}, clear() {},
      get hidden() { return page.hidden; },
      get closed() { return page.closed; },
      hide: putAway,
      close: () => page.close(),
      onClose: (f) => page.onClose(f),
    },
  };
  if (deps.apps) {
    deps.apps.start(appHost);
    openOn(page, seg, total());
  }

  // ---- one pass of the run, from start or a retry, to its end ----
  let first = null;
  let latest = null;
  let going = {}; // this pass's promises: { pkg, app }
  async function drive(promises) {
    going = promises;
    busy = true;
    going.app?.then(() => run.resume());
    pass++;
    entry(); // kept as running from the pass's start, even before its first line
    page.reopen({ title: "Running", status: status() });
    cancel.disabled = false;
    summary.hidden = true;
    page.bar({ left: cancel, right: hide }); // a retry keeps the finish levels earlier passes asked for
    for (const r of rows) draw(r);
    apps?.redraw();
    do {
      await Promise.all([going.pkg, going.app]);
      await asking;
    } while (running());
    busy = false;
    return ended_(cancel.disabled); // disabled: this pass was cancelled
  }

  async function ended_(wasCancel) {
    for (const r of rows) draw(r);
    apps?.redraw();
    tick();
    const appEnd = apps?.end(wasCancel) ?? { ok: true, installed: 0 };
    const installed = rows.filter((r) => r.state === "installed");
    const bad = rows.filter((r) => ["failed", "skipped", "cancelled"].includes(r.state));
    const clean = !bad.length && appEnd.ok;
    const done = installed.length + appEnd.installed;
    const text = summary_();
    summary.textContent = text;
    summary.hidden = false;
    line("step", text);
    // the packages apt only pulled in for another keep apt's Auto-Installed mark
    const auto = installed.filter((r) => r.added && r.op === "install" && !r.from).map((r) => r.id);
    if (auto.length) await backend.markAuto?.(auto);
    const instKinds = installed.map((r) => kinds[r.id]?.kind ?? (kinds[r.id]?.restart ? "tweak" : "package"));
    const asked = deps.apps?.finish?.() ?? { levels: [], kinds: [] }; // F407: AppSync Unified's respring
    const own = [...installed.map((r) => ({ id: r.id, op: r.op })), ...(apps?.rows ?? []).filter((r) => r.state === "installed").map((r) => ({ id: r.id, op: r.mode === "remove" ? "remove" : "install" }))];
    const choice = chooseFinish({ ok: installed.length > 0 || asked.levels.length > 0 || own.length > 0,
      levels: [...(installed.length ? levels : []), ...selfLevels(own), ...asked.levels], kinds: [...instKinds, ...asked.kinds] });
    const kept = entry();
    live = null;
    kept.set({ title: titleNow() });
    kept.end({ code: clean ? 0 : 1, cancelled: wasCancel, finish: choice.level, text: log.slice(passFrom).join("\n") });
    const reloaded = catalog.reloadInstalled?.().catch(() => {});
    const result = { ok: clean, stopped: wasCancel, rows, installed: done, reloaded, ...(apps ? { apps: apps.rows } : {}) };
    if (!first) first = result;
    latest = result;
    onEnd(result);
    if (wasCancel) {
      // Cancel: back to Confirm with what finished cleared, and a footer that says so
      strip.hide();
      await page.close();
      deps.reopenConfirm?.(`Stopped. ${done} installed and cleared from the queue.`);
      return result;
    }
    page.bar(clean ? {} : { left: closeB, right: retryAll });
    page.finish({ label: choice.label, status: text, action: () => finishAction(choice) });
    if (page.hidden) strip.update();
    apps?.settled();
    return result;
  }

  return new Promise((resolve) => {
    const app = apps?.run.start() ?? null; // first: dpkg's lane waits for it
    drive({ app, pkg: run.start() }).then(() => resolve(first), () => resolve(first));
  });
}
