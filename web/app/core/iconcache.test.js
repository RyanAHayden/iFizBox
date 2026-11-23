// B58: the device's source icon cache (core/iconcache.js): a stored icon is shown before any network and needs none
// for a day; a refresh tries the places in sourceIconUrls' order (a dist repo's <base> first, then its root); a
// failed refresh keeps the old icon; PNG/JPEG only; the IndexedDB store round-trips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { iconCache, iconType, openIconStore, ICON_MAX_AGE, ICON_MAX_BYTES } from "./iconcache.js";
import { sourceIconUrls, tweakSourcesFrom } from "./sources.js";
import { fakeIndexedDB } from "../fakes.test-helper.js";

// BigBoss, an old dist repo (`deb <uri> stable main`) and no longer a default: the shape this lookup order is for.
const [BIGBOSS] = tweakSourcesFrom([{ name: "BigBoss", uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] }]);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const err = (code) => Object.assign(new Error(code), { code });

function mapStore() {
  const rows = new Map();
  return { rows, get: async (k) => structuredClone(rows.get(k)), put: async (r) => { rows.set(r.key, structuredClone(r)); } };
}

// fetchIcon from a table url -> bytes | error code; every call is logged.
function net(table) {
  const calls = [];
  const fetchIcon = async (url) => {
    calls.push(url);
    const v = table[url];
    if (v instanceof Uint8Array) return { bytes: v };
    throw err(v ?? "not_found");
  };
  return { calls, fetchIcon };
}

test("iconType: PNG and JPEG by their signature, nothing else", () => {
  assert.equal(iconType(PNG), "image/png");
  assert.equal(iconType(JPEG), "image/jpeg");
  assert.equal(iconType(SVG), null);
  assert.equal(iconType(new TextEncoder().encode("GIF89a....")), null);
  assert.equal(iconType(new Uint8Array([0x89, 0x50])), null);
  assert.equal(iconType("\x89PNG\r\n\x1a\n"), null);
});

test("lookup order: BigBoss' <base> (dists/stable/) first, then the root; the root is the fallback when <base> 404s", async () => {
  const bigboss = BIGBOSS;
  const urls = sourceIconUrls(bigboss);
  assert.deepEqual(urls, ["http://apt.thebigboss.org/repofiles/cydia/dists/stable/CydiaIcon.png", "http://apt.thebigboss.org/repofiles/cydia/CydiaIcon.png"]);
  // BigBoss: the icon at <base>, the root never asked
  let n = net({ [urls[0]]: PNG });
  let rec = await iconCache({ store: mapStore(), fetchIcon: n.fetchIcon }).load(bigboss.key ?? "bb", urls);
  assert.equal(rec.url, urls[0]);
  assert.deepEqual(n.calls, [urls[0]]);
  // Procursus-style: <base> 404s, the root has it
  n = net({ [urls[1]]: PNG });
  rec = await iconCache({ store: mapStore(), fetchIcon: n.fetchIcon }).load("p", urls);
  assert.equal(rec.url, urls[1]);
  assert.deepEqual(n.calls, urls);
  // not a picture at <base> (an HTML 200 page, an SVG): skipped, the next place tried
  n = net({ [urls[0]]: SVG, [urls[1]]: JPEG });
  rec = await iconCache({ store: mapStore(), fetchIcon: n.fetchIcon }).load("s", urls);
  assert.equal(rec.type, "image/jpeg");
});

test("a cached icon is shown at once and asks no network for a day", async () => {
  let t = 1_000_000;
  const store = mapStore();
  const urls = ["http://r.test/dists/stable/CydiaIcon.png"];
  let n = net({ [urls[0]]: PNG });
  const seen = [];
  await iconCache({ store, fetchIcon: n.fetchIcon, now: () => t }).load("k", urls, (r) => seen.push(r));
  assert.equal(seen.length, 1);
  assert.equal(n.calls.length, 1);
  // a relaunch (a new cache over the same store), 23 hours later: shown from the store, no fetch at all
  t += ICON_MAX_AGE - 3600_000;
  n = net({});
  const shown = [];
  const order = [];
  const cache = iconCache({ store, fetchIcon: async (u) => { order.push("fetch"); return n.fetchIcon(u); }, now: () => t });
  const rec = await cache.load("k", urls, (r) => { order.push("shown"); shown.push(r); });
  assert.deepEqual([...rec.bytes], [...PNG]);
  assert.equal(shown.length, 1);
  assert.deepEqual([...shown[0].bytes], [...PNG]);
  assert.deepEqual(order, ["shown"]);
  assert.equal(n.calls.length, 0);
});

test("a day later: the old icon first, then the refreshed one; a failed refresh keeps the old icon", async () => {
  let t = 5_000_000;
  const store = mapStore();
  const urls = ["https://r.test/CydiaIcon.png"];
  await iconCache({ store, fetchIcon: net({ [urls[0]]: PNG }).fetchIcon, now: () => t }).load("k", urls);
  // a new icon on the repo
  t += ICON_MAX_AGE + 1;
  const seen = [];
  let rec = await iconCache({ store, fetchIcon: net({ [urls[0]]: PNG2 }).fetchIcon, now: () => t }).load("k", urls, (r) => seen.push([...r.bytes]));
  assert.deepEqual(seen, [[...PNG], [...PNG2]]);
  assert.deepEqual([...store.rows.get("k").bytes], [...PNG2]);
  // offline next day: the icon stays, nothing written, asked again next session
  t += ICON_MAX_AGE + 1;
  const offline = net({ [urls[0]]: "network" });
  const kept = [];
  rec = await iconCache({ store, fetchIcon: offline.fetchIcon, now: () => t }).load("k", urls, (r) => kept.push(r));
  assert.deepEqual([...rec.bytes], [...PNG2]);
  assert.equal(kept.length, 1); // the stored one, not shown twice
  assert.deepEqual([...store.rows.get("k").bytes], [...PNG2]);
  assert.ok(t - store.rows.get("k").at > ICON_MAX_AGE);
  // the repo now 404s or serves junk: the icon still stays, and isn't asked about again for a day
  for (const v of ["not_found", SVG, new Uint8Array(ICON_MAX_BYTES + 1).fill(0x89)]) {
    const c = net({ [urls[0]]: v });
    rec = await iconCache({ store, fetchIcon: c.fetchIcon, now: () => t }).load("k", urls);
    assert.deepEqual([...rec.bytes], [...PNG2]);
    assert.equal(store.rows.get("k").at, t);
  }
  const later = net({ [urls[0]]: PNG });
  await iconCache({ store, fetchIcon: later.fetchIcon, now: () => t + 1000 }).load("k", urls);
  assert.equal(later.calls.length, 0);
});

test("no icon anywhere: remembered for a day; no answer at all: nothing remembered", async () => {
  let t = 0;
  const store = mapStore();
  const urls = ["https://a.test/dists/x/CydiaIcon.png", "https://a.test/CydiaIcon.png"];
  let rec = await iconCache({ store, fetchIcon: net({}).fetchIcon, now: () => t }).load("none", urls);
  assert.equal(rec.none, true);
  const quiet = net({});
  await iconCache({ store, fetchIcon: quiet.fetchIcon, now: () => t + 1 }).load("none", urls);
  assert.equal(quiet.calls.length, 0);
  // offline with nothing stored: no record, so the next session asks again
  rec = await iconCache({ store, fetchIcon: net({ [urls[0]]: "network", [urls[1]]: "timeout" }).fetchIcon, now: () => t }).load("off", urls);
  assert.equal(rec, null);
  assert.equal(store.rows.has("off"), false);
});

test("once per session per source, concurrent rows share one refresh; a URL no longer listed refreshes", async () => {
  const store = mapStore();
  const urls = ["https://r.test/CydiaIcon.png"];
  const n = net({ [urls[0]]: "network" });
  const cache = iconCache({ store, fetchIcon: n.fetchIcon });
  await Promise.all([cache.load("k", urls), cache.load("k", urls), cache.load("k", urls)]);
  await cache.load("k", urls);
  assert.equal(n.calls.length, 1);
  // an AltStore source whose iconURL changed: the stored icon's URL isn't on the list, so it is fetched again
  await iconCache({ store, fetchIcon: net({ "https://x.test/old.png": PNG }).fetchIcon }).load("alt", ["https://x.test/old.png"]);
  const moved = net({ "https://x.test/new.png": PNG2 });
  const rec = await iconCache({ store, fetchIcon: moved.fetchIcon }).load("alt", ["https://x.test/new.png"]);
  assert.equal(rec.url, "https://x.test/new.png");
});

test("a broken store: the icon still loads, nothing thrown", async () => {
  const store = { get: async () => { throw new Error("db gone"); }, put: async () => { throw new Error("db gone"); } };
  const rec = await iconCache({ store, fetchIcon: net({ "https://r.test/CydiaIcon.png": PNG }).fetchIcon }).load("k", ["https://r.test/CydiaIcon.png"]);
  assert.equal(rec.type, "image/png");
});

test("openIconStore: records survive a reopen (a relaunch)", async () => {
  const indexedDB = fakeIndexedDB();
  const a = await openIconStore({ indexedDB });
  await a.put({ key: "deb:http://r/:stable", url: "http://r/CydiaIcon.png", type: "image/png", bytes: PNG, at: 7 });
  const b = await openIconStore({ indexedDB });
  const rec = await b.get("deb:http://r/:stable");
  assert.deepEqual([...rec.bytes], [...PNG]);
  assert.equal(await b.get("missing"), undefined);
  await assert.rejects(openIconStore({ indexedDB: null }), /not available/);
});
