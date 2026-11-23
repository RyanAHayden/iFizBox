// F246: the app page's Install queues the app in the sideload app (altstore.js appPageAction), so F243's original-app
// warning (signing-client.js originalWarning) is asked there, before the job goes in: Cancel queues nothing, Install
// a Copy queues it with keepBundleId: false (the old way), and the runs sign it so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appPageAction, queueOriginalCheck } from "./altstore.js";
import { queueApp, installCustom } from "./queue.js";
import { createAppQueue } from "../core/appqueue.js";
import { prepareParams } from "../signing-client.js";

const pkgOf = (id, versions = ["2"]) => ({ key: "alt:k", row: { id, name: id }, stanza: { kind: "ipa", ipa: { bundleIdentifier: id, name: "App",
  sourceUrl: "https://s/", versions: versions.map((v) => ({ version: v, downloadURL: `https://s/${id}-${v}.ipa`, size: 2048 })) } } });
const noStore = async () => ({ all: async () => [] });
const storeWith = (rec) => async () => ({ all: async () => [rec] });

function setup(answer) {
  const q = createAppQueue();
  const asked = [];
  const warn = async (o) => { asked.push(o); return answer; };
  const add = (j, o) => queueApp(j, { ...o, open: () => {} });
  return { q, asked, opts: { queue: q, add, mode: "sideload", ready: async () => true, store: noStore, warn, signedOf: async () => null,
    ask: async () => assert.fail("no Modify sheet for a fresh install") } };
}

test("a fresh Install asks once before queuing; Install queues the job as it was", async () => {
  const { q, asked, opts } = setup("install");
  assert.equal(await appPageAction(pkgOf("com.x.a"), null, opts), true);
  assert.deepEqual(asked, [{ bundleId: "com.x.a", name: "App" }]);
  assert.equal(q.get("com.x.a").options, null);
});

test("Cancel queues nothing", async () => {
  const { q, opts } = setup("cancel");
  assert.equal(await appPageAction(pkgOf("com.x.a"), null, opts), true);
  assert.equal(q.size, 0);
});

test("Install a Copy queues the job with keepBundleId: false, and both runs sign it the old way", async () => {
  const { q, opts } = setup("copy");
  await appPageAction(pkgOf("com.x.a"), null, opts);
  const job = q.get("com.x.a");
  assert.deepEqual(job.options, { edits: { keepBundleId: false } });
  const credit = { name: "App", source: "https://s/", sourceName: null, key: "alt:k" }; // B247
  assert.deepEqual(prepareParams(job), { url: "https://s/com.x.a-2.ipa", listed: { version: "2", size: 2048 }, keepBundleId: false, credit });
  let got = null;
  const sc = { isSelfIpa: () => false, installOnDevice: async (o) => { got = o; return true; } };
  await installCustom(job, { sc, follow: () => {} });
  assert.deepEqual(got.params, { url: "https://s/com.x.a-2.ipa", keepBundleId: false, credit });
});

test("Version History's row asks too; an installed app (a record) or a queued one isn't asked", async () => {
  let s = setup("copy");
  await appPageAction(pkgOf("com.x.a", ["2", "1"]), null, { ...s.opts, version: "1" });
  assert.equal(s.asked.length, 1);
  assert.equal(s.q.get("com.x.a").version, "1");
  assert.equal(s.q.get("com.x.a").options.edits.keepBundleId, false);

  s = setup("cancel");
  await appPageAction(pkgOf("com.x.a", ["2", "1"]), null, { ...s.opts, store: storeWith({ id: "com.x.a", version: "1" }), ask: async () => 0 });
  assert.equal(s.asked.length, 0);
  assert.equal(s.q.size, 1, "Upgrade queued with no question");

  s = setup("cancel");
  s.q.add({ id: "com.x.a", url: "u" });
  await appPageAction(pkgOf("com.x.a"), null, { ...s.opts, ask: async () => -1 });
  assert.equal(s.asked.length, 0, "Modify on a queued app opens its sheet, no question");
});

test("queueOriginalCheck keeps a job's own edits and queues as it was when the check fails", async () => {
  const job = { id: "com.x.a", name: "A", options: { edits: { name: "Mine" } } };
  assert.deepEqual((await queueOriginalCheck(job, async () => "copy")).options, { edits: { name: "Mine", keepBundleId: false } });
  assert.equal(job.options.edits.keepBundleId, undefined, "the job itself is left alone");
  assert.equal(await queueOriginalCheck(job, async () => { throw new Error("no bridge"); }), job);
  assert.equal(await queueOriginalCheck(null, async () => "cancel"), null);
});
