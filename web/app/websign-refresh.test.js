// F250: the website refreshes its sources by itself: Browse Anyway in the browse gate starts one at once, and every
// launch with browsing unlocked ("later") starts one. A locked Home, the app and the native shells never do.
// Both run Changes' Refresh job (screens/changes.js reloadSources).
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as memory } from "./fakes.test-helper.js";
import { askToBrowse, refreshOnLaunch, FIRST_KEY, firstVisitState } from "./websign-gate.js";
import { reloadSources } from "./screens/changes.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const counter = () => { const f = () => { f.n++; }; f.n = 0; return f; };

test("Browse Anyway unlocks browsing and starts one source refresh", async () => {
  const s = memory();
  const refresh = counter();
  const r = await askToBrowse({ alert: async () => ({ index: 1 }), storage: s, refresh });
  assert.equal(r, "browse");
  assert.equal(firstVisitState(s), "later");
  await tick();
  assert.equal(refresh.n, 1);
});

test("Install or Cancel in the browse gate doesn't refresh", async () => {
  for (const index of [0, 2]) {
    const refresh = counter();
    await askToBrowse({ alert: async () => ({ index }), storage: memory(), install: async () => {}, refresh });
    await tick();
    assert.equal(refresh.n, 0, `button ${index}`);
  }
});

test("launch: refreshes on the website once browsing is unlocked", async () => {
  const refresh = counter();
  assert.equal(refreshOnLaunch({ mode: "site", storage: memory({ [FIRST_KEY]: "later" }), win: {}, refresh }), true);
  await tick();
  assert.equal(refresh.n, 1);
});

test("launch: no refresh while Home is locked", async () => {
  for (const state of [undefined, "installed"]) {
    const refresh = counter();
    const storage = memory(state ? { [FIRST_KEY]: state } : {});
    assert.equal(refreshOnLaunch({ mode: "site", storage, win: {}, refresh }), false);
    await tick();
    assert.equal(refresh.n, 0);
  }
});

test("launch: no refresh in the native app or its shells", async () => {
  const later = () => memory({ [FIRST_KEY]: "later" });
  const cases = [
    { mode: "jailbreak", win: {} },
    { mode: "sideload", win: {} },
    { mode: "site", win: { ifizboxNative: {} } },
    { mode: "site", win: { ifizboxApp: {} } },
  ];
  for (const c of cases) {
    const refresh = counter();
    assert.equal(refreshOnLaunch({ ...c, storage: later(), refresh }), false, JSON.stringify(c));
    await tick();
    assert.equal(refresh.n, 0);
  }
});

test("reloadSources: Changes' Refresh job, one at a time, HUD shown and hidden", async () => {
  const calls = [];
  let release;
  const backend = () => ({ refreshSources: (onEach, opts) => { calls.push(opts); return new Promise((r) => { release = r; }); } });
  let shown = 0, hidden = 0, reloaded = 0;
  const hud = (label) => { assert.equal(label, "Reloading Data"); shown++; return () => { hidden++; }; };
  const first = reloadSources({ hud, backend, reload: async () => { reloaded++; } });
  assert.equal(await reloadSources({ hud, backend, reload: async () => { reloaded++; } }), false); // busy
  release();
  assert.equal(await first, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0] && "filter" in calls[0]);
  assert.equal(shown, 1);
  assert.ok(hidden >= 1);
  assert.equal(reloaded, 1);
});

test("reloadSources: an error, or a source that failed, goes to the reload bar and frees the job", async () => {
  const bad = [];
  const failed = (f) => bad.push(...f);
  const backend = () => ({ refreshSources: async () => { throw new Error("offline"); } });
  await reloadSources({ hud: () => () => {}, backend, failed, reload: async () => {} });
  assert.equal(bad[0]?.detail, "offline");
  bad.length = 0;
  await reloadSources({ hud: () => () => {}, failed, reload: async () => {},
    backend: () => ({ refreshSources: async () => [{ key: "a", name: "Repo A", error: "HTTP 404" }, { key: "b", name: "Repo B", error: null }] }) });
  assert.deepEqual(bad, [{ title: "Repo A", detail: "HTTP 404" }]);
  let ran = 0;
  assert.equal(await reloadSources({ hud: () => () => {}, backend: () => ({ refreshSources: async () => { ran++; } }), reload: async () => {} }), true);
  assert.equal(ran, 1);
});
