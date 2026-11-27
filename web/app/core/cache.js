// IndexedDB cache for parsed repo indexes, so a cold start shows the last known packages without a fetch or a
// parse. One record per key (use the index file's URL), with the validators to revalidate it later:
// {key, value, etag, lastModified, savedAt}. The IDBFactory is passed in so node tests can hand it a fake.
// Also idbRunner, the transactions the other IndexedDB stores share (here, not a module of its own: startup's
// module count is capped, module-graph.test.js).
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

// Transactions on an IndexedDB connection the browser may end under us. An abort with no error means exactly that
// (the app went to the background, or another open asked for a version change), not a fault in the data: reopen,
// try once more, and if that fails too say `failed`, a plain sentence. Real errors are passed on as they are.
// `first`: the open IDBDatabase; `reopen`: () => Promise of another.
export function idbRunner(first, reopen, failed) {
  let db = null;
  let opening = null;
  let closed = false;
  const watch = (d) => {
    d.onclose = () => { if (db === d) db = null; };
    d.onversionchange = () => { if (db === d) db = null; d.close(); };
    return (db = d);
  };
  watch(first);
  // Calls that find the connection gone share one reopen. A reopen that lands after close() is closed at once.
  const connection = () => db ?? (opening ??= reopen().then((d) => { watch(d); if (closed) d.close(); return d; })
    .finally(() => { opening = null; }));
  const attempt = (d, store, mode, f) => new Promise((resolve, reject) => {
    let tx;
    // A closed connection refuses to start a transaction at all.
    try { tx = d.transaction(store, mode); } catch (e) { reject(e?.name === "InvalidStateError" ? { ended: true } : e); return; }
    const req = f(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? { ended: true });
  });
  return {
    // `f(objectStore)` returns the request whose result the promise gives. It may run twice.
    async run(store, mode, f) {
      for (let n = 0; ; n++) {
        const d = await connection();
        try {
          return await attempt(d, store, mode, f);
        } catch (e) {
          if (!e?.ended || closed) throw e?.ended ? new Error(failed) : e;
          if (db === d) db = null;
          try { d.close(); } catch {}
          if (n > 0) throw new Error(failed);
        }
      }
    },
    close() { closed = true; db?.close(); },
  };
}
