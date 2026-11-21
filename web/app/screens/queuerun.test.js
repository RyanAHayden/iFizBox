// F234: the queue run's page (screens/queuerun.js) over a fake backend: a bad-hash package fails alone, what needs it
// is skipped, the rest installs and leaves the queue; the log's lines know their package; the end has the summary,
// Close / Retry All and the finish button; Retry All runs the failed and skipped rows again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runQueue } from "./queuerun.js";
import { parseSimulation, createQueue, createRunLog } from "../core/queue.js";
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
