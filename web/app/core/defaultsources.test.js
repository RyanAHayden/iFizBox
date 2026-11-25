// F267: the default sources are two data files the site serves (web/app/tweak-sources.json, web/app/app-sources.json).
// Seeding asks the site's copy first (short timeout) and falls back to the bundled copy, each file on its own; a
// store is seeded once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOMAIN } from "../brand.js";
import {
  loadTweakSources, loadAppSources, tweakSourcesFrom, appSourcesFrom, readBundled, openSourceStore, sourceKey,
  TWEAK_SOURCES_FILE, APP_SOURCES_FILE,
} from "./sources.js";
import { withAltSources } from "./altstore.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";

const raw = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));


test("the data files: APT repos with name/uri/dist/components; app sources with the own one first, relative", () => {
  const tweaks = raw(TWEAK_SOURCES_FILE);
  assert.ok(tweaks.length > 0);
  for (const s of tweaks) {
    // F344a: a GitHub repo whose releases carry the tweak, for the sideload build only
    if ("github" in s) {
      assert.deepEqual(Object.keys(s).sort(), ["github", "inject", "name"]);
      assert.equal(s.inject, true);
      assert.match(s.github, /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
      continue;
    }
    // F302: "inject": true marks a Tweak Source the sideload build starts with
    assert.deepEqual(Object.keys(s).filter((k) => k !== "inject").sort(), ["components", "dist", "name", "uri"]);
    if ("inject" in s) assert.equal(s.inject, true);
    assert.match(s.uri, /^https?:\/\/.+\/$/);
    assert.ok(Array.isArray(s.components));
  }
  const apps = raw(APP_SOURCES_FILE);
  // Never the spelled domain: the own source is relative and read against brand.js DOMAIN.
  assert.equal(apps[0], "/repo/source.json");
  assert.ok(!JSON.stringify(apps).includes(DOMAIN));
  assert.ok(apps.slice(1).every((u) => /^https:\/\//.test(u)));
});

test("loaded lists: keys added, own source filled from DOMAIN, deduped", async () => {
  const tweaks = await loadTweakSources();
  assert.deepEqual(tweaks.map((s) => s.key), raw(TWEAK_SOURCES_FILE).filter((s) => !s.github).map(sourceKey));
  const apps = await loadAppSources();
  assert.equal(apps[0], `https://${DOMAIN}/repo/source.json`);
  assert.equal(new Set(apps).size, apps.length);
  assert.deepEqual(appSourcesFrom(["/a.json", "https://X.example/b", "https://x.example/b", "ftp://c/", 7, "http://[bad"]),
    [`https://${DOMAIN}/a.json`, "https://x.example/b"]);
  assert.deepEqual(tweakSourcesFrom([{ uri: "https://r.example/" }, { uri: "https://r.example/", dist: "./" }, { uri: "file:///x/" }, null]),
    [{ uri: "https://r.example/", dist: "./", components: [], key: "deb:https://r.example/:./" }]);
  assert.deepEqual(tweakSourcesFrom({ not: "a list" }), []);
});

test("a remote list wins: the site's copy at https://<DOMAIN>/<file>", async () => {
  const asked = [];
  const remote = async (url) => {
    asked.push(url);
    return url.endsWith(TWEAK_SOURCES_FILE)
      ? JSON.stringify([{ name: "Only", uri: "https://only.example/", dist: "./", components: [] }])
      : JSON.stringify(["/repo/source.json", "https://new.example/apps.json"]);
  };
  const tweaks = await loadTweakSources({ remote });
  assert.deepEqual(tweaks.map((s) => s.name), ["Only"]);
  const apps = await loadAppSources({ remote });
  assert.deepEqual(apps, [`https://${DOMAIN}/repo/source.json`, "https://new.example/apps.json"]);
  assert.deepEqual(asked, [`https://${DOMAIN}/${TWEAK_SOURCES_FILE}`, `https://${DOMAIN}/${APP_SOURCES_FILE}`]);
});

test("a fetch failure, a bad body, an empty list or a slow answer fall back to the bundled list", async () => {
  const bundledTweaks = await loadTweakSources();
  const bundledApps = await loadAppSources();
  const offline = async () => { const e = new Error("offline"); e.code = "network"; throw e; };
  assert.deepEqual(await loadTweakSources({ remote: offline }), bundledTweaks);
  assert.deepEqual(await loadAppSources({ remote: offline }), bundledApps);
  assert.deepEqual(await loadTweakSources({ remote: () => { throw new Error("sync throw"); } }), bundledTweaks);
  assert.deepEqual(await loadTweakSources({ remote: async () => "<html>not json" }), bundledTweaks);
  assert.deepEqual(await loadAppSources({ remote: async () => "[]" }), bundledApps);
  const never = () => new Promise(() => {});
  const t0 = Date.now();
  assert.deepEqual(await loadAppSources({ remote: never, timeout: 30 }), bundledApps);
  assert.ok(Date.now() - t0 < 2000);
  // Each file on its own: the site answering one doesn't decide the other.
  const half = async (url) => {
    if (url.endsWith(APP_SOURCES_FILE)) throw new Error("404");
    return JSON.stringify([{ name: "Site", uri: "https://site.example/", dist: "./", components: [] }]);
  };
  assert.deepEqual((await loadTweakSources({ remote: half })).map((s) => s.name), ["Site"]);
  assert.deepEqual(await loadAppSources({ remote: half }), bundledApps);
  // No bundled copy either: nothing.
  assert.deepEqual(await loadTweakSources({ remote: offline, bundled: offline }), []);
});

test("the bundled copy is web/app/<file> (read from disk under node)", async () => {
  assert.deepEqual(JSON.parse(await readBundled(APP_SOURCES_FILE)), raw(APP_SOURCES_FILE));
});

test("APT store: seeded once from the defaults function; nothing given means it tries again next open", async () => {
  const idb = fakeIndexedDB();
  let calls = 0;
  let list = [];
  const defaults = async () => { calls++; return list; };
  let st = await openSourceStore({ indexedDB: idb, defaults });
  assert.deepEqual(await st.list(), []);
  list = tweakSourcesFrom([{ name: "Site", uri: "https://site.example/", dist: "./", components: [] }]);
  st = await openSourceStore({ indexedDB: idb, defaults });
  assert.deepEqual((await st.list()).map((s) => s.name), ["Site"]);
  // Existing users are not re-seeded, even when the site's list changes.
  list = tweakSourcesFrom([{ name: "Later", uri: "https://later.example/", dist: "./", components: [] }]);
  st = await openSourceStore({ indexedDB: idb, defaults });
  assert.deepEqual((await st.list()).map((s) => s.name), ["Site"]);
  assert.equal(calls, 2);
});

test("AltStore store: altDefaults as a function is asked once, on the first open", async () => {
  const idb = fakeIndexedDB();
  let calls = 0;
  const altDefaults = async () => { calls++; return ["https://a.example/apps.json"]; };
  const apt = { sources: async () => [], refreshSources: async () => [] };
  const one = withAltSources(apt, {}, { indexedDB: idb, altDefaults });
  assert.deepEqual((await one.sources()).map((s) => s.uri), ["https://a.example/apps.json"]);
  await one.removeSource((await one.sources())[0].key);
  const two = withAltSources(apt, {}, { indexedDB: idb, altDefaults });
  assert.deepEqual(await two.sources(), []);
  assert.equal(calls, 1);
});

test("F423: the default tweak sources leave out YTLite and SCInsta, and keep YTMusicUltimate", async () => {
  const { readFile } = await import("node:fs/promises");
  const list = JSON.parse(await readFile(new URL("../tweak-sources.json", import.meta.url), "utf8"));
  const names = list.map((s) => s.name);
  assert.ok(!names.includes("YTLite") && !names.includes("SCInsta"));
  assert.ok(names.includes("YTMusicUltimate"));
});
