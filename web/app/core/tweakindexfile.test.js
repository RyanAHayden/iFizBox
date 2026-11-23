// F398: the Tweak Index as one file: packed and read back, the bundled copy offline, a newer fetched one kept across
// launches, bad content ignored, the switch, and no request that names a source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packIndexFile, parseIndexFile, answerFromFile, createIndexFile, sourceId, FILE_URL, FILE_NAME, FILE_MAX, REFRESH_MS, RETRY_MS } from "./tweakindexfile.js";
import { indexSource } from "./tweakindex.js";
import { memoryIpaStore } from "./myipas.js";
import { createSettings, tweakIndexRefreshOn } from "./settings.js";
import { tweakSourceVerdict } from "./sources.js";
import { DOMAIN } from "../brand.js";
import { memStorage } from "../fakes.test-helper.js";

const A = { uri: "https://repo-a.example/", dist: "./" }, B = { uri: "https://repo-b.example/", dist: "stable", components: ["main"] };
const yt = { package: "com.yt", version: "1:2.0~b1", ok: true, why: null, bundles: ["com.google.ios.youtube"], anyApp: false, systemOnly: false, dylibs: ["X"], needs: ["mobilesubstrate"] };
const any = { package: "com.any", version: "1", ok: true, why: null, bundles: [], anyApp: true, systemOnly: false };
const sb = { package: "com.sb", version: "1", ok: false, why: "It's for iOS itself", bundles: ["com.apple.springboard"], anyApp: false, systemOnly: true };
const lib = { package: "com.lib", version: "1", ok: false, why: "A library", bundles: [], anyApp: false, systemOnly: false, library: true };
const paid = { package: "com.paid", version: "1", ok: true, bundles: ["com.burbn.instagram"], paid: true, unverified: true };
const pack = (list, { at = 100, opts, sources = [A, B] } = {}) => packIndexFile(
  sources.map((s, i) => ({ key: indexSource(s).key, refreshed: at, pending: i ? 4 : 0, error: null })),
  list.map(([s, e]) => ({ source: indexSource(s).key, checked: at, entry: JSON.stringify(e) })), opts);
const ALL = [[A, yt], [A, any], [A, sb], [A, lib], [A, paid], [B, { ...any, ok: false, anyApp: false, why: "It's for iOS itself" }]];
const text = (f) => JSON.stringify(f);

test("packed and read back: every free verdict under its own source, the paid ones' guessed apps, no address", () => {
  const f = parseIndexFile(text(pack(ALL)));
  assert.equal(f.at, 100);
  assert.ok(!text(f).includes("example"), "no source's address");
  assert.ok(Object.keys(f.sources).every((k) => /^[0-9a-f]{20}$/.test(k)));
  const a = answerFromFile(f, A);
  assert.equal(a.pending, 0);
  const { dylibs, needs, ...slim } = yt;
  assert.deepEqual(a.tweaks, [slim, any, sb, lib, { ok: true, bundles: ["com.burbn.instagram"], anyApp: false, systemOnly: false, paid: true, unverified: true }]);
  const b = answerFromFile(f, B);
  assert.equal(b.tweaks[0].ok, false, "com.any@1 in B is B's own verdict");
  assert.equal(b.pending, 1);
  assert.equal(answerFromFile(f, { uri: "https://other.example/", dist: "./" }), null);
  assert.equal(answerFromFile(null, A), null);
  // the source hiding reads it as it read the server's answer
  assert.equal(tweakSourceVerdict(a, ["com.burbn.instagram"]), true);
  assert.equal(tweakSourceVerdict(b, ["x"]), null, "still being read");
});

test("nothing to say, or a source over the cap", () => {
  assert.equal(pack([]), null);
  assert.equal(pack([[A, paid]]), null, "a file without one verdict is empty");
  assert.equal(packIndexFile([{ key: "k", refreshed: 0 }], []), null);
  const small = pack(ALL, { opts: { max: 560 } });
  assert.ok(answerFromFile(small, A) && !answerFromFile(small, B), "the source that doesn't fit is left out whole");
});

test("parseIndexFile takes only a whole, well-shaped, non-empty file", () => {
  const good = pack(ALL);
  assert.ok(parseIndexFile(text(good), { now: 100 }));
  assert.equal(parseIndexFile(text({ ...good, at: 10 * 86400 }), { now: 100 }), null, "from the future");
  const bad = [undefined, "", "<!doctype html>", "null", "[]", "{}", text({ ...good, v: 2 }), text({ ...good, at: 0 }), text({ ...good, at: "9" }),
    text({ ...good, sources: {} }), text({ ...good, sources: [] }), text({ ...good, why: null }), text({ ...good, why: [1] }),
    text({ ...good, sources: { x: { at: 1, t: {} } } }), text({ ...good, sources: { x: { at: 1, t: [] } } }),
    ...[-1, "1", null, [1], [1, 99], [1, -2], [1, -1, 5]].map((v) => text({ ...good, sources: { x: { at: 1, t: { "p@1": v } } } })),
    text({ ...good, sources: { x: { at: 1, paid: "no", t: { "p@1": 1 } } } }), text(good).slice(0, -5), " ".repeat(FILE_MAX) + text(good)];
  for (const t of bad) assert.equal(parseIndexFile(t), null, String(t).slice(0, 80));
});

test("the bundled file is a good one", () => {
  const f = parseIndexFile(readFileSync(new URL(`../${FILE_NAME}`, import.meta.url), "utf8"), { now: Date.now() / 1000 });
  assert.ok(f);
  assert.ok(answerFromFile(f, { uri: "https://havoc.app/", dist: "./" }).tweaks.length > 20, "Havoc's verdicts");
});

// A phone: the store outlives a launch; `serve` is what the server gives.
function phone({ bundled = text(pack([[A, sb]])), serve = async () => { throw new Error("offline"); } } = {}) {
  const mem = memoryIpaStore();
  const p = { asked: [], at: 1e12, on: true, serve, bundled, mem,
    launch: () => createIndexFile({ bundled: async () => p.bundled, store: async () => mem, enabled: () => p.on, now: () => p.at,
      get: async (u, o) => { p.asked.push(u); assert.equal(o.credentials, "omit"); return p.serve(u); } }) };
  return p;
}
const ok = (body) => new Response(body);
const verdict = async (f) => answerFromFile(await f.read(), A).tweaks[0];

test("offline: the bundled file's verdicts, the same after a relaunch", async () => {
  const p = phone();
  assert.equal((await verdict(p.launch())).systemOnly, true);
  const again = p.launch();
  assert.equal(await again.refresh(), false);
  assert.equal((await verdict(again)).systemOnly, true);
  assert.equal(await phone({ bundled: "" }).launch().read(), null);
});

test("a newer fetched file wins, is told, and is kept for the next launch; an older one is not used", async () => {
  const p = phone({ serve: async () => ok(text(pack([[A, yt]], { at: 200 }))) });
  const f = p.launch();
  const told = [];
  f.onChange((x) => told.push(x.at));
  assert.equal((await verdict(f)).systemOnly, true, "read never waits for the network");
  await f.refresh();
  assert.equal((await verdict(f)).package, "com.yt");
  assert.deepEqual(told, [200]);
  assert.equal(await f.refresh(), false, "fresh: not asked again");
  assert.equal(p.asked.length, 1);
  // the next launch, offline
  p.serve = async () => { throw new Error("offline"); };
  p.at += REFRESH_MS;
  assert.equal((await verdict(p.launch())).package, "com.yt");
  // an app update whose bundled file is newer than the kept one
  p.bundled = text(pack([[A, any]], { at: 300 }));
  assert.equal((await verdict(p.launch())).package, "com.any");
  // the server falls back to an older copy
  p.at += REFRESH_MS;
  p.serve = async () => ok(text(pack([[A, yt]], { at: 250 })));
  const g = p.launch();
  assert.equal(await g.refresh(), false);
  assert.equal((await verdict(g)).package, "com.any");
});

test("a bad, empty, too big or failing answer is ignored; asked again only after a while", async () => {
  const p = phone();
  const f = p.launch();
  const { mem } = p;
  for (const serve of [async () => ok("<!doctype html>"), async () => ok(text({ v: 1, at: 900, why: [], sources: {} })), async () => ok(""),
    async () => new Response(text(pack([[A, yt]], { at: 900 })), { status: 500 }),
    async () => ok(text(pack([[A, yt]], { at: 9e11 }))), async () => ok(new Uint8Array(FILE_MAX + 1))]) {
    p.serve = serve;
    p.at += RETRY_MS;
    const n = p.asked.length;
    assert.equal(await f.refresh(), false);
    assert.equal(p.asked.length, n + 1);
    await f.refresh();
    assert.equal(p.asked.length, n + 1, "not hammered");
    assert.equal((await verdict(f)).systemOnly, true);
  }
  assert.equal(mem.files.size, 0);
  // a broken kept copy, or a store that fails: the bundled one
  await mem.put("file", { text: "junk", asked: p.at });
  assert.equal((await verdict(p.launch())).systemOnly, true);
  const broken = createIndexFile({ bundled: async () => p.bundled, store: async () => { throw new Error("no db"); }, enabled: () => false });
  assert.equal((await verdict(broken)).systemOnly, true);
});

test("the switch: on by default, off makes no request and keeps the copy it has", async () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "sideload" });
  assert.equal(s.get("tweakIndexRefresh"), true);
  assert.equal(tweakIndexRefreshOn(storage), true);
  assert.equal(s.isShown("tweakIndexRefresh"), true);
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak" }).isShown("tweakIndexRefresh"), false);
  s.set("tweakIndexRefresh", false);
  assert.equal(tweakIndexRefreshOn(storage), false);
  const p = phone({ serve: async () => ok(text(pack([[A, yt]], { at: 200 }))) });
  p.on = tweakIndexRefreshOn(storage);
  for (let i = 0; i < 3; i++) {
    const f = p.launch();
    await f.read();
    assert.equal(await f.refresh(), false);
    p.at += REFRESH_MS;
  }
  assert.deepEqual(p.asked, []);
  s.set("tweakIndexRefresh", true);
  p.on = tweakIndexRefreshOn(storage);
  assert.equal(await p.launch().refresh(), true);
});

test("no request URL holds a source: one fixed address, whatever the sources", async () => {
  const p = phone({ serve: async () => ok(text(pack(ALL, { at: 200 }))) });
  const f = p.launch();
  for (const s of [A, B, { uri: "https://private.example/", dist: "./" }]) answerFromFile(await f.read(), s);
  await f.refresh();
  assert.deepEqual(p.asked, [FILE_URL]);
  assert.equal(FILE_URL, `https://${DOMAIN}/api/tweaks.json`);
  assert.ok(!sourceId(indexSource(A).key).includes("repo"));
  for (const file of ["screens/tweaks.js", "core/sources.js", "screens/sources.js", "catalog.js"]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/indexQuery|\/api\/tweaks\?|INDEX_URL/.test(src), `${file} asks the index about one source`);
  }
});
