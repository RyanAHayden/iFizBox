import { test } from "node:test";
import assert from "node:assert/strict";
import { openIndexCache, INDEX_CACHE_FAILED } from "./cache.js";
import { openSourceStore, SOURCE_STORE_FAILED } from "./sources.js";
import { openAppStore, APP_STORE_FAILED } from "./installed.js";
import { withAltSources, ALT_STORE_FAILED } from "./altstore.js";
import { openIpaStore, IPA_STORE_FAILED, addSiteFile } from "./myipas.js";
import { saveIdentity, loadIdentity, clearIdentity, IDENTITY_STORE_FAILED } from "../signing/identity.js";
import { fakeIndexedDB, memStorage } from "../fakes.test-helper.js";

// A fake IndexedDB the "browser" can end: while `bad.left` > 0 a transaction is aborted with no error (or, with
// `bad.closed`, refused as on a closed connection). `bad.opens` counts the connections made.
function endingIndexedDB(bad) {
  const real = fakeIndexedDB();
  return {
    open(name, version) {
      const req = {};
      const inner = real.open(name, version);
      inner.onupgradeneeded = () => { req.result = inner.result; req.onupgradeneeded?.(); };
      inner.onsuccess = () => {
        const db = inner.result;
        bad.opens = (bad.opens ?? 0) + 1;
        req.result = {
          objectStoreNames: db.objectStoreNames, createObjectStore: (...a) => db.createObjectStore(...a),
          close: () => db.close(),
          transaction(n, mode) {
            if (!(bad.left > 0)) return db.transaction(n, mode);
            bad.left--;
            if (bad.closed) throw Object.assign(new Error("closing"), { name: "InvalidStateError" });
            const tx = { error: bad.error, objectStore: () => ({ put: () => ({}), get: () => ({}), getAll: () => ({}), delete: () => ({}) }) };
            setTimeout(() => tx.onabort?.(), 0);
            return tx;
          },
        };
        req.onsuccess?.();
      };
      return req;
    },
  };
}

const stores = [
  ["index cache", (indexedDB) => openIndexCache({ indexedDB }), (s) => s.put("k", "v"), (s) => s.get("k"), INDEX_CACHE_FAILED],
  ["source store", (indexedDB) => openSourceStore({ indexedDB, defaults: [] }), (s) => s.put({ key: "k" }), (s) => s.get("k"), SOURCE_STORE_FAILED],
  ["app store", (indexedDB) => openAppStore({ indexedDB }), (s) => s.put({ id: "k" }), (s) => s.all(), APP_STORE_FAILED],
  ["IPA store", (indexedDB) => openIpaStore({ indexedDB }), (s) => s.put("k", "v"), (s) => s.get("k"), IPA_STORE_FAILED],
];

for (const [what, open, write, read, failed] of stores) {
  test(`${what}: a transaction the browser ends is retried once on a fresh connection`, async () => {
    for (const closed of [false, true]) {
      const bad = { closed };
      const store = await open(endingIndexedDB(bad));
      const opens = bad.opens;
      bad.left = 1;
      await write(store);
      assert.equal(bad.opens, opens + 1);
      assert.ok(await read(store));
    }
  });

  test(`${what}: ended twice reads as a plain sentence`, async () => {
    const bad = {};
    const store = await open(endingIndexedDB(bad));
    bad.left = 2;
    await assert.rejects(write(store), { message: failed });
    await write(store);
  });
}

test("a real error is passed on, with no retry", async () => {
  const bad = {};
  const store = await openIndexCache({ indexedDB: endingIndexedDB(bad) });
  Object.assign(bad, { left: 1, error: Object.assign(new Error("full"), { name: "QuotaExceededError" }) });
  await assert.rejects(store.put("k", "v"), { name: "QuotaExceededError" });
  assert.equal(bad.opens, 1);
});

test("calls that find the connection ended all get through", async () => {
  const bad = {};
  const store = await openIndexCache({ indexedDB: endingIndexedDB(bad) });
  bad.left = 3;
  await Promise.all(["a", "b", "c"].map((k) => store.put(k, k)));
  assert.equal(bad.opens, 2, "one reopen shared");
});

// The AltStore list's store has no export of its own: it is reached through withAltSources.
test("AltStore list: retried once, then a plain sentence", async () => {
  const bad = {};
  const calls = withAltSources({ sources: async () => [] }, {}, { indexedDB: endingIndexedDB(bad) });
  assert.deepEqual(await calls.sources(), []);
  const opens = bad.opens;
  bad.left = 1;
  assert.deepEqual(await calls.sources(), []);
  assert.equal(bad.opens, opens + 1);
  bad.left = 2; // a list that can't be read counts as empty, so the sentence shows on a write
  await assert.rejects(calls.removeSource("alt:https://a.example/"), { message: ALT_STORE_FAILED });
});

test("Add IPA: a store ended twice shows the store's sentence as it is", async () => {
  const bad = {};
  const store = await openIpaStore({ indexedDB: endingIndexedDB(bad) });
  bad.left = 2;
  const file = { name: "a.ipa", size: 1 };
  const read = async () => ({ name: "A", bundleId: "com.a" });
  await assert.rejects(addSiteFile(file, { storage: memStorage(), store, read }), { message: IPA_STORE_FAILED });
});

// Signing's identity opens its database through globalThis.indexedDB, a connection for each transaction.
test("signing identity: retried once, then a plain sentence", async () => {
  const bad = {};
  globalThis.indexedDB = endingIndexedDB(bad);
  try {
    await saveIdentity({ p12Name: "a.p12" });
    bad.left = 1;
    assert.equal((await loadIdentity()).p12Name, "a.p12");
    bad.left = 1;
    await clearIdentity();
    assert.equal(await loadIdentity(), null);
    bad.left = 2;
    await assert.rejects(clearIdentity(), { message: IDENTITY_STORE_FAILED });
  } finally { delete globalThis.indexedDB; }
});
