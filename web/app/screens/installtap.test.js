// B330: a package page's Install (not installed: no Modify) queues on a tap, so Confirm opens, and opens the options
// sheet on a hold; Modify, an app's Install, Add to App, a paid package and the website keep what they did.
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
  const jobs = [], opened = [], held = [];
  return { jobs, opened, held, opts: { pages: pagesOf(p), mode: "jailbreak", queue: async (j) => { jobs.push(j); },
    paidState: async () => null, options: async (route, b) => { opened.push([route, b]); },
    versions: async (route) => { held.push(route); return "versions"; }, ...extra } };
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

test("a hold on Install opens the options sheet, not Install Which Version?", async () => {
  const d = deps(page(NOT_INSTALLED));
  assert.equal(await installHold(ROUTE, "btn", d.opts), "options");
  assert.deepEqual(d.opened, [[ROUTE, "btn"]]);
  assert.deepEqual(d.held, []);
  assert.deepEqual(d.jobs, []);
});

test("Modify is unchanged: a tap opens its sheet, a hold Install Which Version?", async () => {
  const d = deps(page(INSTALLED));
  assert.equal(await installTap(ROUTE, "btn", d.opts), "options");
  assert.deepEqual(d.jobs, []);
  assert.equal(await installHold(ROUTE, "btn", d.opts), "versions");
  assert.deepEqual(d.held, [ROUTE]);
  assert.equal(d.opened.length, 1);
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
  assert.equal(await installHold(ROUTE, "btn", app.opts), "versions");
});

test("a page gone does nothing", async () => {
  const d = deps(page(NOT_INSTALLED));
  const gone = { tab: "sources", path: ["src1", "package:none"] };
  assert.equal(await installTap(gone, "btn", d.opts), null);
  assert.equal(await installHold(gone, "btn", d.opts), null);
  assert.deepEqual([d.jobs, d.opened, d.held], [[], [], []]);
});
