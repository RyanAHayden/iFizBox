// B459: the jailbreak app's refreshSources reads each source after apt-get update a few at a time, each with a time
// limit, as the site does. A source apt couldn't fetch is read again over the network; one that never answers held
// the whole refresh (the reload bar stuck on Downloading Packages, Changes on the old lists with no Upgrade (N)).
// The fake native shell and helper (native/fake/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNativeBackend } from "./backend-native.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "./fakes.test-helper.js";
import { REFRESH_CONCURRENCY } from "./core/health.js";

const PKG = (id) => `Package: ${id}\nVersion: 1\nArchitecture: iphoneos-arm64\nFilename: a.deb\nSize: 1\n`;
const NAMES = Array.from({ length: 12 }, (_, i) => `r${i}`);

// dead.test: added while it answers; once `hang()` is called apt can't fetch it (FAKE_DEAD) and its network reads
// never answer. `slow`: ms each other net call takes.
function setup(t, { timeout = 200, concurrency, slow = 0 } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const net = {};
  let hanging = false;
  for (const n of [...NAMES, "dead"]) {
    writeFileSync(join(fx.remote, "lists", `${n}.test_._Packages`), PKG(`com.${n}.tweak`));
    net[`https://${n}.test/Packages`] = PKG(`com.${n}.tweak`);
    net[`https://${n}.test/Release`] = `Origin: ${n}\nArchitectures: iphoneos-arm64\n`;
  }
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net, env: { FAKE_DEAD: "https://dead.test/" } });
  let running = 0, most = 0;
  const wrapped = { ...native, call: async (method, params, onEvent) => {
    if (!/^net\./.test(method)) return native.call(method, params, onEvent);
    const url = String(params?.url ?? params?.dir ?? "");
    if (hanging && url.includes("dead.test")) return new Promise(() => {}); // never answers
    most = Math.max(most, ++running);
    try {
      if (slow) await new Promise((r) => setTimeout(r, slow));
      return await native.call(method, params, onEvent);
    } finally { running--; }
  } };
  const backend = createNativeBackend({ native: wrapped,
    sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak", timeout, ...(concurrency ? { concurrency } : {}) } });
  return { backend, most: () => most, hang: () => { hanging = true; } };
}

test("B459: a source that never answers no longer holds Refresh: it ends with that source Not Responding", async (t) => {
  const { backend, hang } = setup(t);
  for (const n of ["r0", "r1", "dead"]) await backend.addSource(`https://${n}.test/`);
  hang();
  const seen = [];
  const rows = await Promise.race([
    backend.refreshSources((s) => seen.push(s.key)),
    new Promise((_, no) => setTimeout(() => no(new Error("refreshSources still running after 5 s")), 5000)),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const n of ["r0", "r1"]) {
    const r = byKey.get(`deb:https://${n}.test/:./`);
    assert.equal(r?.error ?? null, null, `${n} refreshed`);
    assert.equal(r.count, 1);
  }
  const dead = rows.find((r) => String(r.uri).includes("dead.test"));
  assert.ok(dead?.error, "the dead source says why");
  assert.equal(seen.length, rows.length, "each source landed through onEach");
});

test("B459: at most REFRESH_CONCURRENCY sources are read at once", async (t) => {
  const { backend, most } = setup(t, { timeout: 5000, slow: 20 });
  for (const n of NAMES) await backend.addSource(`https://${n}.test/`);
  // apt's lists here hold Packages only: each source's Release is read over the (counted) network
  const rows = await backend.refreshSources();
  assert.equal(rows.length >= NAMES.length, true);
  assert.ok(most() <= REFRESH_CONCURRENCY, `${most()} at once`);
});
