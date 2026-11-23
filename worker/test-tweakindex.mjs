// F344: the tweak index (src/tweakindex.js, GET /api/tweaks and the cron) against Node's SQLite with D1's API
// (src/d1-sqlite.js) and a fake source serving the fixture .debs (web/app/core/fixtures/tweaks/index-debs.test-helper.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { tweakIndex, tweakIndexFile, indexPass, scheduled, isTweakIndexPath, forBundle, DEB_MAX } from "./src/tweakindex.js";
import { d1 } from "./src/d1-sqlite.js";
import { indexSource, indexQuery } from "../web/app/core/tweakindex.js";
import { parseIndexFile, answerFromFile } from "../web/app/core/tweakindexfile.js";
import w from "./src/index.js";
import { DEBS, PACKAGES } from "../web/app/core/fixtures/tweaks/index-debs.test-helper.js";

const ROOT = "https://repo.example/";
const asked = [];
let packages = PACKAGES;
const files = () => ({ "Packages.gz": gzipSync(packages), ...DEBS, "debs/big_1.deb": new Uint8Array(DEB_MAX + 1) });
const fetcher = async (url) => {
  asked.push(url);
  const f = files()[url.slice(ROOT.length)];
  if (!url.startsWith(ROOT) || !f) return new Response("no", { status: 404 });
  return new Response(f, { headers: { "Content-Length": String(f.length) } });
};
const ctx = () => { const jobs = []; return { jobs, waitUntil: (p) => jobs.push(p) }; };
const src = indexSource({ uri: ROOT, dist: "./" });
const call = (q, env, c = null) => tweakIndex(new Request(`https://ifizbox.example/api/tweaks?${q}`), env, c, { fetcher });

assert.ok(isTweakIndexPath("/api/tweaks"));
assert.ok(!isTweakIndexPath("/api/tweaks/x"));

// no D1: the app checks on the phone
let r = await call(indexQuery(src), {});
assert.equal(r.status, 200);
assert.equal((await r.json()).enabled, false);
// bad and private sources
assert.equal((await call("source=ftp://x/", {})).status, 400);
assert.equal((await call(indexQuery({ uri: "http://127.0.0.1/", dist: "./" }), { TWEAKS: d1() })).status, 403);
assert.equal((await call(indexQuery({ uri: "http://localhost/", dist: "./" }), { TWEAKS: d1() })).status, 403);

// a new source: added, answered at once (nothing checked yet), a first pass runs after the answer
const env = { TWEAKS: d1(), TWEAK_INDEX_ON_DEMAND: "2" };
const c = ctx();
r = await call(indexQuery(src), env, c);
let j = await r.json();
assert.equal(j.enabled, true);
assert.equal(j.source, src.key);
assert.equal(r.headers.get("Cache-Control"), "no-store", "a first answer isn't cached: the pass fills it");
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
assert.equal(c.jobs.length, 1);
await Promise.all(c.jobs);
assert.ok(asked.includes(`${ROOT}Packages.gz`));
assert.equal(asked.filter((u) => u.endsWith(".deb")).length, 2, "ON_DEMAND .debs only");

// the rest, then every entry is there; the paid one was never downloaded
let pass = await indexPass(env, src, { budget: 10, fetcher });
assert.equal(pass.pending, 0);
assert.ok(!asked.some((u) => u.includes("instapro")), "paid .debs aren't downloaded");
assert.ok(!asked.some((u) => u.includes("ytplus_0.9")), "only the newest version");
assert.ok(!asked.some((u) => u.includes("theme")), "the Packages fields already refuse it");
r = await call(indexQuery(src), env);
assert.equal(r.headers.get("Cache-Control"), "public, max-age=300", "all read: cached a while");
j = await r.json();
const by = Object.fromEntries(j.tweaks.map((t) => [t.package, t]));
assert.deepEqual(Object.keys(by).sort(), ["com.x.anyfont", "com.x.instapro", "com.x.sbcolor", "com.x.ytplus"]);
assert.deepEqual(by["com.x.ytplus"].bundles, ["com.google.ios.youtube"]);
assert.equal(by["com.x.ytplus"].version, "1.0");
assert.equal(by["com.x.sbcolor"].systemOnly, true);
assert.equal(by["com.x.sbcolor"].ok, false);
assert.equal(by["com.x.anyfont"].anyApp, true);
assert.equal(by["com.x.instapro"].unverified, true);
assert.deepEqual(by["com.x.instapro"].bundles, ["com.burbn.instagram"]);

// bundle=: that app's tweaks and the every-app ones; never SpringBoard
const forApp = async (bundle) => (await (await call(indexQuery(src, { bundle }), env)).json()).tweaks.map((t) => t.package).sort();
assert.deepEqual(await forApp("com.google.ios.youtube"), ["com.x.anyfont", "com.x.ytplus"]);
assert.deepEqual(await forApp("com.burbn.instagram"), ["com.x.anyfont", "com.x.instapro"]);
assert.equal(forBundle({ ok: true, anyApp: true, unverified: true, bundles: [] }, "x"), false);

// a new version: checked once more; the old one dropped. A .deb over DEB_MAX is left to the phone.
packages = PACKAGES.replace("Version: 1.0", "Version: 1.1").replace("ytplus_1.0.deb", "ytplus_0.9.deb")
  + "\nPackage: com.x.big\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nFilename: debs/big_1.deb\n";
asked.length = 0;
pass = await indexPass(env, src, { budget: 10, fetcher, force: true });
assert.equal(pass.refreshed, true);
assert.equal(pass.pending, 0, "the big one isn't tried again");
assert.ok(asked.includes(`${ROOT}debs/ytplus_0.9.deb`));
j = await (await call(indexQuery(src), env)).json();
assert.deepEqual(j.tweaks.filter((t) => t.package === "com.x.ytplus").map((t) => t.version), ["1.1"]);
assert.ok(!j.tweaks.some((t) => t.package === "com.x.big"));

// the cron: seeds the bundled inject sources from ASSETS and works within its budget
const seen = [];
const cronEnv = { TWEAKS: d1(), TWEAK_INDEX_PER_RUN: "5",
  ASSETS: { fetch: async () => Response.json([{ name: "R", uri: ROOT, dist: "./", components: [], inject: true }, { name: "No", uri: "https://other.example/", dist: "./" }]) } };
packages = PACKAGES;
const cron = await scheduled({}, cronEnv, null, { fetcher: async (u) => { seen.push(u); return fetcher(u); } });
assert.equal(cron.sources, 1);
assert.ok(seen.every((u) => u.startsWith(ROOT)), "only the inject source");
assert.ok(seen.length <= 5, `every fetch counts, Packages too (${seen.length})`);
assert.equal(seen.filter((u) => u.endsWith(".deb")).length, 3, "the 3 free .debs, Packages.gz the 4th fetch");
const small = await scheduled({}, { ...cronEnv, TWEAKS: d1(), TWEAK_INDEX_PER_RUN: "2" }, null, { fetcher });
assert.equal(small.sources, 0, "too little left for a source's Packages");
assert.deepEqual(await scheduled({}, {}, null), { enabled: false });

// through the Worker's own handler
r = await w.fetch(new Request(`https://ifizbox.example/api/tweaks?${indexQuery(src)}`), { TWEAKS: env.TWEAKS }, ctx());
assert.equal(r.status, 200);
assert.equal((await r.json()).enabled, true);

// F398: GET /api/tweaks.json: the whole index as one file, made from D1 and cached; the deployed copy otherwise
{
  const get = (e, cache = null, c = null) => tweakIndexFile(new Request("https://ifizbox.example/api/tweaks.json?x=1"), e, c, { cache });
  const fileEnv = { TWEAKS: d1() };
  packages = PACKAGES;
  const other = indexSource({ uri: "https://repo.example/", dist: "./" }, "iphoneos-arm"); // the same packages in a second source
  await indexPass(fileEnv, src, { budget: 10, fetcher });
  await indexPass(fileEnv, other, { budget: 0, fetcher });
  const store = new Map();
  let puts = 0;
  const cache = { match: async (q) => store.get(q.url)?.clone(), put: async (q, v) => { puts++; store.set(q.url, v); } };
  let f = await get(fileEnv, cache);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(f.headers.get("Cache-Control"), /max-age=1800/);
  const text = await f.text();
  assert.ok(!text.includes("repo.example"), "no source's address is in it");
  const file = parseIndexFile(text);
  const answer = answerFromFile(file, { uri: ROOT, dist: "./" });
  assert.equal(answer.pending, 0);
  assert.deepEqual(answer.tweaks.filter((t) => t.package).map((t) => `${t.package}@${t.version}`).sort(), ["com.x.anyfont@1.1", "com.x.sbcolor@2.0", "com.x.ytplus@1.0"], "free tweaks only");
  assert.deepEqual(answer.tweaks.filter((t) => !t.package).map((t) => [t.unverified, t.bundles]), [[true, ["com.burbn.instagram"]]], "the paid ones' guessed apps");
  assert.equal(answerFromFile(file, { uri: ROOT, dist: "./", arch: "iphoneos-arm" }).pending, 1, "the second source, still being read");
  await (await get(fileEnv, cache)).text();
  assert.equal(puts, 1, "from the cache the second time");
  // no D1, an empty one or a failing one: the deployed copy; none: 404
  const copy = { fetch: async (q) => (new URL(q.url).pathname === "/tweak-index.json" ? new Response(text) : new Response("<html>")) };
  for (const e of [{ ASSETS: copy }, { ASSETS: copy, TWEAKS: d1() }, { ASSETS: copy, TWEAKS: { batch: async () => { throw new Error("down"); }, prepare: () => ({}) } }]) {
    f = await get(e, { match: async () => null, put: async () => { throw new Error("cached"); } });
    assert.equal(await f.text(), text);
  }
  assert.equal((await get({ ASSETS: { fetch: async () => new Response("<!doctype html>") } })).status, 404);
  // through the Worker's own handler
  assert.equal((await w.fetch(new Request("https://ifizbox.example/api/tweaks.json"), { ASSETS: copy }, ctx())).status, 200);
}

console.log("worker tweak index: ok");
