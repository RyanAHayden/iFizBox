// F91: Needs Re-sign on Changes (group, badge, Upgrade (N)), the Installed tab's pill, the app page's Modify Re-sign,
// Confirm's Re-sign group and its run (signing.resign), and Signed Apps' Re-sign All through the queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsOf, badgeCount, resignNow, queueAll, queueResigns } from "./changes.js";
import { withSignatures } from "./installed.js";
import { appPageAction, signatureRow, signedRecordOf } from "./altstore.js";
import { openAppConfirm, runAppQueue, resignApp } from "./queue.js";
import { queueResignAll } from "./signed-apps.js";
import { createAppQueue, SELF_ID } from "../core/appqueue.js";
import { needsResign, signedAppRows } from "../core/signing.js";
import { withDocument } from "../fakes.test-helper.js";

const now = new Date("2026-11-18T12:00:00Z");
const inDays = (d) => new Date(now.getTime() + d * 86400000).toISOString();
const installed = { apps: [
  { bundleId: "a", name: "Alpha", version: "1.0", expires: inDays(5) },
  { bundleId: "b", name: "Bravo", version: "2.0", expires: inDays(1.5) },
  { bundleId: "c", name: "Charlie", version: "3.0", expires: inDays(-1) },
  { bundleId: "u", name: "Upgradable", version: "1", expires: inDays(1) },
] };
const native = (answer = installed, calls = []) => ({ call: async (m, p, onEvent) => { calls.push([m, p]); if (typeof answer === "function") return answer(m, p, onEvent); return answer; } });

test("Changes: Needs Re-sign above Available Upgrades, its rows not listed again under their day", () => {
  const resign = needsResign(installed, { now, window: 2, skip: new Set(["u"]) });
  const items = itemsOf([{ day: new Date(2026, 10, 18).getTime(), rows: [{ id: "b", name: "Bravo", change: "updated" }, { id: "x", name: "X", change: "new" }] }],
    "en-US", { available: [{ id: "u", name: "Upgradable", version: "2", installed: "1" }], ignored: [] }, { now: now.getTime(), resign });
  assert.deepEqual(items.map((i) => i.header ?? `${i.id}:${i.change}`),
    ["Needs Re-sign", "c:resign", "b:resign", "Available Upgrades", "u:upgrade", "Today", "x:new"]);
  assert.equal(items[1].version, "Expired");
  assert.equal(items[1].sig, "expired");
  // search filters it as the upgrades
  assert.deepEqual(itemsOf([], "en-US", { available: [], ignored: [] }, { query: "brav", resign }).map((i) => i.header ?? i.id), ["Needs Re-sign", "b"]);
});

test("Changes: the badge and Upgrade (N) count the re-signs; resignNow reads signing.installed in the sideload app only", async () => {
  const upgrades = { available: [{ id: "u", version: "2", installed: "1" }], ignored: [] };
  const calls = [];
  const resign = await resignNow(upgrades, { mode: "sideload", native: native(installed, calls), get: () => 2, now });
  assert.deepEqual(resign.map((r) => r.id), ["c", "b"]); // u has an upgrade: the upgrade signs it anew
  assert.deepEqual(calls, [["signing.installed", {}]]);
  assert.equal(badgeCount(upgrades, resign), 3);
  assert.equal(badgeCount(upgrades), 1);
  assert.deepEqual(await resignNow(upgrades, { mode: "jailbreak", native: native(), now }), []);
  assert.deepEqual(await resignNow(upgrades, { mode: "site", native: native(), now }), []);
  assert.deepEqual(await resignNow(upgrades, { mode: "sideload", native: undefined, now }), []);
  assert.deepEqual(await resignNow(upgrades, { mode: "sideload", native: native(() => { throw new Error("old shell"); }), now }), []);
  assert.deepEqual((await resignNow(upgrades, { mode: "sideload", native: native(), get: () => 7, now })).map((r) => r.id), ["c", "b", "a"]);
});

test("Changes: Upgrade (N) queues the re-signs, then the upgrades", async () => {
  const q = createAppQueue();
  const add = (j) => q.add(j);
  const resign = needsResign(installed, { now, window: 2, skip: new Set(["u"]) });
  const pkgOf = async () => null;
  const jobs = await queueAll([{ id: "u", name: "U", version: "2", installed: "1", ipa: "https://s/u.ipa" }], resign, { add, pkgOf });
  assert.deepEqual(jobs.map((j) => `${j.id}:${j.mode ?? "?"}`), ["c:resign", "b:resign", "u:?"]);
  assert.deepEqual(q.list().map((j) => `${j.id}:${j.mode}`), ["c:resign", "b:resign", "u:upgrade"]);
  assert.equal(q.get("c").version, "3.0");
  assert.deepEqual(queueResigns([], { add }), []);
});

test("Installed: the signature pill for each app iFizBox signed, and signed apps the list doesn't hold", () => {
  const rows = [{ id: "a", name: "Alpha", version: "1.0" }, { id: "z", name: "Zed", version: "9" }, { id: "c.orig", name: "Charlie", version: "3.0" }];
  const signed = { apps: [...installed.apps.slice(0, 2), { ...installed.apps[2], originalBundleId: "c.orig" }] };
  const r = withSignatures(rows, signed, { now, window: 2 });
  assert.deepEqual(r.rows.map((x) => [x.id, x.sig?.state ?? null, x.sig?.text ?? null]),
    [["a", "ok", "5 days"], ["z", null, null], ["c.orig", "expired", "Expired"]]);
  assert.deepEqual(r.extra.map((x) => [x.id, x.sig.state, x.sig.text, x.signedOnly]), [["b", "soon", "1 day", true]]);
  assert.deepEqual(withSignatures(rows, null, { now }).rows, rows);
});

test("app page: the Signature row, and Modify's Re-sign queues a resign job", async () => {
  assert.deepEqual(signatureRow({ expires: inDays(5) }, { now, window: 2 }), { label: "Signature", detail: "5 days left", cls: "sig-row-ok" });
  assert.equal(signatureRow({ expires: inDays(-1) }, { now, window: 2 }).cls, "sig-row-expired");
  assert.equal(signatureRow(null, { now }), null);
  assert.equal((await signedRecordOf("b", { mode: "sideload", native: native() })).name, "Bravo");
  assert.equal(await signedRecordOf("b", { mode: "site", native: native() }), null);

  const pkg = { key: "alt:k", row: { id: "b", name: "Bravo" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "b", name: "Bravo",
    sourceUrl: "https://s/", versions: [{ version: "2.0", downloadURL: "https://s/b.ipa" }] } } };
  const q = createAppQueue();
  const add = (j, o) => o.queue.add(j);
  const base = { queue: q, add, mode: "sideload", ready: async () => true, iv: null, store: async () => ({ all: async () => [{ id: "b", version: "2.0" }] }),
    signedOf: async (id) => installed.apps.find((a) => a.bundleId === id) ?? null };
  let sheet = null;
  assert.equal(await appPageAction(pkg, null, { ...base, ask: async (o) => { sheet = o; return 1; } }), true);
  assert.deepEqual(sheet.buttons, ["Reinstall", "Re-sign", "Mark as Not Installed"]); // F94
  assert.deepEqual([q.get("b").mode, q.get("b").version, q.get("b").url], ["resign", "2.0", null]);
  // signed but never recorded as installed: installed all the same (B358: the signed version), Re-sign offered
  q.clearAll();
  const unrecorded = { ...base, store: async () => ({ all: async () => [] }) };
  assert.equal(await appPageAction(pkg, null, { ...unrecorded, forgetSigned: async () => {}, ask: async (o) => { sheet = o; return 1; } }), true);
  assert.deepEqual(sheet.buttons, ["Reinstall", "Re-sign", "Mark as Not Installed"]);
  assert.equal(q.get("b").mode, "resign");
  // not signed by iFizBox, only marked: Re-sign while its version is on the source (F221), not once it's gone
  q.clearAll();
  await appPageAction(pkg, null, { ...base, signedOf: async () => null, ask: async (o) => { sheet = o; return -1; } });
  assert.deepEqual(sheet.buttons, ["Reinstall", "Re-sign", "Mark as Not Installed"]);
  const gone = { ...base, signedOf: async () => null, store: async () => ({ all: async () => [{ id: "b", version: "1.0" }] }) };
  await appPageAction(pkg, null, { ...gone, ask: async (o) => { sheet = o; return -1; } });
  assert.deepEqual(sheet.buttons, ["Upgrade", "Mark as Not Installed"]);
});

test("Confirm's run: a resign job goes through signing.resign {bundleId}, iFizBox's hosted and last; a failure stops the run", async () => {
  const calls = [];
  const sc = { getServer: () => "https://sign.example" };
  const hud = () => ({ set() {}, hide() {} });
  const alerts = [];
  const alert = async (o) => { alerts.push(o.title); return { index: 0 }; };
  const ok = native((m, p) => ({ done: [p.bundleId], failed: [] }), calls);
  assert.equal(await resignApp({ id: "b", name: "Bravo", mode: "resign" }, { sc, native: ok, hud, alert }), true);
  assert.equal(await resignApp({ id: SELF_ID, name: "iFizBox", mode: "resign" }, { sc, native: ok, hud, alert }), true);
  assert.deepEqual(calls, [["signing.resign", { bundleId: "b", manifestServer: "https://sign.example" }],
    ["signing.resign", { bundleId: SELF_ID, manifestServer: "https://sign.example", host: true }]]);
  const bad = native((m, p) => ({ done: [], failed: [{ bundleId: p.bundleId, name: "Bravo", error: "cancelled: iOS didn't fetch it" }] }));
  assert.equal(await resignApp({ id: "b", name: "Bravo", mode: "resign" }, { sc, native: bad, hud, alert }), false);
  const thrown = native(() => { throw Object.assign(new Error("not_signed: no record"), { code: "not_signed" }); });
  assert.equal(await resignApp({ id: "b", name: "Bravo", mode: "resign" }, { sc, native: thrown, hud, alert }), false);
  assert.deepEqual(alerts, ["Couldn't Re-sign Bravo", "Couldn't Re-sign Bravo"]);

  const q = createAppQueue();
  q.add({ id: SELF_ID, name: "iFizBox", version: "0.3.6", mode: "resign" });
  q.add({ id: "b", name: "Bravo", version: "2.0", mode: "resign" });
  const order = [];
  const recorded = [];
  assert.equal(await runAppQueue(q.list(), { queue: q, ready: async () => true, install: async (j) => { order.push(j.id); return true; }, record: async (j) => recorded.push(j.id) }), 2);
  assert.deepEqual(order, ["b", SELF_ID]);
  assert.equal(q.size, 0);
});

test("Signed Apps: Re-sign All queues every app as a resign job (Confirm opens) instead of running", async () => {
  const q = createAppQueue();
  const rows = signedAppRows(installed, now);
  const jobs = await queueResignAll(rows, { add: (j) => q.add(j) });
  assert.deepEqual(jobs.map((j) => j.id), ["c", "u", "b", "a"]);
  assert.ok(q.list().every((j) => j.mode === "resign" && j.url === null));
});

// Confirm over a small fake DOM (as essentialqueue.test.js): its Modifications has a Re-sign row with the names.
// Each node's own text, in tree order.
const texts = (root, out = []) => { if (root._text) out.push(root._text); for (const c of root.children) texts(c, out); return out; };

test("Confirm: a Re-sign group in Modifications", async () => {
  await withDocument(async ({ body }) => {
    const q = createAppQueue();
    q.add({ id: "b", name: "Bravo", version: "2.0", mode: "resign" });
    q.add({ id: "c", name: "Charlie", version: "3.0", mode: "resign" });
    q.add({ id: "x", name: "X", version: "2", installed: "1", url: "https://s/x.ipa" });
    openAppConfirm(q);
    const t = texts(body);
    const at = t.indexOf("Re-sign");
    assert.ok(at >= 0, `no Re-sign row in ${JSON.stringify(t)}`);
    assert.equal(t[at + 1], "Bravo\nCharlie");
    assert.ok(t.includes("Upgrade"));
    q.clearAll();
  });
});

// F134: Settings > Signing > Show Expiry Dates off hides the days left (pills, the Signature row) but not Expired,
// and leaves Changes' Needs Re-sign (the reminder's list) as it was.
test("Show Expiry Dates off: no pill or Signature row with days left; Expired still shows", () => {
  const rows = [{ id: "a", name: "Alpha", version: "1.0" }, { id: "c", name: "Charlie", version: "3.0" }];
  const signed = { apps: [installed.apps[0], installed.apps[2], installed.apps[1]] };
  const off = withSignatures(rows, signed, { now, window: 2, show: false });
  assert.deepEqual(off.rows.map((x) => [x.id, x.sig?.text ?? null]), [["a", null], ["c", "Expired"]]);
  assert.deepEqual(off.extra.map((x) => [x.id, x.sig ?? null, x.signedOnly]), [["b", null, true]]); // still listed, without the pill
  const on = withSignatures(rows, signed, { now, window: 2, show: true });
  assert.deepEqual(on.rows.map((x) => x.sig?.text ?? null), ["5 days", "Expired"]);
  assert.equal(signatureRow({ expires: inDays(5) }, { now, window: 2, show: false }), null);
  assert.equal(signatureRow({ expires: inDays(-1) }, { now, window: 2, show: false }).detail, "Expired");
  assert.equal(signatureRow({ expires: inDays(5) }, { now, window: 2, show: true }).detail, "5 days left");
  // the re-sign list is the reminder's: it doesn't read the switch
  assert.deepEqual(needsResign(installed, { now, window: 2 }).map((r) => r.id).sort(), ["b", "c", "u"]);
});
