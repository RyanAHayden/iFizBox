// The install queue's screens (N4), Cydia's flow (docs/cydia.md, "Install queue"):
//
//   1. A package page's Install / Modify sheet, its Version History or an F18 "Remove X" row queues a package
//      (getBackend().queue, backend-native.js); the Confirm sheet opens at once.
//   2. Confirm: apt-get -s over the whole queue (ifizbox-helper simulate). Its Modifications (Install, Reinstall,
//      Upgrade, Downgrade, Remove, one row each with the names), the queue itself (tap one to clear it), and
//      Continue Queuing. When apt refuses, the sheet is "Cannot Comply": F18's plain-language explanation of each
//      problem with its action (core/deps.js explainApt through the catalog) above apt's own output, which always
//      shows; never a silent failure (Zebra #2052). Cancel clears the queue; Confirm runs it. B404: until apt agrees (while
//      it is asked, and on Cannot Comply) the left button is Close, which leaves the queue as it is; Cannot Comply has a
//      "Remove <name> from Queue" row per package that caused it (core/queuerefusal.js).
//   3. The console ("Running", then "Complete"; F151: nav/progress.js): apt's and dpkg's lines streamed over the
//      bridge as they come, the status fd's steps in bold white, dpkg's own output in monospace, errors in red, a
//      progress bar, then the finish button (core/progress.js chooseFinish): Restart SpringBoard when a changed
//      package is a tweak, Reload Data (uicache) for an app, or what a script asked ($CYDIA's finish: words, up to
//      Reboot Device), Close iFizBox when the run upgraded iFizBox itself (it has to quit), else just Close (the
//      sheet closes). The run's output is
//      kept (queue.js runLogs) for Settings > Console Logs (logsPage below). A conffile changed by both the user and
//      the package opens Cydia's Configuration Upgrade alert (F63): Keep My Old Copy or Accept the New Copy, sent
//      back to dpkg through backend.answerConffile while the run waits. While apt is still downloading (no dpkg
//      status line yet) the bar has Cydia's Cancel (F64, backend.cancelApply): the run stops, nothing is installed
//      and the queue stays.
//      F234: in the jailbreak app Confirm's run is screens/queuerun.js instead (backend.queueFetch): every package
//      downloads on its own, 3 at a time, and one dpkg lane installs them in order; a failure skips only what needs
//      it. Packages | Log in the black page's nav bar, Hide / Cancel / Retry All. The console above stays for Roll
//      Back, paid installs and a backend without per-package calls.
//
// While the queue holds packages: they are marked in every list (browse.js), the Installed tab's badge reads Q'd
// and its nav bar has a Queue button that reopens Confirm. Styles: queue.css. Without a jailbreak the IPA queue
// (app-queue.js) drives the same badge and a Queue button on the left of Installed's root (initAppQueueChrome).
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, el, barButton } from "../nav/ui.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { openProgress, progressHUD, lockSelfUpdate } from "../nav/progress.js";
import { classify, chooseFinish, selfLevels } from "../core/progress.js";
import { format, settingsRoute } from "../router.js";
import { getBackend } from "../backend.js";
import { catalog } from "../catalog.js";
import { installQueue, runLogs } from "../queue.js";
import { MODES, MODE_LABEL, changeCount, runTitle, createRepeatFilter, CONFFILE_TITLE,
  CONFFILE_BUTTONS, conffileMessage, conffileAnswer, conffileLine, debUrlOf, debLinkOf, mergePlans, runStatusText } from "../core/queue.js";
import { appQueue } from "../app-queue.js";
import { appPlan, runOrder, sizeText, SELF_ID, customParams, listedOf, APP_MODES, APP_MODE_LABEL } from "../core/appqueue.js";
import { helperRefusal, refusalIds } from "../core/queuerefusal.js";
import { NAME } from "../brand.js";
import { storedRoute } from "../core/installroute.js"; // B137
import { rowIcon } from "../icons/rowicons.js";
import { runQueue, markNeededBy } from "./queuerun.js";
import { createQueueHint } from "../nav/queuehint.js";
import { showSheet } from "../nav/sheet.js";
import { nativeBridge } from "../native.js";
import { issueUrl, reportLog } from "../core/report-issue.js"; // F362
import { copyText } from "../nav/menu.js";
import { detectMode } from "../core/settings.js";
import { currentDevice } from "../device.js";
import { buildInfo } from "./version-foot.js";

let ctxRef = null;
let confirm = null;   // the open Confirm sheet: { refresh(), close() }
let running = false;  // a console is up: nothing else opens over it

// app.js calls this once (jailbreak build: the backend has a queue). Queuing opens Confirm; every change redraws
// the badge and the Installed tab's Queue button.
export function initQueue(ctx) {
  ctxRef = ctx;
  installQueue.subscribe((e) => {
    if (e.type === "add") {
      nameJobs([e.job.id]);
      if (confirm) confirm.refresh();
      else if (!running && !e.quiet) openConfirm(); // F193: a row's swipe queues without the sheet
    }
    if (e.type === "clear" && confirm) confirm.refresh();
    if (e.type !== "name") updateChrome();
  });
  // B71a: AltStore apps queue beside the packages (app-queue.js: a row's swipe or hold menu, an app page's Modify) and
  // show on the same Confirm sheet, Q'd badge and Queue button; a swipe's add is quiet, as apt's.
  appQueue.subscribe((e) => {
    if (!appRunning && !appPreparing) {
      if (e.type === "add" && !confirm && !running && !e.quiet) openConfirm();
      else confirm?.refresh();
    }
    updateChrome();
  });
  // A tab's nav bar is built when it is first shown, so the Queue button is put in after each route change too.
  globalThis.addEventListener?.("hashchange", () => requestAnimationFrame(updateChrome));
  requestAnimationFrame(updateChrome);
}

// Names for the marks and the sheet come from the catalog, once it answers.
function nameJobs(ids) {
  catalog.queueInfo(ids).then((info) => {
    for (const id of ids) if (info?.[id]?.name) installQueue.name(id, info[id].name);
  }, () => {});
}

// Cydia's Q'd badge (on its Manage tab; ours on Installed, where its Queue button lives) and the Queue button.
function updateChrome() {
  const n = installQueue.size + jbAppJobs().length; // B71a: queued apps count too
  const badge = n && !confirm && !running && !appRunning ? "Q'd" : null;
  ctxRef?.setBadge?.("installed", badge);
  updateHint({ queued: n > 0, badge: Boolean(badge), open: () => openConfirm() }); // F272
  const right = installedRoot?.item?.querySelector?.(".nav-right");
  if (!right) return;
  let b = right.querySelector(".queue-button");
  if (n && !b) {
    b = barButton("Queue", "done queue-button");
    b.addEventListener("click", () => openConfirm());
    right.prepend(b);
  } else if (!n && b) b.remove();
}

// ---- a modal sheet with Cancel on the left and a Done-style button on the right ----------------------------------

// nav/sheet.js's showSheet with a scroll body; Escape does nothing (Cancel clears the queue, so closing is the
// buttons' job).
export function modal({ title, left = null, right = null, cls = "" }) {
  const scroll = el("div", "sheet-scroll page-body grouped"); // page-body: clears the sheet's nav bar
  const s = showSheet({ title, body: scroll, left, right, cls, escape: false });
  return { sheet: s.sheet, scroll, h1: s.h1, left: s.left, right: s.right, setTitle: s.setTitle, close: () => s() };
}

// ---- Confirm ---------------------------------------------------------------------------------------------------

// F218: Confirm's Cancel (it clears the queue) is the red bar button (ios6.css .bar-button.red, user 2026-11-18), on
// both Confirm sheets (packages and apps). Nowhere else uses it.
export function confirmCancel() {
  return barButton("Cancel", "red");
}

// F234: `footer` under the sheet (a cancelled run's "Stopped. N installed and cleared from the queue.").
export function openConfirm({ footer = null } = {}) {
  if (confirm || running) { confirm?.refresh(); return; }
  if (!installQueue.size && !jbAppJobs().length) return;
  const cancel = confirmCancel();
  const closer = barButton("Close"); // B404: until apt agrees, the left button leaves the queue alone
  const ok = barButton("Confirm", "done");
  ok.hidden = true;
  const m = modal({ title: "Confirm", left: closer, right: ok, cls: "confirm-sheet" });
  let generation = 0;
  let ready = null; // { jobs, plan, ids } once apt agreed
  // B404: the generation moves on, so an answer still coming can't queue anything or draw once the sheet is closed
  const close = () => { generation++; confirm = null; updateChrome(); return m.close(); };
  closer.addEventListener("click", () => close());
  cancel.addEventListener("click", () => { installQueue.clearAll(); if (!appRunning && !appPreparing) appQueue.clearAll(); close(); });
  ok.addEventListener("click", () => {
    if (!ready) return;
    const run = ready;
    // F234: the queue run where one failure doesn't stop the rest, where the backend can fetch each package
    // B71a: queued apps go first (their run, then the packages'), so a package's respring can't cut them off
    close().then(() => runConfirmed(run));
  });

  async function refresh() {
    const gen = ++generation;
    ready = null;
    ok.hidden = true;
    const apps = jbAppJobs();
    if (!installQueue.size && !apps.length) { close(); return; }
    m.setTitle("Confirm");
    if (!installQueue.size) { // B71a: only apps: nothing to ask apt
      const plan = appPlan(apps);
      m.scroll.replaceChildren(continueGroup(close), statistics(plan), modifications(plan, appNames(apps)));
      if (footer) m.scroll.append(el("p", "group-footer confirm-stopped", footer));
      ready = { jobs: [], plan: null, ids: [], apps };
      m.left.replaceChildren(cancel);
      ok.hidden = false;
      return;
    }
    m.left.replaceChildren(closer);
    m.scroll.replaceChildren(loading("Checking with apt"));
    const jobs = await withDebUrls(installQueue.list());
    if (gen !== generation) return;
    let r, err = null;
    try { r = await getBackend().simulate(jobs); } catch (e) { err = e; }
    if (gen !== generation) return; // the queue changed while apt was asked; a newer answer is coming
    // F131: apt would pull in a package it can't download (its Filename is a full URL): queue it, so the shell
    // fetches it; the add redraws this sheet.
    if (r?.ok) await queueLinkedDeps(r.plan, jobs, () => gen === generation);
    if (gen !== generation) return;
    const names = await namesFor([...jobs.map((j) => j.id), ...(r ? planIds(r.plan) : [])]);
    if (gen !== generation) return;
    m.scroll.replaceChildren();
    if (err) {
      m.setTitle("Cannot Comply");
      m.scroll.append(refusedGroups(err, jobs, names));
    } else if (!r.ok || r.plan.essential.length) {
      m.setTitle("Cannot Comply");
      await drawIssues(m.scroll, r, names, () => close(), () => gen === generation);
      if (gen !== generation) return;
      m.scroll.append(unqueueGroup(refusalIds(r, jobs), jobs, names));
    } else if (!changeCount(r.plan) && !apps.length) {
      m.left.replaceChildren(cancel);
      m.scroll.append(grouped([{ header: "Modifications", rows: [{ label: "Nothing to change" }],
        footer: "apt says everything queued is already as asked." }]));
    } else {
      // B71a: the queued apps under the same Modifications as apt's packages
      const plan = apps.length ? mergePlans([r.plan, appPlan(apps)]) : r.plan;
      const mods = withWaitNotes(modifications(plan, { ...appNames(apps), ...names }), planIds(r.plan));
      const modsGroup = mods.querySelector(".group");
      m.scroll.append(continueGroup(close), statistics(r.plan), mods);
      markNeededBy(modsGroup, r.plan, jobs, names, catalog); // F234: "needed by X" under what apt added
      const changes = changeCount(r.plan) > 0;
      ready = { jobs: changes ? jobs : [], plan: r.plan, ids: changes ? planIds(r.plan) : [], apps };
      m.left.replaceChildren(cancel);
      ok.hidden = false;
    }
    // Cydia on the 4S (ref/4s/screens/queue-81.png, queue-83.png): Continue Queuing, Statistics, Modifications and no
    // list of the queue; a package comes out of it from its own page (Modify > Clear).
    if (r && (!r.ok || r.plan.essential.length)) m.scroll.append(rawOutput(r.output));
    if (footer) m.scroll.append(el("p", "group-footer confirm-stopped", footer));
  }

  confirm = { refresh, close };
  updateChrome();
  refresh();
}

// ---- F189: work waiting on a queued package (an IPA install on AppSync Unified, screens/ipa-install.js) ---------
//
// whenQueueRuns(id, { note }) -> a promise for what became of the queued package `id`: "installed" (a queue run with
// it went through: its console closes at once, so what waits opens its own), "failed" (the run failed: once its
// console is closed), "cancelled" (cleared from the queue, Confirm's Cancel among them, or the run's Cancel). `note`
// is shown under Confirm's Modifications while it waits.
const waiting = new Map(); // id -> [{ id, note, resolve(outcome), off() }]

export function whenQueueRuns(id, { note = "", queue = installQueue } = {}) {
  return new Promise((resolve) => {
    const entry = { id, note, resolve };
    entry.off = queue.subscribe((e) => {
      if ((e.type === "clear" && e.id === id) || e.type === "clearAll") { detach(id, entry); resolve("cancelled"); }
    });
    waiting.set(id, [...(waiting.get(id) ?? []), entry]);
  });
}

function detach(id, entry) {
  entry.off();
  const list = (waiting.get(id) ?? []).filter((x) => x !== entry);
  if (list.length) waiting.set(id, list); else waiting.delete(id);
}

// The waiters on any of `ids`, taken out (so the run's own clearAll doesn't cancel them); each gets resolve(outcome).
export function takeWaiters(ids) {
  const out = [];
  for (const id of new Set(ids)) {
    for (const entry of [...(waiting.get(id) ?? [])]) { detach(id, entry); out.push(entry); }
  }
  return out;
}

// Confirm's Modifications group (`frag`, grouped()'s one-group fragment) with the waiters' notes on `ids` after it.
// F314: one note per group (AGENTS.md, Hints: never two hints joined in one footer).
function withWaitNotes(frag, ids) {
  const notes = [...new Set(ids.flatMap((id) => (waiting.get(id) ?? []).map((x) => x.note).filter(Boolean)))];
  frag.append(waitNoteGroups(notes));
  return frag;
}
export const waitNoteGroups = (notes) => grouped(notes.map((note) => ({ footer: note })));

// F131: each install job whose version's Filename is a full URL gets that link as `debUrl` (core/queue.js debUrlOf);
// the native backend downloads those itself, since apt would join the link to the repo's URL and 404. F133: with the
// stanza's hashes (debSha256, debMd5), which the shell checks the download against.
async function withDebUrls(jobs) {
  return Promise.all(jobs.map(async (j) => {
    if (j.op !== "install") return j;
    try {
      const link = debLinkOf(await catalog.history(j.id), j.version);
      return link ? { ...j, ...link } : j;
    } catch {
      return j;
    }
  }));
}

// F131: packages apt-get -s would install or upgrade that aren't queued but whose Filename is a full URL go into the
// queue for that version, while live(). True when one was added.
async function queueLinkedDeps(plan, jobs, live) {
  const queued = new Set(jobs.map((j) => j.id));
  let added = false;
  for (const e of [...plan.installs, ...plan.upgrades, ...plan.downgrades]) {
    if (queued.has(e.id)) continue;
    let url = null;
    try { url = debUrlOf(await catalog.history(e.id), e.to); } catch { url = null; }
    if (!live()) return added; // B404: closed, or a newer answer is coming
    if (!url) continue;
    installQueue.add({ op: "install", id: e.id, version: e.to, installed: e.from });
    queued.add(e.id);
    added = true;
  }
  return added;
}

function loading(text) {
  const p = el("div", "loading");
  p.append(el("span", "loading-spinner"), el("span", null, text));
  return p;
}

const planIds = (plan) => MODES.flatMap((mode) => plan[`${mode}s`].map((e) => e.id));

async function namesFor(ids) {
  const out = {};
  for (const j of installQueue.list()) if (j.name) out[j.id] = j.name;
  try {
    const info = await catalog.queueInfo([...new Set(ids)]);
    for (const [id, v] of Object.entries(info ?? {})) if (v?.name) out[id] = v.name;
  } catch { /* names fall back to ids */ }
  return out;
}

// Cydia's Statistics group: the download size, when apt says one.
function statistics(plan) {
  return plan.download ? grouped([{ header: "Statistics", rows: [{ label: "Downloading", detail: plan.download }] }]) : document.createDocumentFragment();
}

// Cydia's Modifications: one row per non-empty list, its names one per line.
// F91: the app queue's Confirm passes its own modes (core/appqueue.js APP_MODES: Re-sign among them).
// F401: `tweaks` { app id: [name] }, the tweaks queued with an app, small and grey under its name.
function modifications(plan, names, modes = MODES, labels = MODE_LABEL, tweaks = {}) {
  const rows = [];
  for (const mode of modes) {
    const list = plan[`${mode}s`] ?? [];
    if (!list.length) continue;
    rows.push({ label: labels[mode], detail: list.map((e) => names[e.id] || e.id).join("\n") });
  }
  const frag = grouped([{ header: "Modifications", rows }]);
  frag.querySelectorAll(".cell").forEach((c) => c.classList.add("confirm-mods"));
  if (Object.keys(tweaks).length) {
    const lists = modes.map((m) => plan[`${m}s`] ?? []).filter((l) => l.length);
    [...frag.querySelectorAll(".cell-detail")].forEach((d, i) => {
      if (!lists[i]?.some((e) => tweaks[e.id])) return;
      d.replaceChildren(...lists[i].map((e) => {
        const n = el("span", "confirm-name", names[e.id] || e.id);
        if (tweaks[e.id]) n.append(el("span", "confirm-needed", `with ${tweaks[e.id].join(", ")}`));
        return n;
      }));
    });
  }
  return frag;
}


function continueGroup(close) {
  const g = grouped([{ rows: [{ label: "Continue Queuing", chevron: true, onClick: () => close() }] }]);
  g.querySelector(".group")?.classList.add("confirm-continue"); // centred, Cydia's blue-grey (queue.css)
  return g;
}

// B404: Cannot Comply when ifizbox-helper couldn't ask apt: which package and why in plain words, wrapped whole.
function refusedGroups(err, jobs, names) {
  const why = helperRefusal(err.message || String(err), jobs, names);
  const frag = refusedBlock(why);
  frag.append(unqueueGroup(why.ids, jobs, names));
  return frag;
}

// Its red block of whole sentences (helperRefusal's answer); B409: the shared .deb's sheet (screens/sharedeb.js) too.
export function refusedBlock(why, footer = null, header = "Couldn't Ask apt") {
  const frag = grouped([{ header, rows: why.sentences.map(() => ({ label: "" })),
    footer: why.missing ? `Reinstalling ${NAME} puts it back.` : footer }]);
  const g = frag.querySelector(".group");
  g.classList.add("confirm-problem", "confirm-issues");
  [...g.querySelectorAll(".cell")].forEach((li, i) => li.replaceChildren(el("div", "pkg-description", why.sentences[i])));
  return frag;
}

// B404: Cannot Comply's way out: a red row per queued package that caused it (every queued one when the cause names
// none) takes just that one out of the queue; the queue's own change asks apt again with the rest.
function unqueueGroup(ids, jobs, names) {
  const list = ids.length ? ids : jobs.map((j) => j.id);
  return grouped([{ rows: list.map((id) => ({ label: `Remove ${names[id] || id} from Queue`, cls: "confirm-unqueue",
    onClick: () => installQueue.clear(id) })) }]);
}

// Cannot Comply: F18's sentences (and actions) first, then what Cydia would also call an issue: essentials.
async function drawIssues(box, r, names, close, live = () => true) {
  const frag = document.createDocumentFragment();
  let problems = [];
  if (!r.ok) {
    try { problems = (await catalog.aptProblems(r.output)) ?? []; } catch { problems = []; }
    if (!live()) return;
  }
  const sentences = [
    ...(r.issues ?? []).map((sentence) => ({ sentence })), // F131: a link that couldn't be downloaded
    ...r.plan.essential.map((id) => ({ sentence: `Removing ${names[id] || id} would take away part of the jailbreak itself (an essential package), so ${NAME} won't do it.` })),
    ...problems,
  ];
  if (!sentences.length) sentences.push({ sentence: `apt refused this queue${r.code ? ` (exit ${r.code})` : ""}. Its own words are below.` });
  sentences.forEach((p, i) => {
    const row = actionRow(p, close);
    const t = grouped([{ rows: row ? [row] : [] }]).firstElementChild;
    const ul = t.querySelector("ul") ?? el("ul", "table grouped");
    const li = el("li", "cell");
    li.append(el("div", "pkg-description", p.sentence));
    ul.prepend(li);
    if (!ul.parentNode) t.append(ul);
    t.classList.add("confirm-problem");
    if (i === 0) { t.classList.add("confirm-issues"); t.prepend(el("h2", "group-header", "Can't Do This Yet")); }
    if (p.detail) t.append(el("p", "group-footer", p.detail));
    frag.append(t);
  });
  box.append(frag);
}

// F18's actions: open | remove | add-source | refresh | settings (the last has no page in the app: the iOS version is known).
function actionRow(p, close) {
  const a = p.action;
  if (!a) return null;
  switch (a.kind) {
    case "open": return { label: a.label, chevron: true, onClick: () => close().then(() => ctxRef?.go({ tab: "search", path: [`package:${a.id}`] })) };
    case "remove": return { label: a.label, onClick: () => getBackend().queue({ op: "remove", id: a.id }) };
    case "add-source": return { label: a.label, subtitle: a.url, chevron: true, onClick: () => close().then(async () => {
      const { addSource } = await import("./manage.js");
      addSource(ctxRef, { url: a.url });
    }) };
    case "settings": return null;
    // F378: apt can't read a list file: Changes' Refresh (Reloading Data) downloads the lists again.
    case "refresh": return { label: a.label, onClick: () => close().then(async () => {
      const { reloadSources } = await import("./changes.js");
      await reloadSources();
    }) };
    default: return null;
  }
}

function rawOutput(text) {
  const g = el("div", "group");
  g.append(el("h2", "group-header", "apt's Output"));
  const pre = el("pre", "table grouped confirm-raw", String(text ?? "").trim() || "(no output)");
  g.append(pre);
  return g;
}

// ---- the sideload app's (and the website's) queue: apps signed on the phone (F80) -------------------------------
//
// Cydia's flow without apt: an app page's Install / Upgrade / Reinstall (altstore.js appPageAction) and Changes'
// Upgrade (N) queue apps (app-queue.js) and open this Confirm sheet: Statistics (the download), Modifications
// (Install, Upgrade... with the names, and a tweak's dependencies once tweaks have them: core/appqueue.js appPlan),
// the Queue (tap one to clear it) and Continue Queuing; Cancel at the top left clears the queue, Confirm at the top
// right installs it in turn (runAppQueue), each signed on the phone, iFizBox itself last.
// F235: in the sideload app Confirm's run is runAppQueueRun (screens/apprun.js): every app signed ahead, then handed
// to iOS one at a time on the black page with rows; runAppQueue stays for the website and Manage's bulk actions.

let appConfirm = null;  // the open Confirm sheet for apps: { refresh(), close() }
// F272: the "Hold Installed to see the queue" hint and the hold on the tab (nav/queuehint.js), told of every badge
// change. Built once the tab bar is in the page; its remember flag lives in Settings' storage (settings.queueHint),
// taken from screens/settings.js once loaded (that module imports this one, so not at the top).
let hint = null, hintLoading = false, lastHint = null;
function updateHint(h) {
  lastHint = h;
  if (hint) { hint.update(h); return; }
  const bar = globalThis.document?.getElementById?.("tabbar");
  if (hintLoading || !bar) return;
  hintLoading = true;
  import("./settings.js").then((m) => {
    hint = createQueueHint({ bar, store: m.settings.queueHint });
    hint.update(lastHint);
  }, () => { hintLoading = false; });
}
let appRunning = false; // Confirm's installs are going: queuing adds without opening a second sheet
export const appQueueRunning = () => appRunning; // B66: Manage says so instead of runAppQueue's quiet 0

// ---- B81: the app queue's Q'd badge and Queue button (the sideload app and the site) ------------------------------
//
// The apt queue's updateChrome above, driven by appQueue: Installed's badge reads Q'd while apps are queued and neither
// Confirm nor a run is up; Installed's root has a Queue button that reopens Confirm. It goes on the left, as Cydia's
// Installed has it, in the Wish List button's place (hidden while Queue shows; Manage keeps the right). Manage on
// hides Queue (the left button is Select… then). installed.js init starts it and tells it when Manage turns.

const appChrome = { ctx: null, queue: appQueue, managing: false };

// What the chrome shows for a state. -> { badge: "Q'd" | null, button: boolean }
export function appChromeState({ size = 0, confirmOpen = false, running = false, managing = false } = {}) {
  return { badge: size > 0 && !confirmOpen && !running ? "Q'd" : null, button: size > 0 && !running && !managing };
}

export function initAppQueueChrome(ctx, { queue = appQueue } = {}) {
  appChrome.ctx = ctx;
  appChrome.queue = queue;
  queue.subscribe(() => updateAppChrome());
  // Installed's root nav bar is built when the tab is first shown: put the button in after each route change too.
  globalThis.addEventListener?.("hashchange", () => (globalThis.requestAnimationFrame ?? setTimeout)(() => updateAppChrome()));
  (globalThis.requestAnimationFrame ?? setTimeout)(() => updateAppChrome());
}

// installed.js setManaging: Manage on hides Queue, off brings it back.
export function setAppChromeManaging(on) {
  appChrome.managing = Boolean(on);
  updateAppChrome();
}

// Installed's root page (its nav/go.js pageHandle), from installed.js render each time it draws the root: the Queue
// button goes on its nav bar (apt's on the right, the IPA queue's on the left). Null until the root is first drawn.
let installedRoot = null;

export function setInstalledRoot(page) {
  installedRoot = page ?? null;
  if (ctxRef) updateChrome();
  if (appChrome.ctx) updateAppChrome();
}

const installedRootLeft = () => installedRoot?.left?.() ?? null;

// `left`: the root's left slot (tests pass their own). -> the state drawn.
export function updateAppChrome({ left, open = () => openAppConfirm(appChrome.queue) } = {}) {
  if (!appChrome.ctx && !left) return null; // not started (the jailbreak app: updateChrome follows apt's queue)
  left ??= installedRootLeft();
  const s = appChromeState({ size: appChrome.queue.size, confirmOpen: Boolean(appConfirm) || Boolean(appChrome.starting),
    running: appRunning, managing: appChrome.managing });
  appChrome.ctx?.setBadge?.("installed", s.badge);
  if (appChrome.ctx) updateHint({ queued: appChrome.queue.size > 0, badge: Boolean(s.badge), open }); // F272
  if (!left) return s;
  let b = left.querySelector(".queue-button");
  if (s.button && !b) {
    b = barButton("Queue", "done queue-button");
    b.addEventListener("click", () => open());
    left.prepend(b);
  } else if (!s.button && b) b.remove();
  const wish = left.querySelector(".wish-button");
  if (wish) wish.style.display = s.button ? "none" : "";
  return s;
}

// Queues an app (a core/appqueue.js job) and opens Confirm, or redraws the open one. -> the job.
export function queueApp(job, { queue = appQueue, open = openAppConfirm } = {}) {
  const j = queue.add(job);
  if (!appRunning) open(queue);
  return j;
}

// F235: `footer` under the sheet (a cancelled run's "Stopped. N installed and cleared from the queue."); Confirm runs
// the sign-ahead run (runAppQueueRun) in the sideload app, the old one at a time run elsewhere (the website).
export function openAppConfirm(queue = appQueue, { footer = null, run = null } = {}) {
  if (appConfirm) { appConfirm.refresh(); return; }
  if (!queue.size) return;
  const cancel = confirmCancel();
  const ok = barButton("Confirm", "done");
  const m = modal({ title: "Confirm", left: cancel, right: ok, cls: "confirm-sheet" });
  // A Clear (here or on an app page's Modify) or a run's progress redraws it; an add redraws it through queueApp.
  const off = queue.subscribe((e) => { if (e.type !== "add") refresh(); });
  const close = () => { off(); if (appConfirm === sheet) appConfirm = null; updateAppChrome(); return m.close(); };
  cancel.addEventListener("click", () => { close(); queue.clearAll(); });
  ok.addEventListener("click", () => {
    const jobs = queue.list();
    appChrome.starting = true; // B81: no Q'd flash while the sheet slides down and the run starts
    close().then(async () => {
      const go = run ?? ((await useAppRun()) ? runAppQueueRun : runAppQueue);
      appChrome.starting = false;
      const p = go(jobs, { queue }); // sets appRunning before its first await
      updateAppChrome();
      return p;
    });
  });
  function refresh() {
    const jobs = queue.list();
    if (!jobs.length) { close(); return; }
    const names = {}, tweaks = {};
    for (const j of jobs) {
      if (j.name) names[j.id] = j.name;
      for (const d of j.deps ?? []) if (d?.name) names[d.id] = d.name;
      if (j.tweaks?.length) tweaks[j.id] = j.tweaks.map((t) => t.name); // F401
    }
    // As Cydia's (ref/4s/screens/queue-81.png): Continue Queuing first, then Statistics and Modifications.
    m.scroll.replaceChildren(continueGroup(close), statistics(appPlan(jobs)), modifications(appPlan(jobs), names, APP_MODES, APP_MODE_LABEL, tweaks));
    if (footer) m.scroll.append(el("p", "group-footer confirm-stopped", footer));
  }
  const sheet = { refresh, close };
  appConfirm = sheet;
  refresh();
  updateAppChrome();
}


// One app: signed on the phone in the sideload app (installOnDevice; iFizBox's own IPA through signAndInstall, which
// hosts it on the Signing Server). The website queues nothing (F89). True once iOS was asked.
async function installApp(job) {
  const sc = await import("../signing-client.js");
  if (job.mode === "resign") return resignApp(job, { sc });
  if (job.options && sc.localSigning()) return installCustom(job, { sc });
  if (sc.localSigning() && !sc.isSelfIpa(job.url)) return sc.installOnDevice({ url: job.url, name: job.name || "", ...listedOf(job) });
  return sc.signAndInstall(siteInstallArgs(job));
}

// F262: what signAndInstall gets for a queued job: its url and name, and the app's own bundle ID and version (as
// browse.js passes them), so the website's early link opens iOS's prompt at the tap with Keep Bundle IDs on
// (signing-client.js expectedBundleId) instead of waiting on Ready to Install. The job's id is the source's
// bundleIdentifier (core/appqueue.js appJob); a My IPAs id (`library:<file>`) or one renamed by Sign Options isn't
// what the plain sign gives, so it goes without one (the slow way).
export function siteInstallArgs(job) {
  const args = { url: job.url, name: job.name || "" };
  const id = typeof job.bundleId === "string" && job.bundleId ? job.bundleId : job.id;
  if (typeof id === "string" && id && !id.startsWith("library:") && !job.library && !job.options?.edits?.bundleId) args.bundleId = id;
  const version = job.version || job.installed;
  if (version) args.version = String(version);
  return args;
}

// F84: a Custom Install job: signing.install with its own options (core/appqueue.js customParams: the look's token
// while fresh, else the url, and the edits), then iOS's progress on the HUD as the sheet did (signing-sheet.js
// followInstall). The token is spent by the try, so a failed run that keeps the job queued downloads it again next time.
export async function installCustom(job, { sc, follow = null, now = Date.now(), native = nativeBridge() } = {}) {
  const credit = (await import("../core/installed.js")).sourceCredit(job); // B247: the source's app, kept on the signed record
  const params = { ...customParams(job, now), ...(credit ? { credit } : {}) };
  if (params.token) job.options.token = null;
  const after = follow ?? (async (result, h) => (await import("../signing-sheet.js")).followInstall(native, result?.bundleId || job.options.signsAs || "", h));
  return sc.installOnDevice({ url: job.url, name: job.options.name || job.name || "", params,
    after, ...listedOf(job), ...(sc.isSelfIpa(job.url) ? { host: true } : {}) });
}

// F91: a "resign" job: signing.resign {bundleId} signs the app again from the phone's record (Re-sign All's path,
// one app) and opens iOS's install, the HUD following it; iFizBox's own is hosted on the Signing Server, as its
// install is (iOS closes iFizBox). True once iOS was asked.
// F221: a marked app's re-sign (core/appqueue.js markedResignJob) has no record on the phone to sign from: its url,
// the installed version on the source, is downloaded, signed and installed over the app as an Install is
// (`deps`: installOnDevice's, for tests). signing.install records it, so it is a signed app with a pill from then on.
export async function resignApp(job, { sc, native = nativeBridge(), hud = null, alert = showAlert, deps, stallOpts = null } = {}) {
  sc ??= await import("../signing-client.js");
  if (job.url) {
    if (sc.localSigning() && !sc.isSelfIpa(job.url)) return sc.installOnDevice({ url: job.url, name: job.name || "", ...listedOf(job) }, deps);
    return sc.signAndInstall(siteInstallArgs(job));
  }
  const { resignLabel, deviceError, callWithStall } = await import("../core/signing.js");
  const h = hud ? hud("Re-signing") : progressHUD("Re-signing"); // F151: the progress page
  const fail = (message) => (typeof h.fail === "function" ? h.fail(message) : h.hide());
  let r;
  // Settings > Installation's route: This iPhone needs no server and no hosting (installd updates iFizBox in place)
  const route = sc.chooseRoute ? await sc.chooseRoute({ native, alert }) : {};
  if (!route) { h.hide(); return false; }
  try {
    if (!native?.call) throw new Error(`Re-signing needs the ${NAME} app.`);
    // B65: a phase that goes quiet fails the job with where it stopped (callWithStall); the shell's lines go to the log
    r = await callWithStall(native, "signing.resign", { bundleId: job.id, manifestServer: sc.getServer(), ...(job.id === SELF_ID && !route.route ? { host: true } : {}), ...route },
      (ev) => {
        if (ev?.log) h.page?.raw?.(ev.log);
        const t = resignLabel(ev);
        if (t) h.set(t.replace(/ \(1 of 1\)$/, ""));
      }, stallOpts ?? undefined);
  } catch (e) {
    const why = deviceError(e, job.name || job.id);
    fail(why.message);
    await alert({ title: `Couldn't Re-sign ${job.name || job.id}`, message: why.message, buttons: ["OK"] });
    return false;
  }
  const failed = Array.isArray(r?.failed) ? r.failed : [];
  if (failed.length || !(r?.done ?? []).length) {
    const message = failed.map((f) => f.error || "failed").join("\n") || "Nothing was signed.";
    fail(message);
    await alert({ title: `Couldn't Re-sign ${job.name || job.id}`, message, buttons: ["OK"] });
    return false;
  }
  if (job.id === SELF_ID && typeof h.finish === "function") { lockSelfUpdate(h); return true; } // B49: iOS closes iFizBox
  if (typeof h.done === "function") h.done("Done"); else h.hide();
  return true;
}

// F30/I3: the version Install put on the phone, so Installed and Changes follow it (iFizBox records itself).
async function recordApp(job) {
  saveCustomIpa(job); // F379
  if (job.id === SELF_ID || job.mode === "resign") return; // F91: a re-sign changes no version
  const { apps, recordInstall } = await import("../core/installed.js");
  await recordInstall(await apps(), { id: job.id, name: job.name, version: job.version, key: job.key, source: job.source,
    sourceName: job.sourceName || "", icon: job.icon });
}

// F379: a Custom Install that landed saves its IPA in My IPAs with its edits (core/appqueue.js customInstallSave,
// core/myipas.js saveInstalledIpa), not awaited: the run goes on while it downloads.
export function saveCustomIpa(job, { native = nativeBridge() } = {}) {
  if (typeof native?.call !== "function") return null;
  return import("../core/appqueue.js").then(async (q) => {
    const what = q.customInstallSave(job);
    if (!what) return null;
    return (await import("../core/myipas.js")).saveInstalledIpa(what, { call: (m, p) => native.call(m, p) });
  }).catch(() => null);
}

// The sideload app's first install with something missing opens the Signing walkthrough (F75) instead: nothing runs.
// F291: first the safety nets (screens/safety.js installSafety: Known Malware, a reported version, the exploitable-iOS
// alert once); nothing runs when they stop it.
async function readyToInstall(jobs = []) {
  if (!(await (await import("./safety.js")).installSafety(jobs))) return false;
  const sc = await import("../signing-client.js");
  return !(sc.localSigning() && await sc.firstInstallCheck());
}

// Confirm's run: each app in turn (runOrder: iFizBox last), each one out of the queue once iOS has it; the first
// failure (its alert already shown) stops the run and leaves the rest queued. -> how many were installed.
// B264: Changes counts its badge (and the icon's) again, as an app's re-sign or install ends (screens/changes.js).
export const recountChanges = () => import("./changes.js").then((m) => m.recountBadge()).catch(() => {});
// B310: a package run has ended: Changes' badge and the icon's drop what it installed or removed at once.
export const countAfterRun = (ids) => import("./changes.js").then((m) => m.badgeAfterRun(ids)).catch(() => {});

export async function runAppQueue(jobs, { queue = appQueue, install = installApp, record = recordApp, ready = readyToInstall, recount = recountChanges } = {}) {
  if (appRunning) return 0;
  appRunning = true;
  updateAppChrome();
  let done = 0;
  try {
    if (!(await ready(jobs))) return 0;
    for (const j of runOrder(jobs)) {
      if (!queue.get(j.id)) continue; // cleared meanwhile
      let ok = false;
      try { ok = await install(j); } catch { ok = false; }
      if (!ok) break;
      done++;
      queue.clear(j.id);
      try { await record(j); } catch { /* no store: Installed won't list it */ }
      recount(); // B264: a re-sign records nothing here, so nothing else counts it
    }
  } finally {
    appRunning = false;
    updateAppChrome();
  }
  return done;
}

// F235: the sideload app signs every app first and hands them to iOS one at a time, on the black page with rows
// (screens/apprun.js); the website keeps runAppQueue (it signs in the browser, one app at a time).
async function useAppRun() {
  const sc = await import("../signing-client.js");
  return sc.localSigning() && typeof sc.prepareOnDevice === "function";
}

// Confirm's run in the sideload app: every app downloaded and signed ahead, then given to iOS in order (iFizBox last),
// each waiting for iOS to install the one before. A failure or a row's stop ends that app only; Cancel abandons the
// rest and reopens Confirm with what finished cleared. -> the run's first end ({ ok, stopped, rows, installed }), or
// null when the Signing walkthrough opened instead.
// B257: from Confirm (once the safety nets and the Signing walkthrough have let it run) the app is kept running in the
// background (signing.hold) while any app signs or installs, and let go once none does or the page closes
// (signing/queue.js heldLanes); `keep` stands in for holdApp (tests).
export async function runAppQueueRun(jobs, { queue = appQueue, record = recordApp, ready = readyToInstall, run = null, lanes = null, keep = null, recount = recountChanges } = {}) {
  if (appRunning) return null;
  appRunning = true;
  updateAppChrome();
  let held = null;
  try {
    if (!(await ready(jobs))) { appRunning = false; updateAppChrome(); return null; }
    const sc = await import("../signing-client.js");
    const hold = keep ?? sc.holdApp;
    hold(undefined, true); // Confirm
    held = { release: () => hold(undefined, false) }; // until the lanes below take it over
    const { runAppRun, phoneLanes } = await import("./apprun.js");
    // B137: on Settings > Installation's This iPhone route the rows say Installing, not Tap Install (no iOS prompt)
    // F366: not once the run's Use the Signing Server sent its failed apps through the Signing Server
    const phone = lanes ? null : phoneLanes(sc);
    held = sc.heldLanes(lanes ?? { ...phone, local: () => !phone.serverRoute() && storedRoute() === "iphone" }, { keep: hold });
    const lanesHeld = held;
    return await (run ?? runAppRun)(jobs.filter((j) => queue.get(j.id)), {
      queue, record, lanes: lanesHeld,
      // B264: each app's end counts the badge again once its record is written. Not held: in the background the page
      // can sleep mid-count, and a hold would keep the shell's silent audio going until then; the shell drops the
      // app's row from the icon itself at the hand-off (BackgroundCheck.appHandedOff).
      onAppEnd: (r, recorded) => Promise.resolve(recorded).catch(() => {}).then(() => recount()),
      onClose: () => { lanesHeld.release(); appRunning = false; updateAppChrome(); },
      reopenConfirm: (footer) => { appRunning = false; openAppConfirm(queue, { footer }); },
    });
  } catch (e) {
    held?.release();
    appRunning = false;
    updateAppChrome();
    throw e;
  }
}

// ---- B71a: AltStore apps in the jailbreak app's queue ------------------------------------------------------------
//
// The jailbreak app can't sign (the app queue's run above refuses there), so its queued apps (app-queue.js: Install,
// Upgrade, Reinstall, Downgrade or Remove from a row's swipe or hold menu, or an app page's Modify) run through the
// root helper instead: AppSync Unified first when an install needs it (ipa-install.js ensureAppSync: its own apt
// Confirm, then on), then the black page with rows (screens/apprun.js runAppRun on helperLanes): each IPA to the
// helper's install-ipa, each Remove to its uninstall-app, one at a time. Confirm (openConfirm) lists the apps beside
// apt's packages and runs them first; the packages' run follows once the apps' page closes.

let appPreparing = false; // AppSync Unified is being got for a jailbreak app run: its own Confirm leaves the apps out

// The queued apps the jailbreak Confirm and chrome show: none while their run is preparing or going.
const jbAppJobs = () => (appRunning || appPreparing ? [] : appQueue.list());

function appNames(jobs) {
  const out = {};
  for (const j of jobs) if (j.name) out[j.id] = j.name;
  return out;
}

// Confirm's Confirm: the apps' run, then the packages' (when apt agreed to some).
function runConfirmed(run) {
  const apt = (r) => (typeof getBackend().queueFetch === "function" ? runQueueRun(r) : runConsole(r));
  if (!run.apps?.length) return run.jobs.length ? apt(run) : undefined;
  return runJailbreakApps(run.apps, { after: run.jobs.length ? () => afterApps(run, apt) : null });
}

// Once the apps' page closes: the packages Confirm agreed to, while the queue still holds just those; else (AppSync's
// run took them, or the queue changed) Confirm asks apt again for what is left.
export function afterApps(run, apt, { queue = installQueue, open = openConfirm } = {}) {
  const same = queue.size === run.jobs.length && run.jobs.every((j) => queue.get(j.id));
  if (same) return apt(run);
  if (queue.size) open();
  return undefined;
}

// AppSync Unified before any install (a run of Removes needs none). -> { respring? } to go on, null to stop (Cancel,
// or its fallback alert's OK): the apps stay queued.
export async function appSyncFirst(jobs, { ipa = null } = {}) {
  if (!jobs.some((j) => j.op !== "remove")) return {};
  const m = ipa ?? (await import("./ipa-install.js"));
  for (;;) {
    let got;
    try { got = await m.ensureAppSync({ name: jobs.length === 1 ? jobs[0].name || "" : "" }); } catch { got = { ok: false, step: "install" }; }
    if (got?.cancelled) return null;
    if (got?.installed) m.setAppSyncRespring(true); // B61: its SpringBoard hook loads on a respring
    if (got?.ok) return got;
    if (!(await m.appSyncFallback(got?.step ?? "install"))) return null;
  }
}

// Installed's record follows the run: an install recorded at its version (recordApp), a Remove forgotten.
async function recordJbApp(job) {
  if (job.op !== "remove") return recordApp(job);
  const { apps, removeInstall } = await import("../core/installed.js");
  await removeInstall(await apps(), job.id);
}

// The jailbreak app's run of queued apps. `after(result)`: once its page closes, unless it was cancelled (Cancel
// reopens Confirm with what finished cleared). Stand-ins for tests: prepare (appSyncFirst), run (runAppRun), lanes,
// record. -> runAppRun's first end, or null when it didn't start (a run is up, or AppSync's step stopped it).
export async function runJailbreakApps(jobs, { queue = appQueue, prepare = appSyncFirst, run = null, lanes = null, record = recordJbApp,
  after = null, finish = null, safety = async (j) => (await import("./safety.js")).installSafety(j) } = {}) {
  if (appRunning || appPreparing || running) return null;
  // F291: Known Malware and reported versions ask first here too (the jailbreak build skips the iOS-version alert)
  try { if (!(await safety(jobs))) return null; } catch { /* the check failing never blocks an install */ }
  appPreparing = true;
  updateChrome();
  let ready;
  try { ready = await prepare(jobs); } catch { ready = null; } finally { appPreparing = false; }
  const queued = jobs.filter((j) => queue.get(j.id));
  if (!ready || !queued.length) { updateChrome(); if (ready === null && queue.size) confirm?.refresh(); return null; }
  appRunning = true;
  updateChrome();
  try {
    const page = await import("./apprun.js");
    let fin = finish;
    if (!lanes || !fin) {
      const [ipa, low] = await Promise.all([import("./ipa-install.js"), import("../ipa-install.js")]);
      lanes ??= page.helperLanes({ backend: getBackend(), install: low.runIpaInstall, needs: ipa.ipaNeeds });
      fin ??= () => (ipa.appSyncRespringPending() ? ipa.ipaFinish({ ok: true }) : null);
    }
    return await (run ?? page.runAppRun)(queued.map((j) => ({ ...j, helper: true })), {
      queue, record, lanes, finish: fin,
      onClose: (result) => { appRunning = false; updateChrome(); if (!result?.stopped) after?.(result); },
      reopenConfirm: (footer) => { appRunning = false; openConfirm({ footer }); },
    });
  } catch (e) {
    appRunning = false;
    updateChrome();
    throw e;
  }
}

// ---- the console -----------------------------------------------------------------------------------------------

// F71: Roll Back runs in the same console: one stored .deb through backend.rollback, outside the queue (whatever is
// queued stays queued). False when a console is already up.
export function runRollback({ id, version, installed = null, name = "" }) {
  if (running) return false;
  const jobs = [{ op: "install", id, version, installed, name, mode: "rollback" }];
  runConsole({ jobs, ids: [id], keepQueue: true, asks: false, title: (names) => `Roll Back ${name || names[id] || id} to ${version}`,
    run: (onEvent) => getBackend().rollback(id, version, onEvent) });
  return true;
}

// F74: a paid package's Download & Install (screens/extras.js) in the same console: `run(onEvent)` is the shell's
// paid.install with stream on (its dlstatus/pmstatus lines like ipa.install). Outside the queue. Null when a console
// is already up; else a promise for the run's end ({ ok, reloaded }: reloaded settles once dpkg status is read again).
export function runPaidInstall({ id, version, name = "", run }) {
  if (running) return null;
  const jobs = [{ op: "install", id, version, installed: null, name, mode: "install" }];
  return runConsole({ jobs, ids: [id], keepQueue: true, asks: false, title: (names) => `Install ${name || names[id] || id} ${version}`, run });
}

// F234: Confirm's run on screens/queuerun.js: downloads 3 at a time, one dpkg lane, a failure skips only what needs
// it. What installed leaves the queue as it goes; failed, skipped and cancelled packages stay queued. F189's waiters
// get each package's own outcome once the page closes.
async function runQueueRun({ jobs, plan, ids }) {
  running = true;
  updateChrome();
  const waiters = takeWaiters(ids);
  const names = await namesFor(ids);
  return runQueue({ jobs, plan }, {
    backend: getBackend(), catalog, queue: installQueue, runLogs, names, finishAction,
    setBadge: (text) => ctxRef?.setBadge?.("installed", text),
    onEnd: (result) => countAfterRun((result?.rows ?? []).filter((r) => r.state === "installed").map((r) => r.id)), // B310
    onClose: (result) => {
      running = false;
      updateChrome();
      for (const w of waiters) {
        const st = result?.rows?.find((r) => r.id === w.id)?.state;
        w.resolve(st === "installed" ? "installed" : st === "cancelled" || !result ? "cancelled" : "failed");
      }
    },
    reopenConfirm: (footer) => openConfirm({ footer }),
  });
}

// asks: the run is apply-ask (F63), so a conffile line opens the Configuration Upgrade alert and its answer goes back
// through backend.answerConffile; otherwise dpkg keeps the old copy (--force-confold) and the console says so.
// F151: the page is nav/progress.js (steps bold, dpkg's output monospace, errors red with the x badge, auto-scroll),
// and its button follows what was done (core/progress.js chooseFinish): the scripts' finish: lines and the kinds of
// package changed (a tweak: Restart SpringBoard; an app: Reload Data).
async function runConsole({ jobs, ids, keepQueue = false, asks = true, title = null, run = (onEvent) => getBackend().apply(jobs, onEvent) }) {
  running = true;
  updateChrome();
  // F64: Cancel while apt only downloads (a queue run, apply-ask: the helper reads its stdin); gone once dpkg starts.
  const canCancel = asks && typeof getBackend().cancelApply === "function";
  let onCancel = () => {};
  const page = openProgress({ onCancel: () => onCancel() });
  page.cancellable(canCancel);

  const log = [];
  // F361: kept in Console Logs from the start, each line saved as it comes (a run that hangs or is killed keeps its log)
  const logJobs = jobs.map((j) => ({ op: j.op, id: j.id, version: j.version, mode: j.mode }));
  const live = runLogs.start({ title: title ? title({}) : runTitle(jobs), jobs: logJobs });
  const fresh = createRepeatFilter(); // C6: apt's "Retrieving file 1 of N" shows once, not once per percent
  const line = (type, text) => {
    if (!fresh(type, text)) return;
    log.push(type === "info" ? text : type === "error" ? `E: ${text}`.replace(/^E: E: /, "E: ") : type === "warning" ? text : `» ${text}`);
    live.line(log[log.length - 1]);
    page.line(type === "status" ? "step" : type === "info" ? "raw" : type, text);
  };
  page.progress(0);

  const names = await namesFor(ids);
  const label = (pkg) => names[pkg] || pkg;
  const levels = [];
  let kinds = [];
  try {
    const info = await catalog.queueInfo(ids);
    kinds = Object.values(info ?? {}).map((v) => v?.kind ?? (v?.restart ? "tweak" : "package"));
  } catch { /* the scripts' own finish lines still count */ }

  let result = null, error = null, ended = false;
  let cancelled = false, dpkg = false;
  let cancelling = false;
  const dpkgStarted = () => { dpkg = true; page.cancellable(false); };
  onCancel = async () => {
    if (cancelling || dpkg || ended) return;
    cancelling = true;
    page.cancellable(true, { disabled: true });
    page.status("Cancelling");
    try {
      await getBackend().cancelApply();
      cancelled = true;
      page.cancellable(false);
    } catch (e) {
      if (ended) return;
      line("error", `Couldn't cancel: ${e.message || String(e)}`);
      if (dpkg) page.cancellable(false); else { page.cancellable(true); cancelling = false; }
    }
  };
  // F63: dpkg waits on one question at a time; alerts are shown one after another all the same.
  let asking = Promise.resolve();
  const ask = (file) => {
    asking = asking.then(async () => {
      const { index } = await showAlert({ title: CONFFILE_TITLE, message: conffileMessage(file), buttons: CONFFILE_BUTTONS, cancel: 0, stacked: true });
      if (ended) return;
      const answer = conffileAnswer(index);
      try {
        await getBackend().answerConffile(answer);
        line("status", conffileLine(file, answer));
      } catch (e) {
        line("error", `Configuration file ${file}: ${e.message || String(e)}`);
      }
    });
  };
  const canAsk = asks && typeof getBackend().answerConffile === "function";
  try {
    result = await run(({ fd, line: raw }) => {
      if (fd === "status" && !dpkg && /^pm(status|conffile|error):/.test(String(raw ?? ""))) dpkgStarted();
      const c = classify({ fd, line: raw });
      if (!c) return;
      switch (c.kind) {
        case "finish": levels.push(c.finish); return;
        case "conffile":
          if (c.percent != null) page.progress(c.percent);
          page.status(`Configuration file ${c.file}`);
          if (canAsk) ask(c.file);
          else line("status", conffileLine(c.file, "keep"));
          return;
        case "step": {
          const text = c.pkg ? c.text.replaceAll(c.pkg, label(c.pkg)) : c.text;
          if (c.percent != null && !c.download) page.progress(c.percent);
          page.status(text);
          line("status", text);
          return;
        }
        case "error": line("error", c.pkg ? `${label(c.pkg)}: ${c.text}` : c.text); return;
        case "warning": line("warning", c.text); return;
        default: line("info", c.text);
      }
    });
  } catch (e) {
    error = e;
  }
  ended = true;
  page.cancellable(false);

  const ok = result?.code === 0 && !error;
  // F64: the helper stopped apt before dpkg ran (SIGINT: exit 130). A run that went through anyway counts as done.
  const stopped = cancelled && !ok && !dpkg;
  if (error) line("error", error.message || String(error));
  else if (stopped) line("status", "Cancelled. Nothing was installed or removed; the queue is kept.");
  else if (!ok) {
    line("error", `apt-get stopped with exit code ${result.code}. Nothing after the error above was done.`);
    try {
      const problems = (await catalog.aptProblems([result.stdout, result.stderr].join("\n"))) ?? [];
      for (const p of problems) line("error", p.sentence);
    } catch { /* the raw lines above say it */ }
  }

  const choice = chooseFinish({ ok, levels: [...levels, ...selfLevels(jobs)], kinds });
  live.set({ title: title ? title(names) : runTitle(jobs.map((j) => ({ ...j, name: j.name || names[j.id] }))) });
  live.end({ code: error ? -1 : result.code, cancelled: stopped, finish: choice.level, text: log.join("\n") });
  // F189: what waited on a package of this run (whenQueueRuns), out before clearAll would cancel it.
  const waiters = keepQueue ? [] : takeWaiters(ids);
  // A run that went through empties the queue; one apt stopped keeps it, so Confirm can show what's left to fix.
  if (ok && !keepQueue) installQueue.clearAll();
  if (ok) countAfterRun(jobs.map((j) => j.id)); // B310
  const reloaded = catalog.reloadInstalled?.().catch(() => {});

  page.onClose(() => { running = false; updateChrome(); });
  if (waiters.length) {
    const outcome = ok ? "installed" : stopped ? "cancelled" : "failed";
    page.onClose(() => { for (const w of waiters) w.resolve(outcome); });
    // It went through and held only what was waited on: straight on to what waited (the IPA's own console); this
    // run's output is in Console Logs. With other packages queued too, their finish button (a respring) comes first.
    const waited = new Set(waiters.map((w) => w.id));
    if (ok && jobs.every((j) => waited.has(j.id))) { await reloaded; page.close(); return { ok, reloaded }; }
  }
  page.finish({ label: choice.label, status: ok ? "Done" : stopped ? "Cancelled" : "Failed", action: () => finishAction(choice) });
  return { ok, reloaded };
}

// The finish button's action. -> true to keep the page up (the action failed and said so).
async function finishAction({ level, uicache }) {
  const b = getBackend();
  if (uicache || level === "uicache") {
    const hide = showHUD("Reloading Data");
    try {
      if (typeof b.uicache === "function") await b.uicache();
      await catalog.reloadInstalled?.();
    } catch (e) {
      hide();
      await showAlert({ title: "Reload Data", message: e.message || String(e), buttons: ["OK"] });
      return true;
    }
    hide();
  }
  if (level === "restart" || level === "reload") {
    const hide = showHUD("Loading");
    try {
      await b.respring();
    } catch (e) {
      hide();
      await showAlert({ title: "Restart SpringBoard", message: e.message || String(e), buttons: ["OK"] });
      return true;
    }
    hide();
    return false;
  }
  if (level === "reboot") {
    if (typeof b.userspaceReboot === "function") {
      const { index } = await showAlert({ title: "Reboot Device", message: "A package asked for a reboot to finish. A userspace reboot restarts iOS and keeps the jailbreak.",
        buttons: ["Later", "Reboot"], cancel: 0 });
      if (index !== 1) return false;
      try {
        await b.userspaceReboot();
      } catch (e) {
        await showAlert({ title: "Reboot Device", message: e.message || String(e), buttons: ["OK"] });
        return true;
      }
      return false;
    }
    await showAlert({ title: "Reboot Device", message: "A package asked for a reboot to finish. Restart the iPhone, then jailbreak it again with your jailbreak app if it needs that.", buttons: ["OK"] });
  }
  return false;
}

// ---- Settings > Console Logs -----------------------------------------------------------------------------------

export const LOGS = "logs"; // #/settings/logs and #/settings/logs/<id>

export function logsTitle(id) {
  return id ? "Console Log" : "Console Logs";
}

// The root of Settings: one row to the list, in both builds (F361: the sideload build's signs and installs are kept
// too, and a row that shows only once a log exists hides the one place to look when an install hangs).
export function logsSection(mode, { logs = runLogs } = {}) {
  const list = logs.list();
  return grouped([{ header: "Console", rows: [{ label: "Console Logs", detail: list.length ? String(list.length) : "None", href: format(settingsRoute([LOGS])), icon: rowIcon("logs") }],
    footer: mode === "jailbreak" ? "The output of every install, upgrade and removal, kept on this iPhone."
      : "The output of every app signed, installed and re-signed, kept on this iPhone." },
  reportGroup(null, { logs, footer: "Opens a new issue on GitHub with this iPhone's details and the newest failed log, else the newest one." })]);
}

// ---- F362: Report an Issue ---------------------------------------------------------------------------------
// The app's version and build, iOS and the model, asked once when a row draws, so a tap opens GitHub at once (the
// website's clipboard and window.open both want the tap itself, not a later await). On the website the version is
// build.json's and the model is unknown to the page, so the browser's user agent stands in for it.
let reportInfo = null, reportReady = null;
function reportInfoNow(native = nativeBridge()) {
  reportInfo ??= (async () => {
    const mode = detectMode();
    if (native?.call) {
      const i = (await native.call("app.info", {}).catch(() => null)) ?? {};
      return { mode, version: i.version, build: i.build, ios: i.ios, machine: i.machine };
    }
    const b = await buildInfo();
    return { mode, version: b?.version, build: b?.build, ios: currentDevice().ios, machine: globalThis.navigator?.userAgent };
  })().then((i) => (reportReady = i));
  return reportInfo;
}

// Opens the new issue in Safari (app.js and the shell send window.open there); a log too long for the URL goes on
// the clipboard whole, and the issue's body asks for it to be pasted.
export async function reportIssue(id = null, { logs = runLogs, native = nativeBridge(), open = (u) => openOutside(u, native),
  copy = copyText } = {}) {
  // The website never waits (the tap's own turn): before build.json answers, the issue goes without a version.
  const info = reportReady ?? (native?.call ? await reportInfoNow(native)
    : { mode: detectMode(), ios: currentDevice().ios, machine: globalThis.navigator?.userAgent });
  const pick = reportLog(logs.list(), id); // list() leaves the text out: get() has it
  const { url, trimmed, full } = issueUrl(info, pick && (logs.get(pick.id) ?? pick));
  if (trimmed) copy(full)?.catch?.(() => {});
  open(url);
  return { url, trimmed };
}

// The app: the shell's app.openURL (Safari); an older shell, or the website: window.open.
async function openOutside(url, native) {
  if (native?.call) {
    try { if ((await native.call("app.openURL", { url }))?.opened) return; } catch { /* an older shell */ }
  }
  window.open(url, "_blank", "noopener");
}

function reportGroup(id, { logs = runLogs, footer } = {}) {
  reportInfoNow();
  return { rows: [{ label: "Report an Issue", cls: "report-issue", icon: rowIcon("help"), chevron: true,
    onClick: () => { reportIssue(id, { logs }); } }], footer };
}

const when = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// F361: while a run on the page is still going, the page draws again each LIVE_MS, so its lines come in as they're
// saved. It stops once the page is gone (another route drew over it) or nothing on it is running.
export const LIVE_MS = 1000;
function followRunning(frag, running, redraw, later) {
  if (!running) return;
  const mark = el("span", "console-live");
  mark.hidden = true;
  frag.append(mark);
  later(() => { if (mark.isConnected) redraw(); }, LIVE_MS);
}

export function logsPage(id, redraw = () => {}, { logs = runLogs, later = setTimeout } = {}) {
  if (id) {
    const e = logs.get(decodeURIComponent(id));
    if (!e) return grouped([{ rows: [{ label: "This log is gone" }], footer: "Logs past the newest 20 are dropped." }]);
    const frag = document.createDocumentFragment();
    frag.append(grouped([{ rows: [{ label: e.title || "Run", subtitle: when(e.at), detail: runStatusText(e) }] }]));
    const g = el("div", "group");
    g.append(el("pre", "table grouped console-log", e.text || (e.state === "running" ? "(waiting for output)" : "(no output)")));
    frag.append(g);
    frag.append(grouped([reportGroup(e.id, { logs, footer: "Opens a new issue on GitHub with this log and this iPhone's details." })]));
    followRunning(frag, e.state === "running", redraw, later);
    return frag;
  }
  const list = logs.list();
  if (!list.length) return grouped([{ rows: [{ label: "No Logs Yet" }], footer: "Each install, re-sign and queue run keeps its console output here." }]);
  const frag = grouped([
    { rows: list.map((e) => ({ label: e.title || "Run", subtitle: `${when(e.at)} · ${runStatusText(e)}`,
      href: format(settingsRoute([LOGS, e.id])) })), footer: "The newest 20 runs." },
    { rows: [{ label: "Clear Logs", onClick: async () => {
      const i = await showActionSheet({ buttons: ["Clear Logs"], destructive: 0 });
      if (i === 0) { logs.clear(); redraw(); }
    } }] },
  ]);
  followRunning(frag, list.some((e) => e.state === "running"), redraw, later);
  return frag;
}
