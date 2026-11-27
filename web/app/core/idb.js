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
  // Calls that find the connection gone share one reopen.
  const connection = () => db ?? (opening ??= reopen().then(watch).finally(() => { opening = null; }));
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
