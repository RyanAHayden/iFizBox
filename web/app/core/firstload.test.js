// F43: sources seeded by default (F28) are bare URLs until read. A first visit to Sources refreshes the ones that
// never loaded, once, and leaves loaded ones (and APT sources) alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstLoadFilter, loadNeverLoaded, loadTweakSources } from "./sources.js";

const DEFAULT_SOURCES = await loadTweakSources(); // web/app/tweak-sources.json
import { seedRecord, neverLoaded } from "./altstore.js";

const seeded = seedRecord("https://example.com/apps.json");
const loaded = { ...seedRecord("https://example.org/apps.json"), name: "Org", count: 3, updated: 1 };
const failed = { ...seedRecord("https://example.net/apps.json"), updated: 1, error: "timeout" };
const apt = { ...DEFAULT_SOURCES[0] }; // no `updated` either, but APT

// A backend whose refreshSources records each call and which sources its filter kept.
function fakeBackend(list) {
  const calls = [];
  return {
    calls,
    async refreshSources(onEach, { filter } = {}) {
      const kept = list.filter(filter ?? (() => true));
      calls.push(kept.map((s) => s.key));
      return kept.map((s) => ({ ...s, updated: 2 }));
    },
  };
}

test("neverLoaded: a seed record yes; loaded or failed no", () => {
  assert.equal(neverLoaded(seeded), true);
  assert.equal(neverLoaded(loaded), false);
  assert.equal(neverLoaded(failed), false);
  assert.equal(neverLoaded(null), false);
});

test("firstLoadFilter keeps never-loaded AltStore sources only, and only what the device shows", () => {
  for (const type of ["none", "iphoneos-arm64", "iphoneos-arm"]) {
    const f = firstLoadFilter(type);
    assert.deepEqual([seeded, loaded, failed, apt].filter(f).map((s) => s.key), [seeded.key], type);
  }
});

test("a never-loaded seeded source triggers one refresh, of it alone, with the HUD", async () => {
  const list = [seeded, loaded, failed, apt];
  const b = fakeBackend(list);
  const tried = new Set();
  let huds = 0;
  let hidden = 0;
  const begin = () => { huds++; return () => hidden++; };
  const out = await loadNeverLoaded(b, list, "none", { tried, begin });
  assert.deepEqual(b.calls, [[seeded.key]]);
  assert.equal(out.length, 1);
  assert.deepEqual([huds, hidden], [1, 1]);
  // A second visit in the same session (even if the list still looked unloaded) asks nothing again.
  assert.equal(await loadNeverLoaded(b, list, "none", { tried, begin }), null);
  assert.equal(b.calls.length, 1);
  assert.equal(huds, 1);
});

test("a loaded source doesn't trigger a refresh, nor does an APT one", async () => {
  const list = [loaded, failed, apt];
  const b = fakeBackend(list);
  let huds = 0;
  assert.equal(await loadNeverLoaded(b, list, "iphoneos-arm64", { begin: () => { huds++; return () => {}; } }), null);
  assert.deepEqual(b.calls, []);
  assert.equal(huds, 0);
});

test("the HUD goes away when the refresh throws", async () => {
  const list = [seedRecord("https://x.example/a.json")];
  let hidden = 0;
  const b = { refreshSources: async () => { throw new Error("boom"); } };
  await assert.rejects(loadNeverLoaded(b, list, "none", { begin: () => () => hidden++ }), /boom/);
  assert.equal(hidden, 1);
});

// B446: in the jailbreak app (backend.addedSources) an APT source just added loads at once.
function addedBackend(list, added) {
  const calls = [];
  return {
    calls,
    addedSources: () => added,
    async refreshSources(onEach, { filter, retry } = {}) {
      calls.push({ keys: list.filter(filter).map((s) => s.key), retry: retry ?? false });
      return [];
    },
  };
}
const aptRec = (n) => ({ key: `deb:https://${n}.test/:./`, uri: `https://${n}.test/`, updated: 1, count: 3 });

test("B446: one added APT source loads alone (retry: update-source), several in one run; the others stay Refresh's", async () => {
  const [a, b, old] = ["a", "b", "old"].map(aptRec);
  const one = addedBackend([a, old, apt], [a.key]);
  await loadNeverLoaded(one, [a, old, apt], "iphoneos-arm64");
  assert.deepEqual(one.calls, [{ keys: [a.key], retry: true }]);
  const two = addedBackend([a, b, old], [a.key, b.key]);
  await loadNeverLoaded(two, [a, b, old], "iphoneos-arm64");
  assert.deepEqual(two.calls, [{ keys: [a.key, b.key], retry: false }]);
});

test("B446: an AltStore source beside it is loaded in the same run", async () => {
  const a = aptRec("a");
  const b = addedBackend([a, seeded], [a.key]);
  await loadNeverLoaded(b, [a, seeded], "iphoneos-arm64");
  assert.deepEqual(b.calls, [{ keys: [a.key, seeded.key], retry: true }]);
});

test("B446: added again after `tried`: loads again; a device that hides APT sources doesn't load it", async () => {
  const a = aptRec("a");
  const b = addedBackend([a], [a.key]);
  await loadNeverLoaded(b, [a], "iphoneos-arm64", { tried: new Set([a.key]) });
  assert.equal(b.calls.length, 1);
  assert.equal(await loadNeverLoaded(b, [a], "none"), null);
  assert.equal(b.calls.length, 1);
});

test("B446: the site and the sideload build (no addedSources): nothing for an APT source just added", async () => {
  const a = aptRec("a");
  const b = fakeBackend([a]);
  for (const type of ["none", "iphoneos-arm64"]) assert.equal(await loadNeverLoaded(b, [a], type), null);
  assert.deepEqual(b.calls, []);
});
