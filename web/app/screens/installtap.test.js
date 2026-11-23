// B330: a package page's Install (not installed: no Modify) queues on a tap, so Confirm opens; Modify, an app's
// Install, Add to App, a paid package and the website keep their options on a tap. F392: a hold queues quietly (no
// Confirm) with the undo bar, an upgrade too; with nothing to queue it opens the usual menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nav, installTap, installHold, installNoModify } from "./browse.js";
import { format } from "../router.js";

const ROUTE = { tab: "sources", path: ["src1", "package:com.ex.tweak"] };
const NOT_INSTALLED = { kind: "deb", versions: [{ version: "3.0", keys: ["src1"] }, { version: "2.0", keys: ["src1"] }] };
const INSTALLED = { kind: "deb", versions: [{ version: "3.0", keys: ["src1"] }, { version: "2.0", keys: ["src1"], installed: true }] };

const page = (history, stanza = { package: "com.ex.tweak", version: "3.0" }) =>
  ({ id: "com.ex.tweak", pkg: { key: "src1", stanza, row: { name: "Tweak" } }, source: null, history, body: { isConnected: true } });
const pagesOf = (p) => new Map([[format(ROUTE), p]]);

function deps(p, extra = {}) {
  const jobs = [], opened = [];
  return { jobs, opened, opts: { pages: pagesOf(p), mode: "jailbreak", queue: async (j) => { jobs.push(j); },
    paidState: async () => null, options: async (route, b) => { opened.push([route, b]); }, ...extra } };
}

test("the nav spec still has a tap and a hold", () => {
  const spec = nav(ROUTE).right;
  assert.equal(spec.label, "Install");
  assert.equal(typeof spec.onClick, "function");
  assert.equal(typeof spec.onHold, "function");
});

test("installNoModify: an apt package not installed; not Modify, an app or Add to App", () => {
  assert.equal(installNoModify(page(NOT_INSTALLED), { mode: "jailbreak" }), true);
  assert.equal(installNoModify(page(null), { mode: "jailbreak" }), true);
  assert.equal(installNoModify(page(INSTALLED), { mode: "jailbreak" }), false);
  assert.equal(installNoModify(page(NOT_INSTALLED, { kind: "ipa", ipa: {} }), { mode: "jailbreak" }), false);
  assert.equal(installNoModify(page(NOT_INSTALLED, { package: "x", injectable: true }), { mode: "sideload" }), false);
  assert.equal(installNoModify(null), false);
});

test("a tap on Install queues the page's version (Confirm opens), no options sheet", async () => {
  const d = deps(page(NOT_INSTALLED));
  assert.equal(await installTap(ROUTE, "btn", d.opts), "queued");
  assert.deepEqual(d.jobs, [{ op: "install", id: "com.ex.tweak", version: "3.0" }]);
  assert.deepEqual(d.opened, []);
});

test("Modify: a tap opens its sheet", async () => {
  const d = deps(page(INSTALLED));
  assert.equal(await installTap(ROUTE, "btn", d.opts), "options");
  assert.deepEqual(d.jobs, []);
  assert.equal(d.opened.length, 1);
});

// F392: the install queue as installHold uses it
function heldQueue(had = {}) {
  const adds = [], restored = [];
  return { adds, restored, get: (id) => had[id] ?? null, add: (j, o) => { adds.push([j, o]); }, restore: (id, was) => { restored.push([id, was]); } };
}
function holdDeps(p, extra = {}) {
  const d = deps(p), bars = [], q = heldQueue();
  return { q, bars, opened: d.opened, opts: { pages: d.opts.pages, mode: "jailbreak", options: d.opts.options, queue: q, undo: (b) => bars.push(b), ...extra } };
}

test("F392: a hold on Install queues the page's version quietly, with Undo, and no menu", async () => {
  const d = holdDeps(page(NOT_INSTALLED));
  assert.equal(await installHold(ROUTE, "btn", d.opts), "queued");
  assert.deepEqual(d.q.adds, [[{ op: "install", id: "com.ex.tweak", version: "3.0", installed: null, name: "Tweak" }, { quiet: true }]]);
  assert.deepEqual(d.opened, []);
  assert.equal(d.bars[0].message, "Install Tweak queued");
  d.bars[0].onUndo();
  assert.deepEqual(d.q.restored, [["com.ex.tweak", null]]);
});

test("F392: a hold on Modify queues an upgrade if there is one, else opens the usual menu", async () => {
  const up = holdDeps(page(INSTALLED));
  assert.equal(await installHold(ROUTE, "btn", up.opts), "queued");
  assert.deepEqual(up.q.adds[0][0], { op: "install", id: "com.ex.tweak", version: "3.0", installed: "2.0", name: "Tweak" });
  assert.equal(up.bars[0].message, "Upgrade Tweak queued");
  const same = holdDeps(page({ kind: "deb", versions: [{ version: "3.0", keys: ["src1"], installed: true }] }));
  assert.equal(await installHold(ROUTE, "btn", same.opts), "options");
  assert.deepEqual(same.q.adds, []);
  assert.deepEqual(same.opened, [[ROUTE, "btn"]]);
});

test("F392: queued already, paid, Add to App and the website: a hold opens the usual menu", async () => {
  const queued = holdDeps(page(NOT_INSTALLED));
  queued.opts.queue = heldQueue({ "com.ex.tweak": { op: "install" } });
  assert.equal(await installHold(ROUTE, "btn", queued.opts), "options");
  const paid = holdDeps(page(NOT_INSTALLED, { package: "com.ex.tweak", version: "3.0", tag: "cydia::commercial" }));
  assert.equal(await installHold(ROUTE, "btn", paid.opts), "options");
  const tweak = holdDeps(page(NOT_INSTALLED, { package: "com.ex.tweak", version: "3.0", injectable: true }), { mode: "sideload" });
  assert.equal(await installHold(ROUTE, "btn", tweak.opts), "options");
  const site = holdDeps(page(NOT_INSTALLED), { queue: null });
  assert.equal(await installHold(ROUTE, "btn", site.opts), "options");
  for (const d of [queued, paid, tweak, site]) assert.deepEqual([d.q.adds, d.bars, d.opened.length], [[], [], 1]);
});

test("F392: an app's hold: Install and an upgrade queue quietly, anything else opens its menu", async () => {
  const APP = { kind: "ipa", ipa: { bundleIdentifier: "com.ex.app", name: "App", versions: [{ version: "2.0" }] } };
  const job = { id: "com.ex.app", name: "App", version: "2.0" };
  const run = async (state, { check = async (j) => j, had = {} } = {}) => {
    const q = heldQueue(had);
    q.clear = (id) => q.restored.push(id);
    const d = holdDeps(page(null, APP), { appJobs: q, check, appState: async () => state });
    return { q, d, r: await installHold(ROUTE, "btn", d.opts) };
  };
  const fresh = await run({ apps: true, id: "com.ex.app", job, installed: null, newest: "2.0" });
  assert.equal(fresh.r, "queued");
  assert.deepEqual(fresh.q.adds, [[job, { quiet: true }]]);
  assert.equal(fresh.d.bars[0].message, "Install App queued");
  fresh.d.bars[0].onUndo();
  assert.deepEqual(fresh.q.restored, ["com.ex.app"]);
  const up = await run({ apps: true, id: "com.ex.app", job, installed: "1.0", newest: "2.0" }, { check: () => assert.fail("not asked for an upgrade") });
  assert.equal(up.d.bars[0].message, "Upgrade App queued");
  const jb = await run({ jbApps: true, id: "com.ex.app", job, installed: null, newest: "2.0" });
  assert.deepEqual(jb.q.adds[0][0], { app: "install", ...job });
  for (const state of [null, { apps: true, id: "com.ex.app", job, installed: "2.0", newest: "2.0" }, { apps: true, id: "com.ex.app", job, installed: null, newest: "2.0", queued: true },
    { jbApps: true, id: "com.ex.app", job, installed: "2.0", newest: "2.0" }, { apps: true, id: "com.ex.app", job: null, installed: null }]) {
    const none = await run(state);
    assert.equal(none.r, "options");
    assert.deepEqual([none.q.adds, none.d.bars], [[], []]);
  }
  const cancel = await run({ apps: true, id: "com.ex.app", job, installed: null, newest: "2.0" }, { check: async () => null });
  assert.equal(cancel.r, null, "Cancel on the original-app question");
  assert.deepEqual([cancel.q.adds, cancel.d.opened], [[], []]);
});

test("the website (no queue), a paid package and an app keep the options on a tap", async () => {
  const site = deps(page(NOT_INSTALLED), { queue: null });
  assert.equal(await installTap(ROUTE, "btn", site.opts), "options");
  const paid = deps(page(NOT_INSTALLED, { package: "com.ex.tweak", version: "3.0", tag: "cydia::commercial" }),
    { paidState: async () => ({ label: "$1.99", actions: [] }) });
  assert.equal(await installTap(ROUTE, "btn", paid.opts), "options");
  assert.deepEqual(paid.jobs, []);
  const failing = deps(page(NOT_INSTALLED, { package: "com.ex.tweak", version: "3.0", tag: "cydia::commercial" }),
    { paidState: async () => { throw new Error("vendor down"); } });
  assert.equal(await installTap(ROUTE, "btn", failing.opts), "options", "a failed paid check opens the options, never queues");
  assert.deepEqual(failing.jobs, []);
  const app = deps(page(NOT_INSTALLED, { kind: "ipa", ipa: { versions: [] } }));
  assert.equal(await installTap(ROUTE, "btn", app.opts), "options");
});

test("a page gone does nothing", async () => {
  const d = deps(page(NOT_INSTALLED));
  const gone = { tab: "sources", path: ["src1", "package:none"] };
  assert.equal(await installTap(gone, "btn", d.opts), null);
  assert.equal(await installHold(gone, "btn", d.opts), null);
  assert.deepEqual([d.jobs, d.opened], [[], []]);
});
