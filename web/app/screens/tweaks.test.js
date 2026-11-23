// SPDX-License-Identifier: GPL-3.0-or-later
// B342: Add to App queues a re-sign of the picked app with the tweak in it (the queue signs and installs it, as
// Installed's Re-sign does); an app this phone didn't sign keeps the tweak for its next sign and says why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addToApp, signedRecordFor, savedTweaks, keptTweakParams } from "./tweaks.js";
import { resignJob } from "../core/appqueue.js";
import { memoryIpaStore } from "../core/myipas.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`../core/fixtures/tweaks/${n}`, import.meta.url)));
const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const st = (o = {}) => ({ package: "com.me.fixture", name: "Fixture", version: "9", debUrl: "https://repo.x/fixture.deb", depends: "mobilesubstrate", ...o });
const APP = { bundleId: "com.me.fixture", name: "Fixture" };

function run(records, extra = {}) {
  const mem = memoryIpaStore();
  const store = async () => mem;
  const seen = { alerts: [], queued: [] };
  const p = addToApp(st(), {
    hud: () => () => {}, pick: async (o) => o.made[0], alert: async (o) => { seen.alerts.push(o); return 0; },
    apps: async () => [APP], fetchDeb: async () => fx("tweak-xz.deb"), storage: storage(), store,
    records: async () => records, queue: async (j) => { seen.queued.push(j); return j; }, ...extra,
  });
  return { p, seen, store };
}

test("Add to App queues a resign job for the picked app, and that re-sign sends the tweak", async () => {
  const rec = { bundleId: "com.me.fixture.ABCDE", originalBundleId: "com.me.fixture", name: "Fixture", version: "2.0", tweaks: [] };
  const { p, seen, store } = run([{ bundleId: "com.x.other", name: "Other" }, rec]);
  assert.equal((await p).bundleId, "com.me.fixture");
  assert.deepEqual(seen.queued, [resignJob(rec)]);
  assert.equal(seen.queued[0].mode, "resign");
  assert.equal(seen.queued[0].id, "com.me.fixture.ABCDE");
  assert.deepEqual(seen.alerts, [], "the queue's own flow, no Tweak Added alert");
  assert.deepEqual((await savedTweaks("com.me.fixture", { store })).map((x) => x.name), ["com.me.fixture_9.deb"]);
  // the queued re-sign's params (signing/queue.js: { record: job.id }) carry the kept tweak: the record had none
  const params = await keptTweakParams({ record: seen.queued[0].id }, seen.queued[0],
    { store, records: async () => [rec], ellekit: async () => fx("ellekit.deb"), toBase64: () => "b64" });
  assert.deepEqual(params.tweaks.names, ["com.me.fixture_9.deb"], "the tweak is in the re-sign's options");
});

test("Add to App on an app not signed here: says why, keeps the tweak for its next sign, queues nothing", async () => {
  const { p, seen, store } = run([]);
  assert.equal((await p).bundleId, "com.me.fixture");
  assert.deepEqual(seen.queued, []);
  assert.equal(seen.alerts.length, 1);
  assert.equal(seen.alerts[0].title, "Tweak Added");
  assert.match(seen.alerts[0].message, /wasn't signed on this phone/);
  assert.doesNotMatch(seen.alerts[0].message, /next time/);
  assert.deepEqual((await savedTweaks("com.me.fixture", { store })).map((x) => x.name), ["com.me.fixture_9.deb"]);
});

test("signedRecordFor: by the record's bundle ID or the one it was signed from; none off the sideload app", async () => {
  const recs = [{ bundleId: "a.b" }, { bundleId: "c.d.X", originalBundleId: "c.d" }];
  assert.equal((await signedRecordFor("a.b", async () => recs)).bundleId, "a.b");
  assert.equal((await signedRecordFor("c.d", async () => recs)).bundleId, "c.d.X");
  assert.equal(await signedRecordFor("e.f", async () => recs), null);
  assert.equal(await signedRecordFor("a.b", async () => { throw new Error("no bridge"); }), null);
  assert.equal(await signedRecordFor("a.b"), null); // node: no native bridge
});
