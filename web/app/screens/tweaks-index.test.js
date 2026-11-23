// F344: the app side of the shared tweak index (screens/tweaks.js): verdicts read from GET /api/tweaks join the
// device's checks, Add Tweaks for an app lists only that app's tweaks then every-app ones with "Works in", paid
// tweaks only from a source that names a seller, and the phone checks the unchecked ones (the app's name first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTweakIndex, cachedTweakInfo, rowInfo, appTweakRows, checkForApp, madeForRows, sellerKeys,
  tweakInfo, checkTweakRows } from "./tweaks.js";
import { memoryIpaStore } from "../core/myipas.js";
import { DEBS } from "../core/fixtures/tweaks/index-debs.test-helper.js";
import { fakeDocument, tick, withDocument } from "../fakes.test-helper.js";

const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const memStore = () => { const mem = memoryIpaStore(); return async () => mem; };
const doc = Object.assign(fakeDocument(), { head: { append() {} } });
const withDoc = (f) => withDocument(f, doc);

const SRC = { key: "repo-a", uri: "https://index-test.example/", dist: "./", components: [] };
const entries = [
  { package: "com.i.yt", version: "1.0", ok: true, bundles: ["com.google.ios.youtube"], anyApp: false },
  { package: "com.i.sb", version: "2.0", ok: false, why: "It's for iOS itself", bundles: [], anyApp: false, systemOnly: true },
  { package: "com.i.any", version: "1.1", ok: true, bundles: [], anyApp: true },
  { package: "com.i.ig", version: "3.0", ok: true, bundles: ["com.burbn.instagram"], paid: true, unverified: true },
];
const rows = [
  { id: "com.i.sb", name: "SBColor", version: "2.0", key: "repo-a" },
  { id: "com.i.any", name: "AnyFont", version: "1.1", key: "repo-a" },
  { id: "com.i.yt", name: "YTPlus", version: "1.0", key: "repo-a" },
  { id: "com.i.ig", name: "InstaPro", version: "3.0", key: "repo-a", paid: true, short: "for Instagram" },
  { id: "com.i.new", name: "New", version: "1", key: "repo-a" },
];

test("loadTweakIndex reads each source's verdicts once; cachedTweakInfo and tweakInfo use them", async () => {
  const asked = [];
  const fetch = async (u) => { asked.push(u); return { ok: true, json: async () => ({ enabled: true, tweaks: entries }) }; };
  assert.equal(await loadTweakIndex([SRC], { fetch, base: "https://ifizbox.example/api/tweaks" }), 4);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /^https:\/\/ifizbox\.example\/api\/tweaks\?source=https%3A%2F%2Findex-test\.example%2F&dist=\.%2F$/);
  await loadTweakIndex([SRC], { fetch, base: "https://ifizbox.example/api/tweaks" });
  assert.equal(asked.length, 1, "kept for the session");
  const s = storage();
  assert.deepEqual(cachedTweakInfo({ package: "com.i.yt", version: "1.0" }, { storage: s }).bundles, ["com.google.ios.youtube"]);
  assert.equal(cachedTweakInfo({ package: "com.i.yt", version: "0.9" }, { storage: s }), null, "another version isn't known");
  // the index refused it: no download
  const info = await tweakInfo({ package: "com.i.sb", version: "2.0", debUrl: "https://x/sb.deb" }, { storage: s,
    fetchDeb: async () => { throw new Error("downloaded"); } });
  assert.equal(info.ok, false);
  // a source the index doesn't know (or no index): nothing, asked again next time
  const off = async () => ({ ok: true, json: async () => ({ enabled: false, tweaks: [] }) });
  assert.equal(await loadTweakIndex([{ key: "b", uri: "https://other-index.example/", dist: "./" }], { fetch: off, base: "https://x/api/tweaks" }), 0);
  assert.equal(await loadTweakIndex([{ key: "c", uri: "https://down-index.example/", dist: "./" }], { fetch: async () => { throw new Error("offline"); }, base: "https://x/api/tweaks" }), 0);
});

test("Add Tweaks for an app: its tweaks, then every-app ones; no SpringBoard, no paid guess without a seller", async () => {
  const s = storage();
  const noSeller = await appTweakRows("com.burbn.instagram", { rows: async () => rows, storage: s });
  assert.deepEqual(noSeller.made.map((r) => r.id), []);
  assert.deepEqual(noSeller.any.map((r) => r.id), ["com.i.any"]);
  const sold = await appTweakRows("com.burbn.instagram", { rows: async () => rows, storage: s, sellers: async () => new Set(["repo-a"]) });
  assert.deepEqual(sold.made.map((r) => r.id), ["com.i.ig"]);
  const yt = await appTweakRows("com.google.ios.youtube", { rows: async () => rows, storage: s });
  assert.deepEqual(yt.made.map((r) => r.id), ["com.i.yt"]);
  assert.deepEqual(yt.any.map((r) => r.id), ["com.i.any"]);
  // a paid row the index hasn't seen: guessed from its description, only for a seller's source
  const p = { id: "com.p.x", name: "X", version: "1", key: "k", paid: true, short: "Spotify enhancer" };
  assert.equal(rowInfo(p, { storage: s }), null);
  assert.deepEqual(rowInfo(p, { storage: s, sellers: new Set(["k"]) }).bundles, ["com.spotify.client"]);
  // madeForRows (the app page's count) counts only the tweaks naming the app
  assert.deepEqual((await madeForRows("com.google.ios.youtube", { rows: async () => rows, storage: s })).map((r) => r.id), ["com.i.yt"]);
  assert.deepEqual(await madeForRows("com.burbn.instagram", { rows: async () => rows, storage: s }), [], "a paid guess isn't counted");
  // sellerKeys: a source whose payment_endpoint answers a URL
  const keys = await sellerKeys(rows, { sources: async () => [SRC], text: async () => "https://pay.example/api/\n" });
  assert.deepEqual([...keys], ["repo-a"]);
});

test("checkTweakRows (a Tweak Source's list): the index's refusals dropped at once, no download for them", async () => {
  const refusedSeen = [], checked = [];
  const out = await checkTweakRows(rows, { storage: storage(), index: async () => 0, onRefused: (ids) => refusedSeen.push(ids),
    pkg: async (r) => ({ package: r.id, version: r.version }), check: async (st) => { checked.push(st.package); return { ok: true }; } });
  assert.deepEqual(refusedSeen[0], ["com.i.sb"]);
  assert.deepEqual(out, ["com.i.sb"]);
  assert.deepEqual(checked, ["com.i.new"], "only the row nobody checked; the paid guess isn't a verdict but is indexed");
});

test("tweakInfo: two checks side by side keep both verdicts (found on the iPhone 15 Pro)", async () => {
  const s = storage();
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = tweakInfo({ package: "com.r.slow", version: "1", debUrl: "https://x/a.deb" }, { storage: s,
    fetchDeb: async () => { await gate; return DEBS["debs/ytplus_1.0.deb"]; } });
  await tweakInfo({ package: "com.r.fast", version: "1", debUrl: "https://x/b.deb" }, { storage: s, fetchDeb: async () => DEBS["debs/anyfont_1.1.deb"] });
  release();
  await slow;
  const kept = JSON.parse(s.getItem("ifizbox.tweakInfo"));
  assert.deepEqual(Object.keys(kept).sort(), ["com.r.fast@1", "com.r.slow@1"]);
});

test("checkForApp: unchecked rows only, the app's name first, capped; onChecked for each", async () => {
  const s = storage();
  const list = [{ id: "a.other", name: "Other", version: "1" }, { id: "a.yt", name: "YouTube Plus", version: "1" },
    { id: "a.paid", name: "Paid", version: "1", paid: true }, { id: "com.i.yt", name: "YTPlus", version: "1.0" }];
  const order = [], seen = [];
  const c = checkForApp(list, "com.google.ios.youtube", { storage: s, max: 5, onChecked: (r) => seen.push(r.id),
    pkg: async (r) => ({ package: r.id, version: r.version }), check: async (st) => { order.push(st.package); return { ok: true, bundles: [] }; } });
  await c.done;
  assert.deepEqual(order, ["a.yt", "a.other"], "indexed and paid rows aren't checked here; the YouTube one first");
  assert.deepEqual(seen, ["a.yt", "a.other"]);
  // an app KNOWN_APPS doesn't list: its own name puts its tweaks first
  const own = [];
  await checkForApp([{ id: "b.x", name: "Other", version: "1" }, { id: "b.apollo", name: "Apollo Plus", version: "1" }], "com.c.Apollo",
    { storage: s, name: "Apollo", pkg: async (r) => ({ package: r.id }), check: async (st) => { own.push(st.package); return null; } }).done;
  assert.deepEqual(own, ["b.apollo", "b.x"]);
  const capped = checkForApp(list, "x", { storage: s, max: 1, pkg: async (r) => ({ package: r.id }), check: async (st) => { order.push(st.package); return null; } });
  await capped.done;
  assert.equal(order.length, 3);
});
