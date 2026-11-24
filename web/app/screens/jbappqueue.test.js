// B71a: AltStore apps in the jailbreak app's queue. The app queue holds Remove jobs and quiet adds (a row's swipe); a
// queued row's swipe and hold menu read Cancel; the run goes through the root helper (screens/apprun.js helperLanes:
// install-ipa for an IPA, uninstall-app for a Remove) on the black page with rows, with the helper's words; Confirm's
// run does the apps first, then the packages apt agreed to; AppSync Unified comes first for installs only; Modify
// queues instead of installing, with Clear first while queued.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppQueue, appPlan } from "../core/appqueue.js";
import { appRows, rowStatus, summaryLine, runStatus, barOf } from "../core/apprun.js";
import { helperLanes, runAppRun } from "./apprun.js";
import { runJailbreakApps, afterApps, appSyncFirst } from "./queue.js";
import { rowMenuItems, rowSwipeAction, jbModifyQueue } from "./browse.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

function fakePage() {
  const p = {
    lines: [], statuses: [], finished: null, bars: [], closers: [], closed: false,
    line(kind, text, id) { p.lines.push({ kind, text, id }); },
    status(t) { p.statuses.push(t); }, progress() {},
    pane(n) { return n; }, view() {},
    segmented() { return { select: () => {} }; },
    filter() {}, bar(b) { p.bars.push(b); }, reopen() { p.finished = null; },
    finish(f) { p.finished = f; },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; for (const f of p.closers.splice(0)) f(); return Promise.resolve(); },
  };
  return p;
}

async function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try { await fn(); } finally { globalThis.document = saved; }
}
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

const ipaJob = (id, name = id) => ({ id, name, version: "2.0", installed: null, url: `https://s/${id}.ipa` });

test("the app queue holds Remove jobs (op or the row item's app word) and tells listeners a swipe's add is quiet", () => {
  const q = createAppQueue();
  const events = [];
  q.subscribe((e) => events.push(e));
  const r = q.add({ app: "remove", id: "com.x.a", name: "A" }, { quiet: true });
  assert.equal(r.op, "remove");
  assert.equal(r.mode, "remove");
  assert.equal(r.url, null);
  assert.equal(events[0].quiet, true);
  q.add({ app: "install", ...ipaJob("com.x.b", "B") });
  assert.equal(q.get("com.x.b").op, "install");
  assert.equal(events[1].quiet, undefined);
  q.add({ op: "remove", id: "com.x.b", name: "B", installed: "1.0" }); // replaces the install
  assert.equal(q.get("com.x.b").mode, "remove");
  const plan = appPlan(q.list());
  assert.deepEqual(plan.removes.map((e) => e.id), ["com.x.a", "com.x.b"]);
  assert.equal(plan.removes[1].from, "1.0");
});

test("a queued app row swipes and holds to Cancel in the jailbreak app", () => {
  const item = { id: "com.x.app", name: "App", version: "2.0", key: "k", kind: "ipa" };
  const job = ipaJob("com.x.app", "App");
  assert.deepEqual(rowSwipeAction(item, { jbApps: true, job, installed: null, newest: "2.0", queued: true }), { kind: "cancel", label: "Cancel" });
  assert.deepEqual(rowMenuItems(item, { jbApps: true, job, installed: "2.0", newest: "2.0", queued: true }).map((i) => i.label),
    ["Cancel", "Share", "Source"]);
});

test("the helper's rows read Installing / Removing, never Signed or the iOS prompt", () => {
  const rows = appRows([{ ...ipaJob("a", "A"), mode: "install", helper: true }, { id: "b", name: "B", op: "remove", mode: "remove", helper: true }]);
  const [a, b] = rows;
  for (const state of ["waiting", "signed"]) assert.equal(rowStatus({ ...a, state }), "Waiting");
  assert.equal(rowStatus({ ...a, state: "asking" }), "Installing");
  assert.equal(rowStatus({ ...a, state: "installing", fraction: 0.4 }), "Installing 40%");
  // B400: the helper's step and that step's own percent; the bar is the whole install's, with no half for signing
  const at = (word, wordPercent, fraction = 0.3) => ({ ...a, state: "installing", word, wordPercent, fraction });
  assert.equal(rowStatus(at("Downloading", 40)), "Downloading 40%");
  assert.equal(rowStatus(at("Unpacking", null)), "Unpacking");
  assert.equal(rowStatus(at("Installing", 60)), "Installing 60%");
  assert.equal(runStatus([at("Downloading", 40)]), "Downloading A 40% (1 of 1)");
  assert.equal(runStatus([at("Unpacking", null)]), "Unpacking A (1 of 1)");
  assert.equal(barOf(at("Unpacking", null)), 0.3);
  assert.equal(barOf({ ...a, state: "signed", fraction: 1 }), 0);
  assert.equal(rowStatus({ ...b, state: "installing" }), "Removing");
  assert.equal(rowStatus({ ...a, state: "installed" }), "Installed");
  assert.equal(rowStatus({ ...b, state: "installed" }), "Removed");
  assert.equal(rowStatus({ ...a, state: "failed", error: "no" }), "Failed: no");
  assert.equal(runStatus([{ ...a, state: "installed" }, { ...b, state: "installing" }]), "Removing B (2 of 2)");
  assert.equal(runStatus([{ ...a, state: "downloading" }, b]), "Preparing");
  assert.equal(summaryLine([{ ...a, state: "installed" }, { ...b, state: "installed" }]), "1 installed, 1 removed");
});

test("helperLanes: a Remove goes to the helper's uninstall, an IPA to install-ipa, a too-new IPA fails before any download", async () => {
  const removed = [];
  const installs = [];
  const backend = { uninstallApp: async (id, on) => { removed.push(id); on({ line: "pmstatus:x:50:Removing" }); on({ line: "removed it" }); } };
  const install = async (args, view, opts) => { installs.push({ args, signal: Boolean(opts.signal) }); view.status("Downloading", 40); view.progress(60); view.progress(50); view.status("Done"); view.line("info", "installd"); return { ok: true }; };
  const lanes = helperLanes({ backend, install, needs: async (url) => (url.includes("new") ? { min: "17.0", ios: "15.8.8" } : null) });
  const progress = [];
  const logs = [];
  const hooks = { signal: new AbortController().signal, progress: (ph, f, step, info) => progress.push([ph, f, ...(info ? [`${info.word} ${info.percent}`] : [])]) };
  const rem = { id: "com.x.a", name: "A", job: { op: "remove", id: "com.x.a" } };
  assert.equal((await lanes.sign(rem)).token, "remove");
  assert.deepEqual(await lanes.install(rem, hooks, (t) => logs.push(t)), { installed: true });
  assert.deepEqual(removed, ["com.x.a"]);
  assert.deepEqual(progress, [["installing", 0], ["installing", 0.5]]);
  assert.deepEqual(logs, ["removed it"]);
  const ipa = { id: "com.x.b", name: "B", job: { op: "install", url: "https://s/b.ipa" } };
  assert.equal((await lanes.sign(ipa)).token, "https://s/b.ipa");
  assert.deepEqual(await lanes.install(ipa, hooks, (t) => logs.push(t)), { installed: true });
  // B400: the step and its percent; the bar never goes back
  assert.deepEqual(progress.slice(2), [["installing", 0, "Preparing null"], ["installing", 0, "Downloading 40"],
    ["installing", 0.6, "Downloading 40"], ["installing", 0.6, "Downloading 40"]]);
  assert.deepEqual(installs, [{ args: { url: "https://s/b.ipa", name: "B" }, signal: true }]);
  await assert.rejects(lanes.sign({ id: "n", job: { op: "install", url: "https://s/new.ipa" } }), /needs iOS 17\.0/);
  const failing = helperLanes({ backend, install: async () => ({ ok: false, error: { message: "installd refused it" } }) });
  await assert.rejects(failing.install(ipa, hooks), /installd refused it/);
});

test("a run on the helper's lanes installs and removes in turn, clears the queue and records each", async () => {
  await withDom(async () => {
    const q = createAppQueue();
    q.add(ipaJob("com.x.a", "A"));
    q.add({ op: "remove", id: "com.x.b", name: "B" });
    const recorded = [];
    const page = fakePage();
    const backend = { uninstallApp: async () => {} };
    // B400: the Log names each step once, the row says it with its percent, and the bar only goes forward
    const rowsOf = () => page.lines.filter((l) => l.kind === "step").map((l) => l.text);
    const install = async (args, view) => {
      view.status("Preparing");
      for (const [bar, text, step] of [[0, "Downloading"], [8, "Downloading", 40], [21, "Copying the IPA"], [40, "Unpacking"],
        [60, "Installing (AppSync Unified)"], [84, "Installing", 60], [80, "Installing", 60]]) { view.progress(bar); view.status(text, step); }
      return { ok: true };
    };
    const lanes = helperLanes({ backend, install });
    const res = await runAppRun(q.list().map((j) => ({ ...j, helper: true })), { queue: q, lanes, open: () => page,
      record: async (job) => recorded.push([job.op, job.id]), finish: () => ({ label: "Restart SpringBoard" }) });
    await settle();
    assert.equal(res.ok, true);
    assert.equal(q.size, 0);
    assert.deepEqual(recorded, [["install", "com.x.a"], ["remove", "com.x.b"]]);
    assert.deepEqual(rowsOf(), ["Downloading A", "Copying A", "Unpacking A", "Installing A", "Installed A", "Removing B", "Removed B", "1 installed, 1 removed"]);
    assert.equal(page.finished.label, "Restart SpringBoard");
  });
});

test("runJailbreakApps: AppSync's step stopping it runs nothing; else the helper rows run, then `after` unless cancelled", async () => {
  const q = createAppQueue();
  q.add(ipaJob("com.x.a", "A"));
  let ran = null;
  assert.equal(await runJailbreakApps(q.list(), { queue: q, prepare: async () => null, run: async () => { ran = true; } }), null);
  assert.equal(ran, null);
  assert.equal(q.size, 1);

  const afters = [];
  let deps = null;
  const run = async (jobs, d) => { ran = jobs; deps = d; return { ok: true }; };
  await runJailbreakApps(q.list(), { queue: q, prepare: async () => ({}), run, lanes: {}, finish: () => null, after: (r) => afters.push(r) });
  assert.deepEqual(ran.map((j) => [j.id, j.helper]), [["com.x.a", true]]);
  // a second run can't start while this one's page is up
  assert.equal(await runJailbreakApps(q.list(), { queue: q, prepare: async () => ({}), run, lanes: {}, finish: () => null }), null);
  deps.onClose({ ok: true, stopped: false });
  assert.equal(afters.length, 1);
  await runJailbreakApps(q.list(), { queue: q, prepare: async () => ({}), run, lanes: {}, finish: () => null, after: (r) => afters.push(r) });
  deps.onClose({ ok: false, stopped: true }); // Cancel: Confirm reopens instead, the packages don't run
  assert.equal(afters.length, 1);
});

test("F407 runJailbreakApps: `together` gets the prepared apps for the packages' run; when it has none the apps run alone, then `after`", async () => {
  const q = createAppQueue();
  q.add(ipaJob("com.x.a", "A"));
  const got = [];
  const ran = [];
  const run = async (jobs, d) => { ran.push(d); return { ok: true }; };
  const opts = { queue: q, prepare: async () => ({ installed: true }), run, lanes: {}, safety: async () => true };
  const afters = [];
  const res = await runJailbreakApps(q.list(), { ...opts, finish: () => ({ level: "restart" }), after: (r) => afters.push(r),
    together: (apps) => { got.push(apps); return Promise.resolve({ ok: true, both: true }); } });
  assert.equal(res.both, true);
  assert.equal(ran.length, 0, "the host starts it");
  assert.deepEqual(got[0].jobs.map((j) => [j.id, j.helper]), [["com.x.a", true]]);
  assert.deepEqual(got[0].finish(), { levels: ["restart"], kinds: ["app"] });
  const host = { page: {} };
  await got[0].start(host);
  assert.equal(ran[0].host, host);
  assert.equal(ran[0].open(), host.page);
  ran[0].onClose({ ok: true }); // the page closes: the next run can start
  assert.equal(afters.length, 0);
  await runJailbreakApps(q.list(), { ...opts, finish: () => null, after: (r) => afters.push(r), together: () => null });
  assert.equal(ran[1].host, undefined);
  ran[1].onClose({ ok: true });
  assert.equal(afters.length, 1);
});

test("afterApps: the packages Confirm agreed to run while the queue still holds just those; else Confirm asks apt again", () => {
  const queue = (ids) => ({ size: ids.length, get: (id) => (ids.includes(id) ? { id } : null) });
  const run = { jobs: [{ id: "p1" }, { id: "p2" }] };
  const calls = [];
  afterApps(run, () => calls.push("apt"), { queue: queue(["p1", "p2"]), open: () => calls.push("confirm") });
  afterApps(run, () => calls.push("apt"), { queue: queue(["p2"]), open: () => calls.push("confirm") });
  afterApps(run, () => calls.push("apt"), { queue: queue([]), open: () => calls.push("confirm") });
  assert.deepEqual(calls, ["apt", "confirm"]);
});

test("appSyncFirst: only for installs; Cancel stops; the fallback's Try Again goes round again; a fresh AppSync wants a respring", async () => {
  const fake = (answers, retry = []) => {
    const m = { asked: 0, respring: false, fallbacks: [],
      ensureAppSync: async () => answers[m.asked++],
      setAppSyncRespring: (on) => { m.respring = on; },
      appSyncFallback: async (step) => { m.fallbacks.push(step); return retry.shift() ?? false; } };
    return m;
  };
  const removes = fake([]);
  assert.deepEqual(await appSyncFirst([{ id: "a", op: "remove" }], { ipa: removes }), {});
  assert.equal(removes.asked, 0);
  assert.equal(await appSyncFirst([{ id: "a", op: "install" }], { ipa: fake([{ cancelled: true }]) }), null);
  const again = fake([{ ok: false, step: "add" }, { ok: true, installed: true }], [true]);
  assert.deepEqual(await appSyncFirst([{ id: "a", op: "install" }], { ipa: again }), { ok: true, installed: true });
  assert.deepEqual(again.fallbacks, ["add"]);
  assert.equal(again.respring, true);
  assert.equal(await appSyncFirst([{ id: "a", op: "install" }], { ipa: fake([{ ok: false, step: "refresh" }]) }), null);
});

const pkg = { key: "alt:https://s/", row: { id: "com.x.a", name: "A" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.a", name: "A",
  sourceUrl: "https://s/", versions: [{ version: "2.0", downloadURL: "https://s/a2.ipa" }, { version: "1.0", downloadURL: "https://s/a1.ipa" }] } } };
const store = (version) => async () => ({ all: async () => (version ? [{ id: "com.x.a", version }] : []) });

test("jbModifyQueue: Modify's Upgrade / Downgrade / Remove queue the app, nothing installs at once", async () => {
  const q = createAppQueue();
  const m = jbModifyQueue(pkg, null, { queue: q, store: store("1.0") });
  await m.install({ version: "1.0" });
  assert.equal(q.get("com.x.a").url, "https://s/a1.ipa");
  assert.equal(q.get("com.x.a").mode, "reinstall");
  await m.install({ version: "2.0" });
  assert.equal(q.get("com.x.a").mode, "upgrade");
  await m.remove({ id: "com.x.a", name: "A" });
  assert.deepEqual([q.get("com.x.a").op, q.get("com.x.a").installed], ["remove", "1.0"]);
});

test("jbModifyQueue: a queued app's sheet starts with Clear (which clears it); its other buttons keep their places", async () => {
  const q = createAppQueue();
  q.add(ipaJob("com.x.a", "A"));
  const asked = [];
  const pick = (label) => async (opts) => { asked.push(opts); return opts.buttons.indexOf(label); };
  let m = jbModifyQueue(pkg, null, { queue: q, store: store("1.0"), ask: pick("Remove") });
  assert.equal(await m.ask({ title: "A", buttons: ["Upgrade", "Remove"], destructive: [-1, 1] }), 1);
  assert.deepEqual(asked[0].buttons, ["Clear", "Upgrade", "Remove"]);
  assert.deepEqual(asked[0].destructive, [2]);
  assert.equal(await m.ask({ title: "Downgrade to", buttons: ["1.0"] }), -1); // the next sheet is left as it is
  assert.deepEqual(asked[1].buttons, ["1.0"]);
  m = jbModifyQueue(pkg, null, { queue: q, store: store("1.0"), ask: pick("Clear") });
  assert.equal(await m.ask({ title: "A", buttons: ["Upgrade", "Remove"] }), -1);
  assert.equal(q.size, 0);
  m = jbModifyQueue(pkg, null, { queue: q, store: store("1.0"), ask: pick("Upgrade") });
  asked.length = 0;
  await m.ask({ title: "A", buttons: ["Upgrade", "Remove"] });
  assert.deepEqual(asked[0].buttons, ["Upgrade", "Remove"]); // not queued: no Clear
});
