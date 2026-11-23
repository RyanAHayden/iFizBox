// B272: Find App Sources (screens/moresources.js drawApps over manage.js appSourceRows and core/appsources.js): never
// empty while the directory has entries (added sources stay, with ADDED), its directory checked against the piracy
// list, and the "none answered" note only when every source not added yet fails to load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakePage, memStorage, fakeIndexedDB } from "../fakes.test-helper.js";

globalThis.localStorage = memStorage({ "ifizbox.device": "none" });
globalThis.document = fakeDocument();
globalThis.CSS ??= { escape: (s) => String(s) };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.indexedDB = fakeIndexedDB();
globalThis.fetch = async () => { throw new Error("offline"); };
delete globalThis.ifizboxNative;
const more = await import("./moresources.js");
const { RECOMMENDED_SOURCES } = await import("../core/recommended.js");
const { recommendedRows } = await import("../core/sourcelist.js");
const { APP_SOURCE_DIRECTORY, findAppSources } = await import("../core/appsources.js");
const { sourceWarning } = await import("../core/warnings.js");
const { PIRACY_HOSTS } = await import("../core/piracy-list.js");

const appRecs = () => findAppSources(RECOMMENDED_SOURCES);
const ctx = { go() {}, showHUD: () => () => {} };
const buttons = (el) => el.querySelectorAll(".find-row .price-btn").map((b) => b.textContent); // B344: Find More's rows

test("B272: the directory: Recommended's app sources first, then the checked extras, each URL once, no APT repos", () => {
  const recs = appRecs();
  const recApps = RECOMMENDED_SOURCES.filter((r) => !r.jailbreak);
  assert.deepEqual(recs.slice(0, recApps.length).map((r) => r.name), recApps.map((r) => r.name));
  assert.ok(APP_SOURCE_DIRECTORY.length >= 5);
  assert.ok(recs.every((r) => !r.jailbreak));
  assert.equal(new Set(recs.map((r) => r.url.toLowerCase().replace(/\/+$/, ""))).size, recs.length);
  for (const r of APP_SOURCE_DIRECTORY) {
    assert.equal(sourceWarning(r.url), null, `${r.name} is on the piracy list`);
    assert.match(r.url, /^https:\/\//, `${r.name}: https only`);
    assert.ok(["dev", "modded"].includes(r.tag), `${r.name}: a group`);
    assert.ok(r.why.length > 20, `${r.name}: says what it carries`);
  }
  const dup = { ...APP_SOURCE_DIRECTORY[0], name: "Copy", url: APP_SOURCE_DIRECTORY[0].url + "/" };
  const bad = { kind: "source", name: "Bad", tag: "dev", url: `https://${PIRACY_HOSTS[0]}/apps.json`, why: "x" };
  const out = findAppSources(RECOMMENDED_SOURCES, { blocked: (u) => Boolean(sourceWarning(u)), directory: [...APP_SOURCE_DIRECTORY, dup, bad] });
  assert.ok(!out.some((r) => r.name === "Copy"), "a URL already listed is left out");
  assert.ok(!out.some((r) => r.name === "Bad"), "a piracy-listed source is never listed");
});

test("B272: every source added already: the page still lists them all, each ADDED, and no failure note", async () => {
  const recs = appRecs();
  const have = recs.map((r) => ({ key: `alt:${r.url}`, uri: r.url, kind: "altstore" }));
  const rows = recommendedRows(recs, have, { jailbroken: false });
  assert.ok(rows.every((r) => r.added), "the fixture adds them all");
  const box = fakePage();
  let asked = 0;
  await more.drawApps(box, ctx, { rows: async () => rows, preview: async () => { asked++; return null; } });
  assert.equal(buttons(box).length, recs.length);
  assert.ok(buttons(box).every((t) => t === "ADDED"));
  assert.equal(asked, 0, "nothing to read: no check");
  assert.doesNotMatch(box.textContent, /None of these sources answered/);
});

test("B272: none answers: a note under the footer says so; one answering is enough to stay quiet", async () => {
  const rows = recommendedRows(appRecs(), [], { jailbroken: false });
  const box = fakePage();
  await more.drawApps(box, ctx, { rows: async () => rows, preview: async () => { throw new Error("The Internet connection appears to be offline."); } });
  assert.equal(buttons(box).length, rows.length, "the rows stay");
  assert.ok(buttons(box).every((t) => t === "ADD"));
  assert.match(box.lastChild.textContent, /None of these sources answered: The Internet connection appears to be offline\./);
  const ok = fakePage();
  let n = 0;
  await more.drawApps(ok, ctx, { rows: async () => rows, preview: async () => { if (n++) throw new Error("x"); return { apps: [] }; } });
  assert.doesNotMatch(ok.textContent, /None of these sources answered/);
});
