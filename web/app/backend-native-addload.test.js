// B446: the jailbreak app remembers the APT sources just added (backend.addedSources) until an apt-get update that
// covers them starts, so loadNeverLoaded can load them at once and a package from one installs with no Refresh. The
// fake native shell and helper (native/fake/), whose simulate refuses a package apt has no list for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNativeBackend } from "./backend-native.js";
import { loadNeverLoaded } from "./core/sources.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "./fakes.test-helper.js";

const PKG = (id) => `Package: ${id}\nVersion: 1\nArchitecture: iphoneos-arm64\nFilename: a.deb\nSize: 1\n`;
const NET = {};
for (const n of ["one", "two"]) {
  NET[`https://${n}.test/Packages`] = PKG(`com.${n}.tweak`);
  NET[`https://${n}.test/Release`] = `Origin: ${n}\nArchitectures: iphoneos-arm64\n`;
}

function setup(t, { mode = "jailbreak", env = {}, wrap = (n) => n } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  for (const n of ["one", "two"]) writeFileSync(join(fx.remote, "lists", `${n}.test_._Packages`), PKG(`com.${n}.tweak`));
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: NET, env });
  const backend = createNativeBackend({ native: wrap(native), sourceOptions: { indexedDB: fakeIndexedDB(), mode } });
  const updates = () => native.calls.filter((c) => c.method === "helper.run").map((c) => c.params.words)
    .filter((w) => /^update/.test(w[0]));
  const load = async () => loadNeverLoaded(backend, await backend.sources(), "iphoneos-arm64");
  return { fx, native, backend, updates, load };
}
const job = (id) => [{ op: "install", id, version: null, name: id }];

test("B446: one added source: update-source once for it, and its package can then be installed", async (t) => {
  const { backend, updates, load } = setup(t);
  await backend.addSource("https://one.test/");
  assert.deepEqual(backend.addedSources(), ["deb:https://one.test/:./"]);
  assert.match((await backend.simulate(job("com.one.tweak"))).issues[0], /apt doesn't know/, "before: the bug");
  await load();
  assert.deepEqual(updates(), [["update-source", "https://one.test/", "./"]]);
  assert.equal((await backend.simulate(job("com.one.tweak"))).ok, true);
  assert.deepEqual(backend.addedSources(), []);
  assert.equal(await load(), null, "once");
});

test("B446: several added: one update for all", async (t) => {
  const { backend, updates, load } = setup(t);
  await backend.addSource("https://one.test/");
  await backend.addSource("https://two.test/");
  await load();
  assert.deepEqual(updates(), [["update"]]);
  assert.deepEqual(backend.addedSources(), []);
});

test("B446: nothing added: never-loaded APT sources stay Refresh's; a Refresh covers what was added before it", async (t) => {
  const { backend, updates, load } = setup(t);
  assert.equal(await load(), null);
  await backend.addSource("https://one.test/");
  await backend.refreshSources();
  assert.deepEqual(updates(), [["update"]]);
  assert.equal(await load(), null);
});

test("B446: a failed load is not asked again and again; a removed source is forgotten", async (t) => {
  const { backend, updates, load } = setup(t, { env: { FAKE_FAIL: "update-source" } });
  await backend.addSource("https://one.test/");
  await assert.rejects(load(), /apt-get update failed/);
  assert.equal(await load(), null);
  assert.equal(updates().length, 1);
  await backend.addSource("https://two.test/");
  await backend.removeSource("deb:https://two.test/:./");
  assert.deepEqual(backend.addedSources(), []);
});

test("B446: an add during a refresh stays for after it, and its update waits for the running one (apt's lock)", async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let running = 0, most = 0;
  const wrap = (n) => ({ ...n, call: async (method, params, onEvent) => {
    if (method !== "helper.run" || !/^update/.test(params.words[0])) return n.call(method, params, onEvent);
    most = Math.max(most, ++running);
    try {
      if (params.words[0] === "update") await gate;
      return await n.call(method, params, onEvent);
    } finally { running--; }
  } });
  const { backend, updates, load } = setup(t, { wrap });
  const refresh = backend.refreshSources();
  for (let i = 0; i < 500 && !running; i++) await new Promise((r) => setTimeout(r, 2));
  assert.equal(running, 1);
  await backend.addSource("https://one.test/");
  const after = load();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(backend.addedSources(), ["deb:https://one.test/:./"], "the running update doesn't count for it");
  release();
  await Promise.all([refresh, after]);
  assert.equal(most, 1, "never two at once");
  assert.deepEqual(updates(), [["update"], ["update-source", "https://one.test/", "./"]]);
});

test("B446: the sideload build has no addedSources", (t) => {
  assert.equal(setup(t, { mode: "sideload" }).backend.addedSources, undefined);
});
