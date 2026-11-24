// F416: Install IPAs > Manage > Sign and Install queues the picked IPAs together in the IPA queue's run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signMany, queueMany } from "./myipas.js";
import { createAppQueue } from "../core/appqueue.js";
import { appRows, createAppRun, HERE_PARALLEL } from "../core/apprun.js";

const ipa = (name, id, more = {}) => ({ file: `${name}.ipa`, name, bundleId: id, version: "1.0", size: 1, signed: null, ...more });
const A = ipa("Alpha", "com.x.alpha");
const B = ipa("Beta", "com.x.beta");
const C = ipa("Car", "com.x.car");
const base = { installed: {}, shared: {}, versionOf: async () => null, alert: () => assert.fail("asked") };
const noInstall = { install: () => assert.fail("installed one at a time"), siteInstall: () => assert.fail("site") };

test("signMany: with the Signing Server reachable every pick is queued, none installed in turn", async () => {
  const added = [];
  const out = await signMany([A, B, C], { isSite: false, ...noInstall, reachable: async () => true,
    queue: (p) => queueMany(p, { ...base, add: (j) => added.push(j) }) });
  assert.deepEqual(out, ["queued", "queued", "queued"]);
  assert.deepEqual(added.map((j) => [j.library, j.key]), [["Alpha.ipa", "library:Alpha.ipa"], ["Beta.ipa", "library:Beta.ipa"], ["Car.ipa", "library:Car.ipa"]]);
});

test("signMany: offline (or the check throws) and the website queue nothing", async () => {
  const queue = () => assert.fail("queued");
  const hudFor = () => () => ({});
  const confirm = async () => true;
  for (const reachable of [async () => false, () => { throw new Error("x"); }]) {
    assert.deepEqual(await signMany([A, B], { isSite: false, reachable, queue, hudFor, confirm, install: async () => "offline" }), ["offline"]);
  }
  assert.deepEqual(await signMany([A], { isSite: true, reachable: () => assert.fail("asked"), queue, confirm, siteInstall: async () => true }), [true]);
});

test("queueMany: every Replace App? ask comes before anything is queued; Cancel skips that IPA only", async () => {
  const id = "com.burbn.instagram";
  const plain = ipa("RyukGram", id);
  const other = ipa("RyukGram No Plugins", id);
  const order = [];
  const deps = (index) => ({ ...base, installed: { [id]: true }, shared: { [id]: { file: plain.file, name: "RyukGram" } },
    alert: async () => { order.push("ask"); return { index }; }, add: (j) => order.push(j.library) });
  assert.deepEqual(await queueMany([A, other, B], deps(0)), ["queued", "cancelled", "queued"]);
  assert.deepEqual(order.splice(0), ["ask", "Alpha.ipa", "Beta.ipa"]);
  assert.deepEqual(await queueMany([A, other], deps(1)), ["queued", "queued"]);
  assert.deepEqual(order, ["ask", "Alpha.ipa", other.file]);
});

test("queueMany: an unreadable IPA isn't queued; picks with one bundle ID are one job, the last", async () => {
  const q = createAppQueue();
  const twin = ipa("Alpha Two", A.bundleId);
  assert.deepEqual(await queueMany([A, { file: "B.ipa", error: "bad" }, twin], { ...base, add: (j) => q.add(j) }), ["queued", false, "queued"]);
  assert.deepEqual(q.list().map((j) => j.library), ["Alpha Two.ipa"]);
});

test("the queued picks overlap on This iPhone, up to HERE_PARALLEL, in the app run", async () => {
  const q = createAppQueue();
  const picks = [A, B, C, ipa("Delta", "com.x.delta")];
  await queueMany(picks, { ...base, add: (j) => q.add(j) });
  const sent = [];
  const pending = [];
  const run = createAppRun({ rows: appRows(q.list()), ahead: Infinity, parallel: HERE_PARALLEL, local: () => true,
    sign: async (r) => ({ token: r.id, bundleId: r.id }),
    install: (r, hooks) => new Promise((ok) => { sent.push(r.id); pending.push(ok); hooks.progress("copying", 0); }) });
  const ended = run.start();
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setTimeout(ok, 0)); };
  await settle();
  assert.equal(sent.length, HERE_PARALLEL);
  for (let i = 0; i < picks.length; i++) { pending[i]({ installed: true }); await settle(); }
  await ended;
  assert.deepEqual(sent, picks.map((p) => p.bundleId));
});
