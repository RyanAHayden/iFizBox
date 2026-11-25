// F426b: refine(), the filters and sorts of a list, over a real catalog, through the worker's entry point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, runCatalog } from "./catalog.js";

const packages = (...list) => list.map((f) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n")).join("\n\n") + "\n";
const deb = (id, section, extra = {}) => ({ Package: id, Name: id, Version: "1", Architecture: "iphoneos-arm64", Section: section, ...extra });
const app = (name, date, extra = {}) => ({ name, bundleIdentifier: `app.${name.toLowerCase()}`, developerName: "R", category: "games",
  localizedDescription: "an app", versions: [{ version: "1", date, downloadURL: `https://apps.example/${name}.ipa`, size: 1 }], ...extra });
const alt = (...apps) => JSON.stringify({ name: "Apps", identifier: "com.example.apps", apps });
const ALT1 = "alt:https://one.example/s.json", ALT2 = "alt:https://two.example/s.json";
const names = (rows) => rows.map((r) => r.name);
const refine = (c, rows, opts) => runCatalog(c, "refine", opts === undefined ? [rows] : [rows, opts]);

function loaded() {
  const c = createCatalog();
  c.load("A", packages(
    deb("x.zed", "Tweaks"), deb("x.Both", "Tweaks"), deb("x.paid", "Tweaks", { Tag: "cydia::commercial" }),
    deb("x.theme", "Themes_(SpringBoard)")), "https://a.example/");
  c.load("B", packages(deb("x.both", "Tweaks", { Version: "2" }), deb("x.abc", "Utilities")), "https://b.example/");
  c.loadAlt(ALT1, alt(app("Old", "2025-01-01"), app("New", "2026-06-01"), app("Alpha", "2025-01-01")), "16.5");
  c.loadAlt(ALT2, alt(app("New", "2026-06-01")), "16.5");
  c.setInstalled("Package: x.zed\nName: x.zed\nStatus: install ok installed\nVersion: 1\nArchitecture: iphoneos-arm64\n");
  return c;
}
// a list with an order of its own: by name, backwards
const own = (c) => c.list().reverse();

test("no options: the same rows in the list's own order, every field kept, the list not changed", () => {
  const c = loaded();
  const rows = own(c).map((r) => ({ ...r, change: "new", seen: 5 }));
  const before = structuredClone(rows);
  for (const o of [undefined, {}, { sort: null }, { sort: "odd" }, { section: "*" }]) assert.deepEqual(refine(c, rows, o), before);
  refine(c, rows, { sort: "name" });
  assert.deepEqual(rows, before);
  assert.deepEqual(refine(c, null), []);
});

test("section, installed and price filter, in the list's own order", () => {
  const c = loaded();
  const rows = own(c);
  assert.deepEqual(names(refine(c, rows, { section: "Tweaks" })), ["x.zed", "x.paid", "x.both"]);
  assert.deepEqual(names(refine(c, rows, { section: "group:Themes" })), ["x.theme"]);
  assert.deepEqual(names(refine(c, rows, { installed: "installed" })), ["x.zed"]);
  assert.equal(refine(c, rows, { installed: "not" }).length, rows.length - 1);
  assert.deepEqual(names(refine(c, rows, { price: "paid" })), ["x.paid"]);
  assert.equal(refine(c, rows, { price: "free" }).length, rows.length - 1);
  assert.deepEqual(names(refine(c, rows, { section: "Tweaks", installed: "not", price: "free" })), ["x.both"]);
});

test("the filters mean what Search's do", () => {
  const c = loaded();
  for (const o of [{ section: "Tweaks" }, { section: "group:Tweaks" }, { installed: "installed" }, { installed: "not" }, { price: "paid" },
    { price: "free" }, { source: "A" }, { source: "B", section: "Tweaks" }, { source: "gone" }]) {
    const found = c.search("x.", o).map((r) => r.id.toLowerCase()).sort();
    const kept = refine(c, c.list().filter((r) => r.id.startsWith("x.")), o).map((r) => r.id.toLowerCase()).sort();
    assert.deepEqual(kept, found, JSON.stringify(o));
  }
});

test("source: what that source lists, also where another source's copy is the row shown", () => {
  const c = loaded();
  const rows = refine(c, c.list(), { source: "A" });
  assert.deepEqual(names(rows), ["x.both", "x.paid", "x.theme", "x.zed"]);
  assert.equal(rows[0].key, "B", "the newer copy stays the row, its name spelled another way");
  assert.deepEqual(names(refine(c, c.list(), { source: ALT2 })), ["New"]);
  assert.deepEqual(refine(c, c.list(), { source: "gone" }), []);
});

test("source: a copy that source's own list hides doesn't count", () => {
  const c = createCatalog();
  c.load("A", packages(deb("x.both", "Toys")), "https://a.example/");
  c.load("B", packages(deb("x.both", "Tweaks", { Version: "2" })), "https://b.example/");
  c.setHidden(["Toys"]);
  assert.deepEqual(refine(c, c.list(), { source: "A" }), []);
  assert.equal(refine(c, c.list(), { source: "B" }).length, 1);
});

test("sort name", () => {
  const c = loaded();
  assert.deepEqual(refine(c, own(c), { sort: "name" }), c.list());
});

test("sort newest: undated last, ties by name", () => {
  const c = loaded();
  assert.deepEqual(names(refine(c, own(c), { sort: "newest" })),
    ["New", "Alpha", "Old", "x.abc", "x.both", "x.paid", "x.theme", "x.zed"]);
});

test("sort popular: most sources first, ties by newest then name, as popular()", () => {
  const c = loaded();
  const got = refine(c, own(c), { sort: "popular" });
  assert.deepEqual(names(got), ["New", "x.both", "Alpha", "Old", "x.abc", "x.paid", "x.theme", "x.zed"]);
  assert.deepEqual(names(got), names(c.popular()));
});

test("a filter and a sort together", () => {
  const c = loaded();
  assert.deepEqual(names(refine(c, own(c), { source: ALT1, sort: "newest" })), ["New", "Alpha", "Old"]);
});

test("sideload build: App Tweaks and All Tweaks keep the Tweak Sources' rows, none while that section is hidden", () => {
  const c = createCatalog();
  c.load("T", packages(deb("x.tweak", "Tweaks", { Depends: "mobilesubstrate" })), "https://t.example/", undefined, { tweaks: true });
  c.loadAlt(ALT1, alt(app("Old", "2025-01-01")), "16.5");
  c.setDevice({ ios: "16.5", jailbreak: "none" });
  c.setTweakVerdicts({ "x.tweak@1": false });
  const rows = c.featured([{ key: "T", id: "x.tweak" }, { key: ALT1, id: c.list()[0].id }]);
  assert.equal(rows.length, 2);
  for (const section of ["App Tweaks", "group:Tweaks"]) assert.deepEqual(names(refine(c, rows, { section })), ["x.tweak"]);
  assert.deepEqual(names(refine(c, rows, { source: "T" })), ["x.tweak"]);
  c.setHidden(["App Tweaks"]);
  assert.deepEqual(refine(c, rows, { section: "App Tweaks" }), []);
});
