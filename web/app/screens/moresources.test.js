// F327: More Sources (screens/moresources.js): its routes (#/sources/more, /apps, and the old
// #/sources/manage/recommended), its rows (Find Tweak Sources only where APT repos are kept, Find App Sources, then
// Recommended with Add All and its sub-groups, each row an ADD / ADDED price button), the Sources tab's More Sources
// row and its groups named by content, Home's row, and core/recommended.js's dev / modded tags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, fakePage, memStorage, fakeIndexedDB, tick } from "../fakes.test-helper.js";

globalThis.localStorage = memStorage({ "ifizbox.device": "iphoneos-arm64" }); // Settings > Device: rootless
globalThis.document = fakeDocument();
globalThis.CSS ??= { escape: (s) => String(s) };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.indexedDB = fakeIndexedDB(); // the website's backend (backend-http.js) keeps its sources there
globalThis.fetch = async () => { throw new Error("offline"); }; // first loads fail quietly; the rows stay
delete globalThis.ifizboxNative;
const sources = await import("./sources.js");
const more = await import("./moresources.js");
const { format } = await import("../router.js");
const { rowIcon } = await import("../icons/rowicons.js");
const { RECOMMENDED_SOURCES, recommendedGroups, shortWhy, recGroupOf } = await import("../core/recommended.js");
const { sourceWarning } = await import("../core/warnings.js");
const { APP_SOURCE_DIRECTORY } = await import("../core/appsources.js");

const labels = (el) => el.querySelectorAll(".cell-label").map((n) => n.textContent);
const headers = (el) => el.querySelectorAll(".group-header").map((n) => n.textContent);
const ctx = () => ({ go() {}, setBadge() {}, setTitle() {}, showHUD: () => () => {} });

async function draw(route) {
  const body = fakePage();
  const c = ctx();
  const bar = sources.nav(route, c);
  await sources.render(body, route, c);
  // the website's backend answers through the fake IndexedDB: wait for the rows (and the icons' and badge's reads)
  for (let i = 0; i < 400 && !body.querySelectorAll(".cell-label").length; i++) await tick();
  for (let i = 0; i < 10; i++) await tick();
  return { body, bar };
}

const asDevice = async (type, f) => {
  const was = globalThis.localStorage.getItem("ifizbox.device");
  globalThis.localStorage.setItem("ifizbox.device", type);
  try { return await f(); } finally { globalThis.localStorage.setItem("ifizbox.device", was); }
};

test("F327: #/sources/more is More Sources: the Find rows, then Recommended with Add All and three sub-groups", async () => {
  const route = { tab: "sources", path: ["more"] };
  assert.equal(format(route), "#/sources/more");
  assert.equal(more.moreHref(), "#/sources/more");
  const { body, bar } = await draw(route);
  assert.equal(bar.title, "More Sources");
  assert.equal(bar.right, undefined, "Add All left the nav bar");
  const rows = labels(body);
  assert.deepEqual(rows.slice(0, 2), ["Find Tweak Sources", "Find App Sources"]);
  const find = body.querySelectorAll(".more-find-row");
  assert.equal(find[0].querySelector("a").href, "#/sources/manage/find", "Find Tweak Sources opens F305's Canister page");
  assert.equal(find[1].querySelector("a").href, "#/sources/more/apps");
  assert.equal(body.querySelectorAll(".more-find-icon img")[0].src, more.TWEAKS_ICON);
  assert.equal(body.querySelectorAll(".more-find-icon img")[1].src, more.APPS_ICON);
  assert.equal(body.querySelectorAll(".more-find-icon .more-plus").length, 2, "each Find icon has its green plus");
  const head = body.querySelector(".rec-head-title");
  assert.ok(head.textContent.startsWith("Recommended"));
  const addAll = head.querySelector("button");
  assert.ok(addAll.classList.contains("bar-button"), "Add All is drawn as the nav bar's .bar-button");
  assert.equal(addAll.textContent, "Add All");
  assert.deepEqual(headers(body).filter((h) => h !== head.textContent), ["Tweak Sources", "From the Developer", "Modded Apps"]);
  const buttons = body.querySelectorAll(".rec-more-row .price-btn");
  assert.equal(buttons.length, body.querySelectorAll(".rec-more-row").length, "every recommended row has the price button");
  assert.ok(buttons.every((b) => b.textContent === "ADD" || b.textContent === "ADDED"));
  assert.equal(body.querySelectorAll(".rec-get").length, 0, "no blue pill");
  assert.ok(rows.includes("Jailbreak"), "the jailbreak pick stays, under Tweak Sources");
  // the two-line why without the name it starts with
  const havoc = body.querySelectorAll(".rec-more-row").find((li) => li.querySelector(".cell-label").textContent === "Havoc");
  assert.match(havoc.querySelector(".cell-subtitle").textContent, /^Over 500/);
});

test("F327: the old #/sources/manage/recommended route still opens More Sources; its previews stay Manage's", async () => {
  const { body, bar } = await draw({ tab: "sources", path: ["manage", "recommended"] });
  assert.equal(bar.title, "More Sources");
  assert.ok(labels(body).includes("Find App Sources"));
  assert.equal(more.isMore({ tab: "sources", path: ["manage", "recommended", "alt:https://x.test/"] }), false);
});

test("F327: Not Jailbroken: no Find Tweak Sources and no Tweak Sources group, only the app ones", async () => {
  await asDevice("none", async () => {
    const { body } = await draw({ tab: "sources", path: ["more"] });
    const rows = labels(body);
    assert.equal(rows[0], "Find App Sources");
    assert.ok(!rows.includes("Find Tweak Sources") && !rows.includes("Jailbreak"));
    assert.ok(!headers(body).includes("Tweak Sources"));
    assert.ok(headers(body).includes("From the Developer") && headers(body).includes("Modded Apps"));
  });
  // the sideload app keeps Tweak Sources (F302), so it keeps Find Tweak Sources (F305's page): findMoreOn
  assert.equal(more.findRows({ tweaks: true })[0].label, "Find Tweak Sources");
  assert.deepEqual(more.findRows({ tweaks: false }).map((r) => r.label), ["Find App Sources"]);
});

test("B272: Find App Sources lists Recommended's app sources and the directory's, in From the Developer / Modded Apps", async () => {
  const { body, bar } = await draw({ tab: "sources", path: ["more", "apps"] });
  assert.equal(bar.title, "App Sources");
  const names = body.querySelectorAll(".rec-more-row .cell-label").map((n) => n.textContent);
  const apps = [...RECOMMENDED_SOURCES.filter((r) => !r.jailbreak), ...APP_SOURCE_DIRECTORY].map((r) => r.name);
  assert.ok(names.length > 0 && names.every((n) => apps.includes(n)), names.join(", "));
  for (const r of [...RECOMMENDED_SOURCES.filter((x) => !x.jailbreak), ...APP_SOURCE_DIRECTORY]) assert.ok(names.includes(r.name), r.name);
  // added ones stay, with ADDED (this file's other tests add some); the rest say ADD (findappsources.test.js checks
  // which is which)
  const btns = body.querySelectorAll(".rec-more-row .price-btn").map((b) => b.textContent);
  assert.equal(btns.length, names.length);
  assert.ok(btns.every((t) => t === "ADD" || t === "ADDED"), btns.join(", "));
  assert.ok(btns.includes("ADD"));
  assert.deepEqual(headers(body), ["From the Developer", "Modded Apps"]);
});

test("F327: the Sources tab: More Sources under All Sources (plus tile, no green badge), no Recommended or Find More rows", () => {
  const row = more.moreRow();
  assert.equal(row.label, "More Sources");
  assert.equal(row.href, "#/sources/more");
  assert.deepEqual(row.icon, rowIcon("moreSources"));
  // The root list in the fake DOM needs the pull-to-refresh markup (screens/rootcopies.test.js builds that); the
  // wiring is read here, the drawn tab is in the journal's 3x renders.
  const src = readFileSync(new URL("./sources.js", import.meta.url), "utf8");
  assert.match(src, /href: format\(\{ tab: "sources", path: \["\*"\] \}\),\n  \}, moreSourcesRow\(\)\];/);
  assert.match(src, /moreBadge\(cells\[1\]\)/, "its badge: the recommended sources not added yet");
  assert.doesNotMatch(src, /findMoreRow|recommendedRow|Individual Sources/);
});

test("F327: the Sources list's groups are named by what they hold", () => {
  const apt = (k) => ({ key: `deb:https://${k}.test/:./` });
  const alt = (k) => ({ key: `alt:https://${k}.test/a.json` });
  const shown = [apt("a"), alt("b"), apt("c")];
  const g = sources.sourceGroups({ shown, list: shown });
  assert.deepEqual(g.map((x) => [x.header, x.list.length]), [["Tweak Sources", 2], ["App Sources", 1]]);
  assert.deepEqual(sources.sourceGroups({ shown: [alt("b")], list: [alt("b")] }).map((x) => x.header), ["App Sources"]);
  // the sideload app: App Sources, then its Tweak Sources (F302)
  const lite = sources.sourceGroups({ shown: [alt("b")], list: [alt("b")], tweakShown: [apt("a")], tweakList: [apt("a")], sideload: true });
  assert.deepEqual(lite.map((x) => [x.header, x.tweak]), [["App Sources", false], ["Tweak Sources", true]]);
  // searching: each header counts
  const s = sources.sourceGroups({ shown, list: [shown[0]], searching: true });
  assert.deepEqual(s.map((x) => x.header), ["Tweak Sources: 1 of 2", "App Sources: 0 of 1"]);
  assert.ok(!readFileSync(new URL("./sources.js", import.meta.url), "utf8").includes("AltStore Sources"));
});

test("F327/B295: Home opens More Sources from its green tile, not a list row, at #/sources/more", async () => {
  const { homeLinks, MORE_SOURCES_TILE } = await import("./home.js");
  assert.equal(MORE_SOURCES_TILE.label, "More Sources");
  assert.equal(MORE_SOURCES_TILE.href, "#/sources/more");
  const rows = homeLinks().flatMap((g) => g.rows);
  assert.ok(!rows.some((r) => r.label === "More Sources" || r.label === "Recommended Sources"));
});

test("F327: every recommended app source is tagged dev or modded; no source on the piracy list", () => {
  for (const r of RECOMMENDED_SOURCES) {
    if (r.jailbreak) assert.equal(r.tag, undefined, r.name);
    else assert.ok(r.tag === "dev" || r.tag === "modded", `${r.name}: ${r.tag}`);
    assert.equal(sourceWarning(r.url), null, `${r.name} is not a piracy source`);
  }
  assert.deepEqual(RECOMMENDED_SOURCES.filter((r) => r.tag === "modded").map((r) => r.name), ["YouMod", "Unbound", "RyukGram"]);
  const rows = RECOMMENDED_SOURCES.map((rec) => ({ rec }));
  assert.deepEqual(recommendedGroups(rows).map((g) => g.id), ["tweaks", "dev", "modded"]);
  assert.equal(recGroupOf({ jailbreak: true, tag: "modded" }), "tweaks");
  assert.equal(shortWhy({ name: "Havoc", why: "Havoc: over 500 tweaks." }), "Over 500 tweaks.");
  assert.equal(shortWhy({ name: "X", why: "Over 20 apps." }), "Over 20 apps.");
});

test("F327: the More Sources badge counts the recommended sources not added yet", async () => {
  const { recRows } = await import("./manage.js");
  const rows = await recRows();
  assert.equal(await more.notAddedCount(), rows.filter((r) => !r.added).length);
  assert.ok(rows.length > 0);
});
