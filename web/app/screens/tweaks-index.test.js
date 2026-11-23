// F344: the app side of the shared tweak index (screens/tweaks.js): the verdicts of the index file join the
// device's checks, Add Tweaks for an app lists only that app's tweaks then every-app ones with "Works in", paid
// tweaks only from a source that names a seller. B391: what no verdict covers is listed by what it mentions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTweakIndex, cachedTweakInfo, rowInfo, appTweakRows, madeForRows, sellerKeys,
  tweakInfo, tweaksKnown, saveTweaks, onTweakVerdicts } from "./tweaks.js";
import { packIndexFile } from "../core/tweakindexfile.js";
import { indexSource } from "../core/tweakindex.js";
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

const packed = (list, { src = SRC, at = 5 } = {}) => {
  const { key } = indexSource(src);
  return [{ key, refreshed: at, pending: 0 }, list.map((e) => ({ source: key, checked: at, entry: JSON.stringify(e) }))];
};
const fileOf = (...ps) => packIndexFile(ps.map((p) => p[0]), ps.flatMap((p) => p[1]));

test("loadTweakIndex takes the file's verdicts of these sources; cachedTweakInfo and tweakInfo use them", async () => {
  const file = fileOf(packed(entries));
  assert.equal(await loadTweakIndex([SRC], { file: { read: async () => file } }), 3, "the free tweaks");
  assert.equal(await loadTweakIndex([SRC], { file: { read: async () => file } }), 3);
  const s = storage();
  assert.deepEqual(cachedTweakInfo({ package: "com.i.yt", version: "1.0" }, { storage: s }).bundles, ["com.google.ios.youtube"]);
  assert.equal(cachedTweakInfo({ package: "com.i.yt", version: "0.9" }, { storage: s }), null, "another version isn't known");
  assert.equal(cachedTweakInfo({ package: "com.i.ig", version: "3.0" }, { storage: s }), null, "a paid tweak has no verdict");
  // the index refused it: no download
  const info = await tweakInfo({ package: "com.i.sb", version: "2.0", debUrl: "https://x/sb.deb" }, { storage: s,
    fetchDeb: async () => { throw new Error("downloaded"); } });
  assert.equal(info.ok, false);
  // a source the file doesn't have, or no file at all: nothing
  assert.equal(await loadTweakIndex([{ key: "b", uri: "https://other-index.example/", dist: "./" }], { file: { read: async () => file } }), 0);
  assert.equal(await loadTweakIndex([SRC], { file: { read: async () => null } }), 0);
});

test("F398: a newer file's verdicts reach what's loaded; the same package in two sources: the one that works wins", async () => {
  const s = storage();
  const A = { uri: "https://two-a.example/", dist: "./" }, B = { uri: "https://two-b.example/", dist: "./" };
  const no = { package: "com.two", version: "1", ok: false, why: "It's for iOS itself", bundles: [], systemOnly: true };
  const yes = { package: "com.two", version: "1", ok: true, bundles: ["com.b.app"] };
  const get = () => cachedTweakInfo({ package: "com.two", version: "1" }, { storage: s });
  const first = fileOf(packed([no], { src: A }), packed([no], { src: B }));
  let told = null;
  const told2 = [];
  const off = onTweakVerdicts((m) => told2.push(m));
  const file = { read: async () => first, onChange: (f) => { told = f; } };
  await loadTweakIndex([A, B], { file });
  assert.equal(get().ok, false);
  told(fileOf(packed([no], { src: A, at: 9 }), packed([yes], { src: B, at: 9 })));
  assert.deepEqual(get().bundles, ["com.b.app"]);
  assert.deepEqual(told2.map((m) => m["com.two@1"]), [true, false]);
  told(fileOf(packed([{ ...yes, package: "com.else" }], { src: A, at: 12 })));
  assert.equal(get(), null);
  assert.equal(told2.at(-1)["com.two@1"], null, "a verdict the newer file dropped is taken back");
  off();
  await loadTweakIndex([SRC], { file: { read: async () => fileOf(packed(entries)) } });
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

test("B391: with no verdict, free or paid, Add Tweaks lists what mentions the app; nothing is downloaded", async () => {
  const s = storage();
  const list = [
    { id: "n.yt", name: "Tube Plus", version: "1", key: "k", short: "More for YouTube" },
    { id: "n.long", name: "Long", version: "1", key: "k", short: "Nothing here", guess: ["com.google.ios.youtube"] },
    { id: "n.sb", name: "Glint", version: "1", key: "k", short: "Status bar shine" },
    { id: "n.apollo", name: "Apollo Plus", version: "1", key: "k" },
    { id: "n.paid", name: "Paid", version: "1", key: "k", paid: true, short: "YouTube extras" },
  ];
  const opts = { rows: async () => list, storage: s };
  const of = async (id, o = {}) => (await appTweakRows(id, { ...opts, ...o })).made.map((r) => r.id);
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetched"); };
  try {
    assert.deepEqual(await of("com.google.ios.youtube"), ["n.yt", "n.long"]);
    assert.deepEqual(await of("com.google.ios.youtube", { sellers: async () => new Set(["k"]) }), ["n.yt", "n.long", "n.paid"]);
    assert.deepEqual(await of("com.c.Apollo"), []);
    assert.deepEqual(await of("com.c.Apollo", { name: "Apollo" }), ["n.apollo"]);
    assert.deepEqual(await of("com.c.Apollo", { apps: async () => [{ bundleId: "com.c.Apollo", name: "Apollo" }] }), ["n.apollo"]);
    const info = rowInfo(list[0], { storage: s });
    assert.equal(info.unverified, true);
    assert.equal(info.paid, undefined);
    assert.equal(rowInfo(list[2], { storage: s }), null);
    // a version with no verdict of a tweak this phone found to work (bought: an earlier one was checked) stays
    s.setItem("ifizbox.tweakInfo", JSON.stringify({ "n.sb@0.9": { v: 2, ok: true, bundles: ["com.google.ios.youtube"], anyApp: false } }));
    assert.deepEqual(await of("com.google.ios.youtube"), ["n.yt", "n.long", "n.sb"]);
  } finally { globalThis.fetch = savedFetch; }
});

test("B391 tweaksKnown: the user's apps, the tweaks in them, and what this phone found to work", async () => {
  const s = storage();
  s.setItem("ifizbox.tweakInfo", JSON.stringify({
    "com.k.bought@2": { v: 2, ok: true, bundles: [], anyApp: true }, "com.k.no@1": { v: 2, ok: false, why: "daemon" },
  }));
  const store = memStore();
  await saveTweaks("com.k.app", [{ name: "com.k.kept_1.0.deb", data: new Uint8Array([1]) }], { store });
  const opts = { storage: s, store, apps: async () => [{ bundleId: "com.k.app", name: "Apollo" }],
    records: async () => [{ bundleId: "com.k.copy", originalBundleId: "com.k.orig", tweaks: ["com.k.signed_2.deb", "com.k.dy_1.dylib", "odd.zip"] }] };
  assert.deepEqual(await tweaksKnown(opts), { apps: { "com.k.app": "Apollo" }, held: ["com.k.dy", "com.k.kept", "com.k.signed"], worked: ["com.k.bought"] });
  await saveTweaks("com.k.app", [], { store });
  assert.deepEqual((await tweaksKnown(opts)).held, ["com.k.dy", "com.k.signed"], "a removed one goes");
});
