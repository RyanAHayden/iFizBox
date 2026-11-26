// B464: the jailbreak app's "iFizBox X is out." banner reads GitHub's release, but its Upgrade queues apt's iFizBox
// row and Changes' Upgrade (N) counts apt's rows. It shows only once the catalog has that apt row (at X or newer),
// and otherwise waits for the next catalog load and looks again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "./fakes.test-helper.js";
import { saveState } from "./core/selfupdate.js";
import { SELF_ID } from "./core/essential.js";
import { NAME } from "./brand.js";
import { aptHasSelf, bannerOnce, bannerSeen } from "./essential-ui.js";

const store = memStorage();
Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });

function setup(latest) {
  store.clear();
  saveState(store, { latest: { version: latest } });
  bannerSeen.version = null;
  const shown = [];
  const listeners = new Set();
  const deps = {
    current: async () => "1.0.0",
    banner: (b) => shown.push(b.message),
    onLoaded: (f) => { listeners.add(f); return () => listeners.delete(f); },
  };
  const load = () => { for (const f of [...listeners]) f(); };
  return { shown, listeners, deps, load };
}
const upgrades = (version, id = SELF_ID) => async () => ({ available: [{ id, version, installed: "1.0.0" }], ignored: [] });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("B464: aptHasSelf: apt's iFizBox row at the release or newer, not older, not another package, not none", async () => {
  assert.equal(await aptHasSelf("1.0.1", { upgrades: upgrades("1.0.1") }), true);
  assert.equal(await aptHasSelf("1.0.1", { upgrades: upgrades("1.0.2") }), true);
  assert.equal(await aptHasSelf("1.0.2", { upgrades: upgrades("1.0.1") }), false);
  assert.equal(await aptHasSelf("1.0.1", { upgrades: upgrades("1.0.1", "com.other.pkg") }), false);
  assert.equal(await aptHasSelf("1.0.1", { upgrades: async () => ({ available: [], ignored: [] }) }), false);
  assert.equal(await aptHasSelf("1.0.1", { upgrades: async () => { throw new Error("no catalog"); } }), false);
});

test("B464: jailbreak, apt's lists without the release: no banner; after a load with the row, it shows once", async () => {
  const { shown, listeners, deps, load } = setup("1.0.1");
  let has = false;
  const aptHas = async () => has;
  assert.equal(await bannerOnce("jailbreak", { ...deps, aptHas }), false);
  assert.deepEqual(shown, []);
  assert.equal(listeners.size, 1);
  assert.equal(await bannerOnce("jailbreak", { ...deps, aptHas }), false);
  assert.equal(listeners.size, 1, "one wait at a time");

  load(); // a refresh that still has no row: waits again
  await tick();
  assert.deepEqual(shown, []);
  assert.equal(listeners.size, 1);

  has = true;
  load();
  await tick();
  assert.deepEqual(shown, [`${NAME} 1.0.1 is out.`]);
  assert.equal(listeners.size, 0);
  assert.equal(await bannerOnce("jailbreak", { ...deps, aptHas }), false, "once per version per session");
  assert.deepEqual(shown, [`${NAME} 1.0.1 is out.`]);
});

test("B464: jailbreak with apt's row there: the banner shows at once", async () => {
  const { shown, listeners, deps } = setup("1.0.1");
  assert.equal(await bannerOnce("jailbreak", { ...deps, aptHas: (v) => aptHasSelf(v, { upgrades: upgrades("1.0.1") }) }), true);
  assert.deepEqual(shown, [`${NAME} 1.0.1 is out.`]);
  assert.equal(listeners.size, 0);
});

test("B464: no newer release: apt's catalog isn't asked", async () => {
  const { shown, deps } = setup("1.0.0");
  let asked = 0;
  assert.equal(await bannerOnce("jailbreak", { ...deps, aptHas: async () => { asked++; return true; } }), false);
  assert.equal(asked, 0);
  assert.deepEqual(shown, []);
});
