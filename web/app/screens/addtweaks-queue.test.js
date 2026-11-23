// SPDX-License-Identifier: GPL-3.0-or-later
// F401: Add Tweaks opened from an app's page works on that app and its queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { queueHooks, addToThisApp } from "./addtweaks-queue.js";
import { addTweakButton, addToApp, savedTweaks, saveTweaks, keptTweakParams } from "./tweaks.js";
import { addTweaksContext } from "./browse.js";
import { appPageJob } from "./altstore.js";
import { createAppQueue } from "../core/appqueue.js";
import { openAppConfirm } from "./queue.js";
import { PaidNeeded } from "../core/payment.js";
import { memoryIpaStore } from "../core/myipas.js";
import { fakeDocument, withDocument } from "../fakes.test-helper.js";

const deb = new Uint8Array(readFileSync(new URL("../core/fixtures/tweaks/tweak-xz.deb", import.meta.url)));
const BID = "com.me.app";
const TARGET = { bundleId: BID, name: "My App", id: BID, key: "k1" };
const REC = { bundleId: `${BID}.TEAM`, originalBundleId: BID, name: "My App", version: "2.0", tweaks: [] };
const tweak = (id, o = {}) => ({ package: id, name: id.split(".").at(-1), version: "1.0", debUrl: `https://repo.x/${id}.deb`, ...o });
const INSTALL = { id: BID, name: "My App", version: "3.0", url: "https://x/a.ipa" };
const doc = Object.assign(fakeDocument(), { head: { append() {} } });
const withDoc = (f) => withDocument(f, doc);

function setup({ records = [REC], install = async () => INSTALL, info = { ok: true, bundles: [BID] } } = {}) {
  const mem = memoryIpaStore();
  const m = new Map();
  const queue = createAppQueue();
  const seen = { opened: 0, alerts: [], adds: 0, installs: 0 };
  queue.subscribe((e) => { if (e.type === "add") seen.adds++; });
  const store = async () => mem;
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  for (const id of ["dev.x.One", "dev.x.Two", "dev.x.Paid"]) {
    const all = JSON.parse(storage.getItem("ifizbox.tweakInfo") ?? "{}");
    storage.setItem("ifizbox.tweakInfo", JSON.stringify({ ...all, [`${id}@1.0`]: info }));
  }
  const opts = { queue, store, running: () => false, records: async () => records, install: async (t) => { seen.installs++; return install(t); } };
  const button = (st, o = {}) => addTweakButton({ id: st.package, name: st.name, version: "1.0", key: "t" }, { bundleId: BID, onCls: "added", store,
    storage, pkg: async () => st, fetchDeb: async () => deb, alert: async (a) => { seen.alerts.push(a); }, sheet: async () => 0,
    queue: queueHooks(TARGET, opts), ...o });
  const toApp = (st, o = {}) => addToThisApp(st, TARGET, { ...opts, open: () => { seen.opened++; }, alert: async (a) => { seen.alerts.push(a); },
    storage, hud: () => () => {}, apps: async () => [], fetchDeb: async () => deb, ...o });
  return { queue, store, storage, seen, button, toApp, opts };
}
const names = async (s, id = BID) => (await savedTweaks(id, { store: s.store })).map((x) => x.name);

test("ADD on a signed app: a re-sign with the tweak is queued; several ADDs, side by side, make one job", () => withDoc(async () => {
  const s = setup();
  await Promise.all([s.button(tweak("dev.x.One")).fire("click"), s.button(tweak("dev.x.Two")).fire("click")]);
  assert.deepEqual((await names(s)).sort(), ["dev.x.One_1.0.deb", "dev.x.Two_1.0.deb"], "neither write lost the other's");
  assert.equal(s.queue.size, 1);
  assert.equal(s.seen.adds, 1);
  const job = s.queue.get(REC.bundleId);
  assert.equal(job.mode, "resign");
  assert.deepEqual(job.tweaks.map((t) => t.name).sort(), ["One", "Two"]);
  assert.equal(s.seen.installs, 0);
  const p = await keptTweakParams({ record: job.id }, job, { store: s.store, records: async () => [REC], ellekit: async () => null, toBase64: () => "b" })
    .catch((e) => e);
  assert.ok(p.tweaks || p instanceof Error, "the kept tweaks are sent (or asked ElleKit)");
}));

test("ADD on an app not signed here: the install its page would queue, once", () => withDoc(async () => {
  const s = setup({ records: [] });
  await s.button(tweak("dev.x.One")).fire("click");
  await s.button(tweak("dev.x.Two")).fire("click");
  assert.equal(s.queue.size, 1);
  assert.equal(s.queue.get(BID).mode, "install");
  assert.equal(s.queue.get(BID).tweaks.length, 2);
  assert.equal(s.seen.installs, 1);
  const none = setup({ records: [], install: async () => null });
  await none.button(tweak("dev.x.One")).fire("click");
  assert.equal(none.queue.size, 0);
  assert.equal((await names(none)).length, 1, "kept all the same");
}));

test("ADD on an app already queued: its job takes the tweak, a Custom Install's own list too, and Remove leaves the job", () => withDoc(async () => {
  const s = setup();
  s.queue.add({ ...INSTALL, options: { edits: { name: "Mine", tweaks: { names: ["old"] } } } });
  const job = s.queue.get(BID);
  await s.button(tweak("dev.x.One")).fire("click");
  assert.equal(s.queue.size, 1);
  assert.equal(s.seen.adds, 1);
  assert.deepEqual(job.options.edits, { name: "Mine" });
  assert.deepEqual(job.tweaks, [{ id: "dev.x.One", name: "One" }]);
  await s.button(tweak("dev.x.One"), { on: true }).fire("click"); // Remove
  assert.equal(s.queue.get(BID), job);
  assert.deepEqual(job.tweaks, []);
  assert.deepEqual(await names(s), []);
}));

test("a failed check, or a paid tweak not bought, queues nothing", () => withDoc(async () => {
  const s = setup({ info: { ok: false, v: 2, why: "No." } });
  await s.button(tweak("dev.x.One")).fire("click");
  assert.equal(s.queue.size, 0);
  assert.equal(s.seen.alerts[0].message, "No.");
  const p = setup();
  const paid = { deb: async () => { throw new PaidNeeded("buy", "$1"); }, seller: async () => null };
  await p.button(tweak("dev.x.Paid", { tag: "cydia::commercial" }), { paid, sheet: async () => -1 }).fire("click");
  assert.equal(p.queue.size, 0);
  assert.equal(p.seen.alerts.length, 0);
  assert.deepEqual(await names(p), []);
}));

test("Remove: the tweak leaves the job; the job goes with its last tweak when only they queued it", () => withDoc(async () => {
  const s = setup();
  await s.button(tweak("dev.x.One")).fire("click");
  await s.button(tweak("dev.x.Two")).fire("click");
  await s.button(tweak("dev.x.One"), { on: true }).fire("click");
  assert.deepEqual(s.queue.get(REC.bundleId).tweaks.map((t) => t.name), ["Two"]);
  await s.button(tweak("dev.x.Two"), { on: true }).fire("click");
  assert.equal(s.queue.size, 0);
  // queued again by hand meanwhile: no longer only for the tweak
  await s.button(tweak("dev.x.One")).fire("click");
  s.queue.add({ id: REC.bundleId, name: "My App", mode: "resign", version: "2.0" });
  assert.equal(s.queue.get(REC.bundleId).tweaks.length, 1, "queued again, it keeps its tweak");
  await s.button(tweak("dev.x.One"), { on: true }).fire("click");
  assert.equal(s.queue.size, 1);
}));

test("Remove of the last tweak a queued re-sign was signed with: the re-sign goes without it", () => withDoc(async () => {
  const rec = { ...REC, tweaks: ["dev.x.One_1.0.deb"] };
  const s = setup({ records: [rec] });
  await saveTweaks(BID, [{ name: "dev.x.One_1.0.deb", data: deb }], { store: s.store });
  s.queue.add({ id: rec.bundleId, name: "My App", mode: "resign", version: "2.0" });
  await s.button(tweak("dev.x.One"), { on: true }).fire("click");
  const job = s.queue.get(rec.bundleId);
  assert.deepEqual(await keptTweakParams({ record: job.id }, job, { store: s.store, records: async () => [rec] }), { record: job.id, tweaks: {} });
}));

test("while a run is going its job isn't changed: the tweak is kept for the next sign", () => withDoc(async () => {
  const s = setup();
  s.opts.running = () => true;
  s.queue.add({ id: REC.bundleId, name: "My App", mode: "resign", version: "2.0" });
  await s.button(tweak("dev.x.One"), { queue: queueHooks(TARGET, s.opts) }).fire("click");
  assert.equal(s.queue.get(REC.bundleId).tweaks, undefined);
  assert.equal((await names(s)).length, 1);
}));

test("Add to App from Add Tweaks: no picker, the app queued with the tweak, Confirm opened; again adds nothing", async () => {
  const s = setup({ records: [] });
  const st = tweak("dev.x.One");
  await s.toApp(st, { pick: async () => assert.fail("no picker") });
  assert.deepEqual(await names(s), ["dev.x.One_1.0.deb"]);
  assert.equal(s.queue.size, 1);
  assert.deepEqual([s.seen.opened, s.seen.adds, s.seen.alerts.length], [1, 1, 0]);
  await s.toApp(st, { addTo: async () => assert.fail("added twice") });
  assert.deepEqual([s.seen.opened, s.seen.adds, s.queue.get(BID).tweaks.length], [2, 1, 1]);
  // taken out of the queue: it is queued again
  s.queue.clearAll();
  await s.toApp(st);
  assert.deepEqual([s.seen.opened, s.queue.size], [3, 1]);
});

test("Add to App after ADD on a signed app: opens Confirm, one job; signed in already: Added", async () => withDoc(async () => {
  const s = setup();
  await s.button(tweak("dev.x.One")).fire("click");
  assert.equal(s.seen.opened, 0);
  await s.toApp(tweak("dev.x.One"));
  assert.deepEqual([s.seen.opened, s.seen.adds], [1, 1]);
  const done = setup({ records: [{ ...REC, tweaks: ["dev.x.One_1.0.deb"] }] });
  await saveTweaks(BID, [{ name: "dev.x.One_1.0.deb", data: deb }], { store: done.store });
  await done.toApp(tweak("dev.x.One"));
  assert.equal(done.seen.alerts[0].title, "Added");
  assert.deepEqual([done.seen.opened, done.queue.size], [0, 0]);
}));

test("Add to App from Add Tweaks: a tweak whose filter doesn't name the app is refused", async () => {
  const s = setup({ info: { ok: true, bundles: ["com.other"] } });
  await s.toApp(tweak("dev.x.One"));
  assert.equal(s.seen.alerts[0].title, "Can't Add This Tweak");
  assert.match(s.seen.alerts[0].message, /not in My App/);
  assert.equal(s.queue.size, 0);
  assert.deepEqual(await names(s), []);
});

test("Add to App without the context still asks which app", async () => {
  const s = setup();
  let asked = 0;
  await addToApp(tweak("dev.x.One"), { hud: () => () => {}, store: s.store, storage: s.storage, records: async () => [REC], apps: async () => [{ bundleId: BID, name: "My App" }],
    fetchDeb: async () => deb, alert: async () => {}, pick: async (o) => { asked++; return o.made[0]; }, queue: async (j) => j });
  assert.equal(asked, 1);
});

test("the app a tweak's page was opened for: from Sources, Search, Install IPAs and mounts; none elsewhere", () => {
  const app = { bundleId: BID, name: BID, id: "com.me.app", key: "k1" };
  const at = `addtweaks:${BID}`;
  assert.deepEqual(addTweaksContext({ tab: "sources", path: ["k1", "package:com.me.app", at, "package:dev.x.One@t"] }), app);
  assert.deepEqual(addTweaksContext({ tab: "sources", path: ["k1", "package:com.me.app", at] }), app);
  assert.deepEqual(addTweaksContext({ tab: "installed", path: ["package:com.me.app@k1", at, "package:dev.x.One@t", "package:dev.x.Two@t"] }), app);
  assert.deepEqual(addTweaksContext({ tab: "installed", path: ["myipas", "search", "package:com.me.app@k1", at, "package:a@t"] }), app);
  assert.deepEqual(addTweaksContext({ tab: "installed", path: ["myipas", "ipa:a b.ipa", at, "package:a@t"] }), { bundleId: BID, name: BID, file: "a b.ipa" });
  assert.equal(addTweaksContext({ tab: "sources", path: ["t", "package:dev.x.One"] }), null);
  assert.equal(addTweaksContext({ tab: "search", path: ["package:dev.x.One"] }), null);
});

test("Confirm names the queued tweaks under the app", () => withDoc(async () => {
  const q = createAppQueue();
  q.add({ ...INSTALL, tweaks: [{ id: "a", name: "One" }, { id: "b", name: "Two" }], tweaksOf: BID, forTweaks: true });
  q.add({ id: "com.other", name: "Other", url: "https://x/b.ipa" });
  openAppConfirm(q);
  const all = (e) => [e, ...(e.children ?? []).flatMap(all)];
  const spans = all(doc.body).filter((e) => e.classList?.contains("confirm-needed"));
  assert.deepEqual(spans.map((e) => e.textContent), ["with One, Two"]);
  q.clearAll();
}));

test("appPageJob: the app page's install; Cancel on its question, or another build, gives none", async () => {
  const pkg = { key: "k1", row: { id: BID }, stanza: { kind: "ipa", ipa: { bundleIdentifier: BID, name: "My App", versions: [{ version: "3", downloadURL: "https://x/a.ipa" }] } } };
  const store = async () => ({ all: async () => [] });
  assert.equal((await appPageJob(pkg, null, { mode: "sideload", store, warn: async () => "install" })).url, "https://x/a.ipa");
  assert.equal(await appPageJob(pkg, null, { mode: "sideload", store, warn: async () => "cancel" }), null);
  assert.equal(await appPageJob(pkg, null, { mode: "site", store }), null);
});
