// F426c: the lists opened from Browse: Search's scope bar and Filter button, Sort in the panel, each page's own choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, memStorage, tick } from "../fakes.test-helper.js";
import { createCatalog } from "../core/catalog.js";

globalThis.localStorage ??= memStorage();
globalThis.document = fakeDocument();
const make = document.createElement;
document.createElement = (t) => Object.assign(make.call(document, t), { getBoundingClientRect: () => ({ bottom: 100 }) });
globalThis.location = { hash: "#/home/browse/new" };
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
const { catalog } = await import("../catalog.js");
const { settings } = await import("../settings-store.js");
const browse = await import("./browse.js");
await import("./filterpanel.js");
const { listSorts, listSections, refineOptions, filterOn, byName, listNote } = await import("./listfilter.js");
const { emptyFilters } = await import("./searchscope.js");
const { dayHeaders } = await import("./home.js");

const deb = (id, name, section, tag = "") => `Package: ${id}\nName: ${name}\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: ${section}\n${tag}`;
settings.set("device", "iphoneos-arm64");
const real = createCatalog();
real.load("A", [deb("x.zed", "Zed", "Tweaks"), deb("x.mid", "Mid", "Themes (SpringBoard)"), deb("x.ann", "Ann", "Tweaks", "Tag: cydia::commercial\n"),
  deb("x.net", "Net", "Networking")].join("\n\n") + "\n");
Object.assign(catalog, { ensure: async () => {}, refine: async (rows, o) => real.refine(rows, o) });
const listed = () => ["x.zed", "x.mid", "x.ann", "x.net"].map((id, i) => ({ ...real.list().find((r) => r.id === id), seen: Date.now() - i * 1000 }));

async function page(over = {}) {
  const body = document.createElement("div"), host = document.createElement("div");
  host.append(body);
  document.body.append(host);
  const p = { body, fetched: 0 };
  await browse.renderSearchableList(body, { tab: "home", path: ["browse", "new"] }, async () => { p.fetched++; return p.rows ?? listed(); },
    { headers: dayHeaders, order: "Newest", ...over });
  p.button = body.querySelector(".scope-filter");
  p.results = body.querySelector(".search-results");
  p.vlist = body.querySelector(".pkg-vlist");
  p.note = body.querySelector(".empty");
  // the list's height says what is in it: 58 a row (browse.js ROW_HEIGHT), 23 a header
  p.height = () => Number.parseInt(p.vlist.style.height, 10);
  p.open = async () => { p.button.click(); await tick(); await tick(); };
  p.index = () => "sectionIndex" in p.results.dataset;
  return p;
}
const panelRow = (label) => document.body.querySelectorAll(".filter-drop").at(-1).querySelectorAll(".cell-inner").find((n) => n.textContent === label || n.textContent.startsWith(label));
const pick = async (label) => { await panelRow(label).click(); await tick(); await tick(); };
const ROW = 58, HEAD = 23;

test("Sort: the list's own order first under its name, no label twice", () => {
  assert.deepEqual(listSorts("Newest").map((s) => s.label), ["Newest", "Name", "Rating"]);
  assert.equal(listSorts("Newest")[0].value, undefined, "its own order");
  assert.deepEqual(listSorts("Name").map((s) => s.value), [undefined, "newest", "rating"]);
  assert.deepEqual(listSorts("Featured").map((s) => s.label), ["Featured", "Name", "Newest", "Rating"]);
  assert.deepEqual(listSorts("Popular").map((s) => s.label), ["Popular", "Name", "Newest", "Rating"]);
});

test("F450: every Sort row has its own icon, a list's own order too", () => {
  for (const order of ["Newest", "Featured", "Popular", "Recently Updated", "Name", "Default"]) {
    for (const s of listSorts(order)) assert.match(s.icon?.src ?? "", /^data:image\/svg\+xml,/, `${order}: ${s.label}`);
  }
  const srcs = ["Name", "Newest", "Rating", "Featured"].map((l) => listSorts(l)[0].icon.src);
  assert.equal(new Set(srcs).size, 4, "Name, Newest, Rating and Featured each look different");
});

test("Section: only the list's groups and sections, and the one picked", () => {
  const rows = [{ section: "Tweaks" }, { section: "Toys" }, { section: "Themes (SpringBoard)" }, { section: "Tweaks" }, {}];
  assert.deepEqual(listSections(rows), { groups: ["Tweaks", "Themes"], sections: ["Themes (SpringBoard)", "Toys", "Tweaks"] });
  assert.deepEqual(listSections(rows, "group:Apps").groups, ["Tweaks", "Themes", "Apps"]);
  assert.deepEqual(listSections([], "Fonts"), { groups: [], sections: ["Fonts"] });
});

test("what the catalog is asked, when Filter looks selected, when the rows are by name, the note", () => {
  const f = { ...emptyFilters(), sort: null };
  assert.equal(refineOptions(f), undefined);
  assert.deepEqual(refineOptions({ ...f, price: "paid", sort: "name" }), { price: "paid", sort: "name" });
  assert.equal(filterOn(f, true), false);
  assert.equal(filterOn({ ...f, section: "group:Themes" }, true), false, "the segment shows it");
  assert.equal(filterOn({ ...f, section: "group:Themes" }, false), true, "no segments to show it");
  assert.equal(filterOn({ ...f, sort: "newest" }, true), true);
  assert.deepEqual([byName(f, true), byName(f, false), byName({ ...f, sort: "name" }, false), byName({ ...f, sort: "newest" }, true)], [true, false, true, false]);
  const n = (o) => listNote({ count: 0, total: 4, filters: f, query: "", empty: "E", ...o });
  assert.equal(n({ count: 2 }), "");
  assert.equal(n({ total: 0, filters: { ...f, price: "paid" } }), "E");
  assert.equal(n({ query: "q" }), "No packages match your search.");
  assert.equal(n({ filters: { ...f, price: "paid" }, query: "q" }), "No packages match your filters.");
});

test("New: day headers in its own order, letters and the index by name; filters join the typed query; Clear Filters", async () => {
  const p = await page();
  assert.ok(p.body.classList.contains("search-root"), "pinned as Search's");
  assert.deepEqual(p.body.children.map((c) => c.className.split(" ")[0]), ["search-bar", "search-scope", "search-results"]);
  assert.equal(p.height(), 4 * ROW + HEAD, "one day");
  assert.equal(p.index(), false);
  await p.open();
  assert.equal(p.button.textContent, "Done");
  const headers = document.body.querySelectorAll(".filter-drop").at(-1).querySelectorAll(".group-header").map((h) => h.textContent);
  assert.deepEqual(headers, ["Sort", "Installed", "Price", "Source", "Section"]);
  for (const s of ["All Tweaks", "All Themes", "All Utilities", "Networking"]) assert.ok(panelRow(s), s);
  assert.equal(panelRow("All Apps"), undefined, "no apps in the list");
  await pick("Name");
  assert.equal(p.height(), 4 * ROW + 4 * HEAD, "A, M, N, Z");
  assert.equal(p.index(), true);
  assert.ok(panelRow("Name").querySelector(".row-icon"), "Sort rows draw their icons");
  await pick("Rating");
  assert.equal(p.height(), 4 * ROW, "no headers");
  assert.equal(p.index(), false);
  await pick("All Tweaks");
  assert.equal(p.height(), 2 * ROW);
  assert.ok(panelRow("All Themes"), "every section of the list is still offered");
  const input = p.body.querySelector("input");
  input.value = "zed";
  p.body.querySelector(".search-bar").dispatchEvent?.({ type: "submit", preventDefault() {} });
  await new Promise((r) => setTimeout(r, 160));
  assert.equal(p.height(), ROW, "the query and the filter together");
  await pick("Paid");
  assert.equal(p.height(), 0);
  assert.equal(p.note.textContent, "No packages match your filters.");
  assert.equal(p.note.hidden, false);
  await pick("Clear Filters");
  assert.equal(p.height(), ROW, "the query stays");
  p.button.click();
  assert.equal(p.button.textContent, "Filter");
  assert.ok(p.button.classList.contains("selected"), "Sort stays");

  const again = await page();
  assert.equal(again.height(), 4 * ROW + HEAD, "a page pushed again starts clean");
  assert.ok(!again.button.classList.contains("selected"));
  assert.equal(p.height(), ROW, "the first page's choice is as it was");
});

test("the segments filter too; a list of one kind has none", async () => {
  const p = await page({ letters: true, headers: null, order: "Name" });
  assert.equal(p.index(), true);
  p.body.querySelectorAll(".scope-segment").find((b) => b.textContent === "Themes").click();
  await tick(); await tick();
  assert.equal(p.height(), ROW + HEAD);
  assert.ok(!p.button.classList.contains("selected"), "the segment shows it");
  const one = await page({ letters: true, oneKind: true });
  assert.equal(one.body.querySelectorAll(".scope-segment").length, 0);
  assert.ok(one.button);
});

test("a choice made while the list is asked again (Show Incompatible) keeps the new list", async () => {
  const p = await page();
  const was = settings.get("worksOnMyPhone");
  await p.open();
  p.rows = listed().filter((r) => r.id === "x.zed" || r.id === "x.mid"); // what the next ask gives
  settings.set("worksOnMyPhone", !was);
  await pick("Name");
  await tick();
  settings.set("worksOnMyPhone", was);
  await tick();
  await tick();
  assert.equal(p.fetched, 3);
  assert.equal(p.height(), 2 * ROW + 2 * HEAD, "the new list, by name");
});

test("Home passes each list's own order and which lists are of one kind", () => {
  const src = readFileSync(new URL("./home.js", import.meta.url), "utf8");
  for (const re of [/fresh\("new"\), headers: dayHeaders, order: "Newest"/, /fresh\("updated"\), headers: dayHeaders, order: "Recently Updated"/,
    /popular\(\), order: "Popular"/, /featuredRows, order: "Featured"/, /free\("apps"\), letters: true, oneKind: true/]) assert.match(src, re);
});
