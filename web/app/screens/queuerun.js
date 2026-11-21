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
// What installed leaves the queue as it goes; what failed or was skipped stays queued, so Confirm shows it again.
// SPDX-License-Identifier: GPL-3.0-or-later
import { el, barButton } from "../nav/ui.js";
import { openProgress, openOn } from "../nav/progress.js";
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
//   onEnd({ ok, stopped, installed }), setBadge(text | null), open (openProgress, for tests) }
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
  const runJobs = jobs.map((j) => ({ op: j.op, id: j.id, version: j.version, mode: j.mode }));
  const titleNow = () => runTitle(jobs.map((j) => ({ ...j, name: j.name || names[j.id] })));
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
  const seg = page.segmented(["Packages", "Log"], (i) => {
    if (i === 0) { page.filter(null); page.view("pane"); } else page.view("log");
  });
  openOn(page, seg, rows.length); // F247: one package opens on the Log
  const showLog = (pkg) => { seg.select(1); page.filter(pkg); page.view("log"); };

  const views = new Map();
  for (const r of rows) {
    const li = el("li", "qr-row");
    const main = el("button", "qr-main");
    main.type = "button";
    const name = el("div", "qr-name", label(r.id));
    const status = el("div", "qr-status");
    const bar = el("div", "qr-bar");
    const fill = el("div", "qr-fill");
    bar.append(fill);
    main.append(name, status, bar);
    const act = el("button", "qr-stop");
    act.type = "button";
    act.setAttribute("aria-label", `Stop ${label(r.id)}`);
    li.append(main, act);
    list.append(li);
    main.addEventListener("click", () => {
      if (r.state === "failed" || r.state === "skipped" || (r.state === "cancelled" && !run.running)) retry(r.id);
      else showLog(r.id);
    });
    act.addEventListener("click", () => run.stop(r.id));
    views.set(r.id, { li, status, bar, fill, act });
  }
  list.append(summary);
  const draw = (r) => {
    const v = views.get(r.id);
    if (!v) return;
    v.li.dataset.state = r.state;
    v.status.textContent = rowStatus(r, names);
    const busy = r.state === "downloading" || r.state === "installing";
    v.bar.hidden = !busy;
    v.bar.classList.toggle("is-indeterminate", r.state === "installing" || (r.state === "downloading" && !r.fraction));
    v.fill.style.transform = `scaleX(${r.state === "downloading" ? r.fraction || 0 : 1})`;
    v.act.hidden = !["waiting", "downloading", "ready"].includes(r.state) || run.stopping;
  };

  // ---- the run ----
  let levels = [];
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
    onChange: (r) => { draw(r); tick(); },
    onLog: ({ pkg, kind, text }) => line(kind, text, pkg),
  });
  // What installed leaves the queue now; the IDs apt only pulled in aren't queued.
  const cleared = new Set();
  let tickFrame = 0;
  const tick = () => {
    if (tickFrame) return;
    tickFrame = requestAnimationFrame(() => {
      tickFrame = 0;
      for (const r of rows) if (r.state === "installed" && !cleared.has(r.id)) { cleared.add(r.id); queue.clear(r.id); }
      if (run.stopping) {
        page.status(run.current ? `Stopping after ${label(run.current.id)}…` : "Stopping…");
      } else if (run.running) page.status(runStatus(rows, names));
      page.progress(runPercent(rows));
      const left = rows.filter((r) => !ended(r)).length;
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
  hide.addEventListener("click", () => { page.hide(); strip.show(); tick(); });
  cancel.addEventListener("click", () => {
    if (cancel.disabled) return;
    if (run.cancel()) { cancel.disabled = true; for (const r of rows) draw(r); tick(); }
  });
  closeB.addEventListener("click", () => page.close());
  retryAll.addEventListener("click", () => { const p = run.retryAll(); if (p) drive(p); });
  const retry = (id) => { const wasRunning = run.running; const p = run.retry(id); if (p && !wasRunning) drive(p); };
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
      update() { if (node) node.firstChild.textContent = run.running ? runStatus(rows, names) : summaryLine(rows); },
      hide() { node?.remove(); node = null; document.body.classList.remove("qr-stripped"); setBadge(null); },
    };
  })();
  page.onClose(() => strip.hide());
  if (deps.onClose) page.onClose(() => deps.onClose(latest));

  // ---- one pass of the run, from start or a retry, to its end ----
  let first = null;
  let latest = null;
  async function drive(promise) {
    pass++;
    entry(); // kept as running from the pass's start, even before its first line
    page.reopen({ title: "Running", status: runStatus(rows, names) });
    cancel.disabled = false;
    summary.hidden = true;
    page.bar({ left: cancel, right: hide }); // a retry keeps the finish levels earlier passes asked for
    for (const r of rows) draw(r);
    await promise;
    await asking;
    return ended_(cancel.disabled); // disabled: this pass was cancelled
  }

  async function ended_(wasCancel) {
    for (const r of rows) draw(r);
    tick();
    const installed = rows.filter((r) => r.state === "installed");
    const bad = rows.filter((r) => ["failed", "skipped", "cancelled"].includes(r.state));
    const text = summaryLine(rows);
    summary.textContent = text;
    summary.hidden = false;
    line("step", text);
    // the packages apt only pulled in for another keep apt's Auto-Installed mark
    const auto = installed.filter((r) => r.added && r.op === "install" && !r.from).map((r) => r.id);
    if (auto.length) await backend.markAuto?.(auto);
    const instKinds = installed.map((r) => kinds[r.id]?.kind ?? (kinds[r.id]?.restart ? "tweak" : "package"));
    const choice = chooseFinish({ ok: installed.length > 0, levels: installed.length ? [...levels, ...selfLevels(installed.map((r) => ({ id: r.id, op: r.op })))] : [], kinds: instKinds });
    const kept = entry();
    live = null;
    kept.set({ title: titleNow() });
    kept.end({ code: bad.length ? 1 : 0, cancelled: wasCancel, finish: choice.level, text: log.slice(passFrom).join("\n") });
    const reloaded = catalog.reloadInstalled?.().catch(() => {});
    const result = { ok: !bad.length, stopped: wasCancel, rows, installed: installed.length, reloaded };
    if (!first) first = result;
    latest = result;
    onEnd(result);
    if (wasCancel) {
      // Cancel: back to Confirm with what finished cleared, and a footer that says so
      strip.hide();
      await page.close();
      deps.reopenConfirm?.(`Stopped. ${installed.length} installed and cleared from the queue.`);
      return result;
    }
    page.bar(bad.length ? { left: closeB, right: retryAll } : {});
    page.finish({ label: choice.label, status: text, action: () => finishAction(choice) });
    if (page.hidden) strip.update();
    return result;
  }

  return new Promise((resolve) => {
    const p = run.start();
    drive(p).then(() => resolve(first), () => resolve(first));
  });
}
