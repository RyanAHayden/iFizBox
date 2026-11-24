// F234: the queue run's page (screens/queuerun.js) over a fake backend: a bad-hash package fails alone, what needs it
// is skipped, the rest installs and leaves the queue; the log's lines know their package; the end has the summary,
// Close / Retry All and the finish button; Retry All runs the failed and skipped rows again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runQueue } from "./queuerun.js";
import { parseSimulation, createQueue, createRunLog } from "../core/queue.js";
import { createAppQueue } from "../core/appqueue.js";
import { helperLanes, runAppRun } from "./apprun.js";
import { helperCalls } from "./queue.js";
import { PACKAGE } from "../brand.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

// A stand-in for nav/progress.js's page: records what the run asks of it.
function fakePage() {
  const p = {
    lines: [], statuses: [], finished: null, bars: [], closers: [], closed: false, hidden: false, panes: [], views: [], filtered: null,
    line(kind, text, pkg) { p.lines.push({ kind, text, pkg }); },
    status(t) { p.statuses.push(t); }, progress() {},
    pane(n) { p.panes.push(n); return n; }, view(v) { p.views.push(v); },
    segmented(labels, onPick) { p.seg = { labels, onPick }; return { select: (i) => { p.selected = i; } }; },
    filter(pkg) { p.filtered = pkg; },
    bar(b) { p.bars.push(b); },
    reopen() { p.finished = null; },
    finish(f) { p.finished = f; },
    hide() { p.hidden = true; }, show() { p.hidden = false; },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; for (const f of p.closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

const SIM = "Inst lib (2.0 R [a])\nInst tweak (1.0 R [a])\nInst other (1.0 R [a])";
const plan = parseSimulation(SIM);
const jobs = [{ op: "install", id: "tweak", name: "Tweak", mode: "install" }, { op: "install", id: "other", name: "Other", mode: "install" }];
const info = { lib: { name: "Lib", debUrl: "https://r/lib.deb", sha256: "a".repeat(64) }, tweak: { debUrl: "https://r/tweak.deb", depends: "lib" },
  other: { debUrl: "https://r/other.deb" }, installed: {} };

function setup({ badLib = true } = {}) {
  const queue = createQueue();
  for (const j of jobs) queue.add(j);
  const calls = { fetch: [], install: [], auto: [], logs: [] };
  let libBad = badLib;
  const backend = {
    async queueFetch(r, { progress }) {
      calls.fetch.push(r.id);
      progress(0.5);
      if (r.id === "lib" && libBad) throw new Error("the download isn't the file its source lists (SHA256 differs)");
      return { file: `${r.id}.deb` };
    },
    async queueInstall(r, { file, onEvent }) {
      calls.install.push([r.id, file]);
      onEvent({ fd: "status", line: `pmstatus:${r.id}:10:Unpacking ${r.id}` });
      onEvent({ fd: "status", line: `pmstatus:${r.id}:50:Unpacking ${r.id}` });
      onEvent({ fd: "out", line: `Selecting previously unselected package ${r.id}.` });
      return { code: 0, stdout: "", stderr: "" };
    },
    async markAuto(ids) { calls.auto.push(ids); return true; },
  };
  const catalog = { runInfo: async () => info, queueInfo: async () => ({}), reloadInstalled: async () => {} };
  // the real Console Logs store, in memory; calls.logs: the entries that have ended, oldest first
  const runLogs = createRunLog(null, { flushMs: 0 });
  Object.defineProperty(calls, "logs", { get: () => runLogs.list().filter((e) => e.state !== "running").reverse() });
  const page = fakePage();
  return { queue, calls, backend, catalog, runLogs, page, fixLib: () => { libBad = false; } };
}

async function withDom(fn) {
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame };
  globalThis.document = fakeDom();
  globalThis.requestAnimationFrame = (f) => { queueMicrotask(f); return 1; };
  try { await fn(); } finally { globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf; }
}
const settle = () => new Promise((r) => setTimeout(r, 5));

test("a bad hash fails one package, skips what needs it, installs the rest; Retry All finishes the job", () => withDom(async () => {
  const s = setup();
  const result = await runQueue({ jobs, plan }, { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs,
    names: { tweak: "Tweak", other: "Other" }, open: () => s.page });
  assert.deepEqual(result.rows.map((r) => [r.id, r.state]), [["lib", "failed"], ["tweak", "skipped"], ["other", "installed"]]);
  assert.equal(result.ok, false);
  assert.deepEqual(s.calls.install, [["other", "other.deb"]]);
  // only what installed left the queue
  await settle();
  assert.deepEqual(s.queue.list().map((j) => j.id), ["tweak"]);
  // the log: one line per step per package, each knowing its package; the summary at its end
  const unpack = s.page.lines.filter((l) => l.text === "Unpacking Other"); // the id becomes the name
  assert.equal(unpack.length, 1, "apt's repeated status line once");
  assert.equal(unpack[0].pkg, "other");
  assert.ok(s.page.lines.some((l) => l.kind === "raw" && l.pkg === "other"));
  assert.ok(s.page.lines.some((l) => l.kind === "error" && l.pkg === "lib" && /SHA256/.test(l.text)));
  assert.ok(s.page.lines.some((l) => l.kind === "step" && l.text === "Downloading Lib" && l.pkg === "lib"));
  assert.equal(s.page.lines.at(-1).text, "1 installed, 1 failed, 1 skipped");
  // Packages | Log, Packages first; the bar ends on Close / Retry All; the finish button is Return to <NAME>
  assert.deepEqual(s.page.seg.labels, ["Packages", "Log"]);
  assert.equal(s.page.views[0], "pane");
  assert.equal(s.page.bars.at(-1).left.textContent, "Close");
  assert.equal(s.page.bars.at(-1).right.textContent, "Retry All");
  assert.match(s.page.finished.label, /^Return to /);
  // B224: while it ran, Cydia's plain Cancel at the top left (not red), Hide at the right
  const running = s.page.bars[0];
  assert.equal(running.left.textContent, "Cancel");
  assert.ok(!running.left.className.includes("red"));
  assert.equal(running.right.textContent, "Hide");
  assert.equal(s.calls.logs.length, 1);
  assert.equal(s.calls.logs[0].code, 1);
  // the Packages list's summary row
  const list = s.page.panes[0].children[0];
  const summary = list.children.at(-1);
  assert.equal(summary.textContent, "1 installed, 1 failed, 1 skipped");
  assert.equal(summary.hidden, false);
  // Retry All: lib downloads fine now, then tweak; apt's lib keeps its Auto-Installed mark
  s.fixLib();
  s.page.bars.at(-1).right.click();
  for (let i = 0; i < 20 && !(s.page.finished && s.calls.logs.length === 2); i++) await settle();
  assert.deepEqual(s.calls.install.map(([id]) => id), ["other", "lib", "tweak"]);
  assert.equal(s.page.bars.at(-1).right ?? null, null); // B224: no bar buttons at a clean end, as the 4S's Complete
  assert.equal(s.page.bars.at(-1).left ?? null, null);
  assert.deepEqual(s.calls.auto.at(-1), ["lib"]);
  await settle();
  assert.equal(s.queue.size, 0);
}));

test("a row's tap opens the Log filtered to its package; a failed row's tap retries it", () => withDom(async () => {
  const s = setup();
  await runQueue({ jobs, plan }, { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs, open: () => s.page });
  const list = s.page.panes[0].children[0];
  const rowOf = (name) => list.children.find((li) => li.children?.[0]?.children?.[0]?.textContent === name);
  rowOf("Other").children[0].click();
  assert.equal(s.page.filtered, "other");
  assert.equal(s.page.selected, 1);
  assert.equal(s.page.views.at(-1), "log");
  s.fixLib();
  rowOf("Lib").children[0].click();
  for (let i = 0; i < 20 && s.calls.logs.length < 2; i++) await settle();
  assert.deepEqual(s.calls.install.map(([id]) => id), ["other", "lib", "tweak"]);
}));

test("F247: a one-package run opens on the Log; two or more open on the Packages list", () => withDom(async () => {
  const one = setup();
  const onePlan = parseSimulation("Inst other (1.0 R [a])");
  await runQueue({ jobs: [jobs[1]], plan: onePlan }, { backend: one.backend, catalog: one.catalog, queue: one.queue, runLogs: one.runLogs, open: () => one.page });
  assert.equal(one.page.views[0], "log");
  assert.equal(one.page.selected, 1);
  // Packages still works from the tab
  one.page.seg.onPick(0);
  assert.equal(one.page.views.at(-1), "pane");
  const two = setup({ badLib: false });
  const twoPlan = parseSimulation("Inst tweak (1.0 R [a])\nInst other (1.0 R [a])");
  await runQueue({ jobs, plan: twoPlan }, { backend: two.backend, catalog: two.catalog, queue: two.queue, runLogs: two.runLogs, open: () => two.page });
  assert.equal(two.page.views[0], "pane");
  assert.equal(two.page.selected, 0);
}));

test("F363: Console Logs keep the run from its first line: a run that never ends reads Running with its lines so far", () => withDom(async () => {
  const s = setup({ badLib: false });
  const onePlan = parseSimulation("Inst other (1.0 R [a])");
  s.backend.queueInstall = (r, { onEvent }) => {
    onEvent({ fd: "status", line: `pmstatus:${r.id}:10:Unpacking ${r.id}` });
    return new Promise(() => {}); // dpkg hangs
  };
  let ended = false;
  runQueue({ jobs: [jobs[1]], plan: onePlan }, { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs,
    names: { other: "Other" }, open: () => s.page }).then(() => { ended = true; });
  for (let i = 0; i < 20 && !s.page.lines.some((l) => l.text === "Unpacking Other"); i++) await settle();
  assert.equal(ended, false);
  const list = s.runLogs.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].state, "running");
  assert.equal(list[0].title, "Install Other");
  assert.deepEqual(list[0].jobs, [{ op: "install", id: "other", version: undefined, mode: "install" }]);
  const text = s.runLogs.get(list[0].id).text;
  assert.match(text, /» Downloading Other/);
  assert.match(text, /» Unpacking Other/);
}));

test("F363: each pass is its own entry: the first ends Failed with its lines, Retry All's ends Completed with its own", () => withDom(async () => {
  const s = setup();
  await runQueue({ jobs, plan }, { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs,
    names: { tweak: "Tweak", other: "Other" }, open: () => s.page });
  assert.equal(s.calls.logs.length, 1);
  assert.equal(s.calls.logs[0].state, "failed");
  s.fixLib();
  s.page.bars.at(-1).right.click();
  for (let i = 0; i < 20 && s.calls.logs.length < 2; i++) await settle();
  const [one, two] = s.calls.logs.map((e) => s.runLogs.get(e.id));
  assert.equal(one.state, "failed");
  assert.match(one.text, /SHA256/);
  assert.match(one.text, /1 installed, 1 failed, 1 skipped$/);
  assert.equal(two.state, "done");
  assert.equal(two.title, "Install Tweak, Install Other");
  assert.doesNotMatch(two.text, /SHA256/);
  assert.match(two.text, /» Unpacking Lib/);
  assert.match(two.text, /3 installed$/);
}));

// ---- F407: apps and packages in one run ---------------------------------------------------------------------------

// apps: { id: "ok" | "fail" | a function () -> a promise for runIpaInstall's answer }
function mixed(s, apps, { finish = () => null, kinds = {}, idle, jobs: js = jobs, plan: pl = plan } = {}) {
  const queue = createAppQueue();
  for (const id of Object.keys(apps)) queue.add({ id, name: id.toUpperCase(), version: "2.0", url: `https://s/${id}.ipa` });
  const order = [];
  const recorded = [];
  const install = s.backend.queueInstall;
  s.backend.queueInstall = (r, o) => { order.push(r.id); return install(r, o); };
  s.catalog.queueInfo = async () => kinds;
  const lanes = helperLanes({ backend: {}, install: async ({ url }) => {
    const id = url.slice("https://s/".length, -".ipa".length);
    order.push(`app ${id}`);
    await settle();
    const how = apps[id];
    if (typeof how === "function") return how();
    return how === "ok" ? { ok: true } : { ok: false, error: { message: "installd refused it" } };
  } });
  const list = queue.list().map((j) => ({ ...j, helper: true }));
  const ends = [];
  const confirms = [];
  let appClosed = 0;
  const done = runQueue({ jobs: js, plan: pl }, { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs,
    names: { tweak: "Tweak", other: "Other" }, open: () => s.page, onEnd: (r) => ends.push(r), reopenConfirm: (f) => confirms.push(f),
    finishAction: async (choice) => { s.choice = choice; return false; },
    apps: { jobs: list, finish, idle,
      start: (host) => runAppRun(list, { queue, lanes, host, open: () => host.page, record: async (j) => recorded.push(j.id), isInstalled: null,
        onClose: () => { appClosed++; } }) } });
  return { done, queue, order, recorded, ends, confirms, apps, closed: () => appClosed,
    row: (name) => (s.page.panes[0]?.children ?? []).flatMap((ul) => ul.children).find((li) => li.children?.[0]?.children?.[0]?.textContent === name) };
}
const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await settle(); assert.ok(f(), "never came"); };

test("F407 mixed: one page, every app before any package, one end with one finish button and no tap between", () => withDom(async () => {
  const s = setup({ badLib: false });
  const m = mixed(s, { a: "ok", b: "ok" }, { kinds: { tweak: { kind: "tweak" } } });
  const r = await m.done;
  await settle();
  assert.deepEqual(m.order, ["app a", "app b", "lib", "tweak", "other"]);
  assert.equal(r.ok, true);
  assert.equal(r.installed, 5);
  assert.deepEqual(r.rows.map((x) => x.id), ["lib", "tweak", "other"]);
  assert.equal(m.ends.length, 1);
  assert.deepEqual([m.queue.size, s.queue.size], [0, 0]);
  assert.deepEqual(m.recorded, ["a", "b"]);
  assert.deepEqual(s.page.seg.labels, ["Queue", "Log"]);
  assert.deepEqual(["A", "B", "Lib", "Tweak", "Other"].map((n) => Boolean(m.row(n))), [true, true, true, true, true]);
  assert.equal(s.page.views.at(-1), "pane");
  assert.equal(s.page.bars.length, 2, "one Running bar, one end");
  assert.deepEqual(s.page.bars[1], {});
  assert.equal(s.page.finished.label, "Restart SpringBoard"); // the tweak's
  assert.equal(s.page.lines.at(-1).text, "5 installed");
  assert.equal(s.page.lines.filter((l) => /installed$/.test(l.text)).length, 1, "one summary");
  assert.ok(s.page.statuses.some((t) => /^Installing B \(2 of 5\)$/.test(t) || /^Preparing B \(2 of 5\)$/.test(t)), s.page.statuses.join(" | "));
  assert.ok(s.page.statuses.some((t) => /\(\d of 5\)/.test(t) && /Lib|Tweak|Other/.test(t)));
  // one Console Logs entry for both
  assert.equal(s.runLogs.list().length, 1);
  assert.equal(s.calls.logs[0].title, "Install A, Install B and 2 more");
  assert.match(s.runLogs.get(s.calls.logs[0].id).text, /» Installed A[\s\S]*» Installed Tweak/);
  // an app's row opens the one Log of everything (B422), its lines still keyed apart from a package of the same ID
  m.row("A").children[0].click();
  assert.equal(s.page.filtered, null);
  assert.ok(s.page.lines.some((l) => l.pkg === "app:a" && l.text === "Installed A"));
  s.page.close();
  assert.equal(m.closed(), 1);
}));

test("F407 an app and a package fail: the rest installs, both stay queued, Retry All runs both, the app first", () => withDom(async () => {
  const s = setup();
  const m = mixed(s, { a: "fail", b: "ok" });
  const r = await m.done;
  await settle();
  assert.equal(r.ok, false);
  assert.deepEqual(m.order, ["app a", "app b", "other"]);
  assert.deepEqual([m.queue.list().map((j) => j.id), s.queue.list().map((j) => j.id)], [["a"], ["tweak"]]);
  assert.equal(s.page.lines.at(-1).text, "2 installed, 2 failed, 1 skipped");
  assert.equal(s.page.bars.at(-1).left.textContent, "Close");
  assert.equal(s.page.bars.at(-1).right.textContent, "Retry All");
  assert.equal(s.calls.logs[0].code, 1);
  m.order.length = 0;
  m.apps.a = "ok";
  s.fixLib();
  s.page.bars.at(-1).right.click();
  await until(() => m.ends.length === 2);
  await settle();
  assert.deepEqual(m.order, ["app a", "lib", "tweak"]);
  assert.equal(m.ends[1].ok, true);
  assert.deepEqual([m.queue.size, s.queue.size], [0, 0]);
  assert.deepEqual(s.page.bars.at(-1), {});
}));

test("F407 only an app failed: Retry All and its row's tap run just that app", () => withDom(async () => {
  const s = setup({ badLib: false });
  const m = mixed(s, { a: "fail" });
  await m.done;
  m.row("A").children[0].click();
  await until(() => m.ends.length === 2);
  assert.equal(m.ends[1].ok, false);
  m.apps.a = "ok";
  s.page.bars.at(-1).right.click();
  await until(() => m.ends.length === 3);
  assert.deepEqual(m.order, ["app a", "lib", "tweak", "other", "app a", "app a"]);
  assert.equal(m.ends[2].ok, true);
}));

test("F407 a failed app's tap while the packages still run opens its log: no app install beside dpkg", () => withDom(async () => {
  const s = setup({ badLib: false });
  const install = s.backend.queueInstall;
  let go;
  const gate = new Promise((f) => { go = f; });
  s.backend.queueInstall = async (r, o) => { await gate; return install(r, o); };
  const m = mixed(s, { a: "fail" });
  await until(() => m.order.includes("lib"));
  m.row("A").children[0].click();
  await settle();
  assert.equal(s.page.filtered, null); // B422: the one Log
  assert.deepEqual(m.order, ["app a", "lib"]);
  go();
  await m.done;
  assert.equal(m.ends.length, 1);
}));

test("F407 a package that failed its download is retried while the apps run: the same pass waits for it, after them", () => withDom(async () => {
  const s = setup();
  let go;
  const gate = new Promise((f) => { go = f; });
  const m = mixed(s, { a: async () => { await gate; return { ok: true }; } });
  await until(() => m.row("Lib")?.dataset.state === "failed");
  s.fixLib();
  m.row("Lib").children[0].click();
  await settle();
  assert.deepEqual(m.order, ["app a"], "dpkg waits for the app");
  go();
  await m.done;
  assert.deepEqual(m.order, ["app a", "lib", "tweak", "other"]);
  assert.equal(m.ends.length, 1);
}));

test("F407 Cancel while an app installs stops everything left and reopens Confirm", () => withDom(async () => {
  const s = setup({ badLib: false });
  let n = 0;
  const m = mixed(s, { a: "ok", b: () => { n++; return new Promise(() => {}); }, c: "ok" });
  await until(() => n === 1);
  s.page.bars.at(-1).left.click();
  const r = await m.done;
  await settle();
  assert.equal(r.stopped, true);
  assert.deepEqual(m.order, ["app a", "app b"]);
  assert.ok(r.rows.every((x) => x.state === "cancelled"));
  assert.deepEqual(m.queue.list().map((j) => j.id), ["b", "c"]);
  assert.equal(s.queue.size, 2);
  assert.deepEqual(m.confirms, ["Stopped. 1 installed and cleared from the queue."]);
  assert.equal(s.page.closed, true);
  assert.equal(s.page.finished, null);
  assert.equal(m.closed(), 1);
}));

test("F407 Cancel during the packages: dpkg finishes its package, the count has the apps too", () => withDom(async () => {
  const s = setup({ badLib: false });
  const install = s.backend.queueInstall;
  let go;
  const gate = new Promise((f) => { go = f; });
  s.backend.queueInstall = async (r, o) => { await gate; return install(r, o); };
  const m = mixed(s, { a: "ok" });
  await until(() => m.order.includes("lib"));
  s.page.bars.at(-1).left.click();
  await settle();
  assert.equal(m.confirms.length, 0);
  go();
  await m.done;
  await settle();
  assert.deepEqual(m.order, ["app a", "lib"]);
  assert.deepEqual(m.confirms, ["Stopped. 2 installed and cleared from the queue."]);
}));

test("F407 the finish level is the highest of both halves", () => withDom(async () => {
  const end = async (opts, apps = { a: "ok" }) => {
    const s = setup({ badLib: false });
    await mixed(s, apps, opts).done;
    const { label } = s.page.finished;
    await s.page.finished.action();
    return [label, s.choice.level, s.choice.uicache];
  };
  const respring = () => ({ levels: ["restart"], kinds: ["app"] });
  assert.deepEqual((await end({})).slice(1), ["return", false]);
  assert.deepEqual(await end({ kinds: { other: { kind: "app" } } }), ["Reload Data", "uicache", false]);
  assert.deepEqual(await end({ finish: respring }), ["Restart SpringBoard", "restart", true]);
  assert.deepEqual(await end({ finish: respring, kinds: { other: { kind: "app" } } }), ["Restart SpringBoard", "restart", true]);
  assert.deepEqual(await end({ kinds: { tweak: { kind: "tweak" } } }, { a: "fail" }), ["Restart SpringBoard", "restart", false]);
}));

test("F407 a stopped app's helper call still ending holds dpkg", () => withDom(async () => {
  const s = setup({ badLib: false });
  const h = helperCalls();
  let end;
  const m = mixed(s, { a: () => h.track(new Promise((f) => { end = () => f({ ok: true }); })) }, { idle: h.idle });
  await until(() => end);
  m.row("A").children[1].click();
  await settle();
  assert.equal(m.row("A").dataset.state, "cancelled");
  assert.deepEqual(m.order, ["app a"]);
  end();
  await m.done;
  assert.deepEqual(m.order, ["app a", "lib", "tweak", "other"]);
  const hung = helperCalls({ limit: 5 });
  hung.track(new Promise(() => {}));
  await hung.idle();
}));

test("F407 iFizBox's own package goes last, after the apps, and the run ends on its Close button", () => withDom(async () => {
  const s = setup({ badLib: false });
  const own = [{ op: "install", id: PACKAGE, mode: "upgrade" }, jobs[1]];
  const m = mixed(s, { a: "ok" }, { jobs: own, plan: parseSimulation(`Inst ${PACKAGE} [1.0] (2.0 R [a])\nInst other (1.0 R [a])`) });
  await m.done;
  assert.deepEqual(m.order, ["app a", "other", PACKAGE]);
  assert.match(s.page.finished.label, /^Close /);
}));

test("F407 the apps failing to start closes the page and runs no package", () => withDom(async () => {
  const s = setup({ badLib: false });
  await assert.rejects(runQueue({ jobs, plan }, { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs, open: () => s.page,
    apps: { jobs: [], start: async () => { throw new Error("no"); } } }), /no/);
  assert.equal(s.page.closed, true);
  assert.deepEqual(s.calls.fetch, []);
}));

// ---- B414: iFizBox open until the tap ----

// A run of iFizBox and Other with `levels` asked for by Other's scripts; calls: the hold on / off and dpkg's installs, in order.
async function ownRun(finishLine, { ids = [PACKAGE, "other"], fail = null, holdSelf } = {}) {
  const s = setup({ badLib: false });
  const calls = [];
  s.backend.holdSelf = holdSelf ?? (async (on) => { await settle(); calls.push(on ? "hold" : "release"); });
  s.backend.queueInstall = async (r, { onEvent }) => {
    calls.push(r.id);
    if (r.id === "other" && finishLine) onEvent({ fd: "status", line: finishLine });
    return r.id === s.fail ? { code: 100, stdout: "", stderr: "E: no" } : { code: 0, stdout: "", stderr: "" };
  };
  s.fail = fail;
  const js = ids.map((id) => ({ op: "install", id, mode: "upgrade" }));
  const pl = parseSimulation(ids.map((id) => `Inst ${id} [1.0] (2.0 R [a])`).join("\n"));
  const confirms = [];
  await runQueue({ jobs: js, plan: pl }, { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs,
    open: () => s.page, reopenConfirm: (f) => confirms.push(f) });
  await settle();
  await settle();
  return { s, calls, confirms };
}

for (const level of ["restart", "reload", "reboot"]) {
  test(`B414 iFizBox in a run ending on ${level}: held before dpkg starts until the page closes`, () => withDom(async () => {
    const { s, calls } = await ownRun(`finish:${level}`);
    assert.match(s.page.finished.label, level === "reboot" ? /^Reboot Device/ : /SpringBoard$/);
    assert.deepEqual(calls, ["hold", "other", PACKAGE], "still held with the button up");
    s.page.close(); // the button's action, Close or Later
    await settle();
    await settle();
    assert.deepEqual(calls, ["hold", "other", PACKAGE, "release"]);
  }));
}

test("B414 a run ending on Close iFizBox lets go at its end", () => withDom(async () => {
  for (const ids of [[PACKAGE], [PACKAGE, "other"]]) {
    const { s, calls } = await ownRun("", { ids });
    assert.match(s.page.finished.label, /^Close /);
    assert.equal(calls[0], "hold");
    assert.equal(calls.at(-1), "release");
    s.page.close();
    await settle();
    assert.equal(calls.filter((c) => c === "release").length, 1);
  }
}));

test("B414 a run without iFizBox holds nothing", () => withDom(async () => {
  const { calls } = await ownRun("finish:restart", { ids: ["other"] });
  assert.deepEqual(calls, ["other"]);
}));

test("B414 something failed: held while Retry All is there, through the retry", () => withDom(async () => {
  const { s, calls } = await ownRun("finish:restart", { fail: PACKAGE });
  assert.ok(!calls.includes("release"));
  s.fail = null;
  s.page.bars.at(-1).right.click();
  await until(() => s.page.finished && calls.filter((c) => c === PACKAGE).length === 2);
  await settle();
  assert.equal(s.page.finished.label, "Restart SpringBoard");
  assert.ok(!calls.includes("release"));
}));

test("B414 Cancel lets go", () => withDom(async () => {
  let page;
  const s = setup({ badLib: false });
  const calls = [];
  s.backend.holdSelf = async (on) => { calls.push(on); };
  s.backend.queueInstall = async (r) => { page ??= s.page.bars.at(-1).left.click() ?? true; return { code: 0, stdout: "", stderr: "" }; };
  await runQueue({ jobs: [{ op: "install", id: PACKAGE, mode: "upgrade" }], plan: parseSimulation(`Inst ${PACKAGE} [1.0] (2.0 R [a])\nInst other (1.0 R [a])`) },
    { backend: s.backend, catalog: s.catalog, queue: s.queue, runLogs: s.runLogs, open: () => s.page });
  await settle();
  assert.equal(s.page.closed, true);
  assert.deepEqual(calls, [true, false]);
}));

test("B414 a shell that can't hold runs as before", () => withDom(async () => {
  const { s, calls } = await ownRun("finish:restart", { holdSelf: async () => { throw new Error("no such method"); } });
  assert.deepEqual(calls, ["other", PACKAGE]);
  assert.equal(s.page.finished.label, "Restart SpringBoard");
}));
