// IndexedDB cache for parsed repo indexes, so a cold start shows the last known packages without a fetch or a
// parse. One record per key (use the index file's URL), with the validators to revalidate it later:
// {key, value, etag, lastModified, savedAt}. The IDBFactory is passed in so node tests can hand it a fake.
import { idbRunner } from "./idb.js";

const STORE = "indexes";
export const INDEX_CACHE_FAILED = "Could not use the saved package list. Try refreshing again.";

export function openIndexCache({ indexedDB: idb = globalThis.indexedDB, name = "ifizbox-index" } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  const connect = () => new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  return connect().then((db) => wrap(idbRunner(db, connect, INDEX_CACHE_FAILED)));
}

function wrap(db) {
  const run = (mode, f) => db.run(STORE, mode, f);
  return {
    // The whole record, or undefined.
    get: (key) => run("readonly", (s) => s.get(key)),
    put: (key, value, { etag = null, lastModified = null } = {}) =>
      run("readwrite", (s) => s.put({ key, value, etag, lastModified, savedAt: Date.now() })).then(() => undefined),
    delete: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
    keys: () => run("readonly", (s) => s.getAllKeys()),
    clear: () => run("readwrite", (s) => s.clear()).then(() => undefined),
    close: () => db.close(),
  };
}
