// B272: Find Tweak Sources (screens/findmore.js): Add All in the nav bar (one action sheet, then each listed repo not
// added yet under a counting HUD, as Import), no ↗ character on the directory row, and repo names shown as plain
// text (core/plaintext.js through core/canister.js repoFrom).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, fakePage } from "../nav/fakedom.test-helper.js";
import { PIRACY_HOSTS } from "../core/piracy-list.js";
import { mapRepos } from "../core/canister.js";
import { plainText } from "../core/plaintext.js";
import { addAllListed, nav, renderFind } from "./findmore.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`../core/fixtures/f305/${n}.json`, import.meta.url), "utf8"));
const rank1 = fx("ranking-1"), rank2 = fx("ranking-2");

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const repo = (name, uri, added = false) => ({ name, uri, flat: true, dist: "./", components: [], added, slug: name.toLowerCase(), key: `deb:${uri}:./` });

function rig({ pick = 0, fail = [] } = {}) {
  const log = { added: [], sheets: [], alerts: [], hud: [], changed: 0, redrawn: 0, hidden: 0 };
  const opts = {
    backend: { addSource: async (i) => { const u = typeof i === "string" ? i : i.uri; if (fail.includes(u)) throw new Error("No Release file"); log.added.push(u); return {}; } },
    sheet: async (s) => { log.sheets.push(s); return pick; },
    alert: async (a) => { log.alerts.push(a); return { index: 0 }; },
    hud: (t) => { log.hud.push(t); return { set: (x) => log.hud.push(x), hide: () => log.hidden++, done() {} }; },
    changed: () => log.changed++,
    redraw: () => log.redrawn++,
  };
  return { log, opts };
}

test("B272: the Find More page has Add All top right; a repo's page keeps Add", () => {
  const bar = nav({ tab: "sources", path: ["manage", "find"] }, null);
  assert.equal(bar.right.label, "Add All");
  assert.equal(typeof bar.right.onClick, "function");
  assert.equal(nav({ tab: "sources", path: ["manage", "find", "chariz"] }, null).right.label, "Add");
});

test("B272: Add All asks once, adds every listed repo not added yet in turn, counting, and redraws", async () => {
  const rows = [repo("A", "https://a.example/"), repo("B", "https://b.example/", true), repo("C", "https://c.example/"),
    repo("Bad", `https://${PIRACY_HOSTS[0]}/`)];
  const { log, opts } = rig();
  assert.equal(await addAllListed("ctx", { rows, ...opts }), 2);
  assert.equal(log.sheets.length, 1, "one confirm");
  assert.match(log.sheets[0].title, /the 2 repos/);
  assert.deepEqual(log.sheets[0].buttons, ["Add All"]);
  assert.deepEqual(log.added, ["https://a.example/", "https://c.example/"], "the added one and the piracy one are skipped");
  assert.deepEqual(log.hud, ["Adding 1 of 2", "Adding 1 of 2", "Adding 2 of 2"]);
  assert.equal(log.hidden, 1);
  assert.equal(log.changed, 1, "Sources hears of it once");
  assert.equal(log.redrawn, 1);
  assert.deepEqual(log.alerts, [], "no alert when every add worked");
  assert.ok(rows[0].added && rows[2].added);
});

test("B272: Add All: Cancel adds nothing; nothing left says so; failures are named in one alert", async () => {
  const rows = [repo("A", "https://a.example/"), repo("C", "https://c.example/")];
  const cancel = rig({ pick: -1 });
  assert.equal(await addAllListed(null, { rows, ...cancel.opts }), 0);
  assert.deepEqual(cancel.log.added, []);
  assert.equal(cancel.log.hud.length, 0);
  const none = rig();
  assert.equal(await addAllListed(null, { rows: [repo("B", "https://b.example/", true)], ...none.opts }), 0);
  assert.equal(none.log.sheets.length, 0);
  assert.match(none.log.alerts[0].message, /Every repo listed here is in your sources/);
  const bad = rig({ fail: ["https://c.example/"] });
  assert.equal(await addAllListed(null, { rows, ...bad.opts }), 1);
  assert.equal(bad.log.alerts.length, 1);
  assert.equal(bad.log.alerts[0].title, "Some Sources Failed");
  assert.match(bad.log.alerts[0].message, /Added 1 of 2\.\n\nC: No Release file/);
});

test("B272: the page's Add All works on the rows it shows", async () => {
  const api = { ranking: async (r) => (r === 1 ? rank1 : r === 2 ? rank2 : { data: [] }), repos: async () => rank1 };
  const f = renderFind(fakePage(), null, { api, sources: async () => [] });
  await f.ready;
  const shown = f.el.querySelectorAll(".find-row").length;
  const { log, opts } = rig({ pick: -1 });
  const { rows: _r, redraw: _d, ...rest } = opts;
  await addAllListed(null, rest);
  assert.match(log.sheets[0].title, new RegExp(`the ${shown} repos`));
});

test("B272: the directory row's outside mark is drawn, never the ↗ character (iOS draws it as an emoji)", async () => {
  const api = { ranking: async (r) => (r === 1 ? rank1 : { data: [] }) };
  const f = renderFind(fakePage(), null, { api, sources: async () => [] });
  await f.ready;
  assert.ok(f.el.querySelector(".find-directory .find-external"));
  assert.doesNotMatch(f.el.textContent, /[←-⇿⬀-⯿]/);
  assert.doesNotMatch(readFileSync(new URL("./findmore.js", import.meta.url), "utf8"), /"↗"/);
});

test("B272: emoji and arrows in a repo's name and description are dropped; plain text stays as it is", () => {
  assert.equal(plainText("NSCake 🧁"), "NSCake");
  assert.equal(plainText("⬇️ Limneos Repo"), "Limneos Repo");
  assert.equal(plainText("Repo ➡ Tweaks"), "Repo Tweaks");
  assert.equal(plainText("👨‍👩‍👧 Family 🇺🇸 Repo 👍🏽"), "Family Repo");
  assert.equal(plainText("中文 Repo – Ünïcode (beta)"), "中文 Repo – Ünïcode (beta)");
  assert.equal(plainText("🧁"), "🧁", "a name made only of emoji keeps them rather than going blank");
  assert.equal(plainText(null), null);
  const [r] = mapRepos({ data: [{ id: "nscake", uri: "https://nscake.github.io/", suite: "./", name: "NSCake 🧁", description: "Cakes ✨ for you",
    package_count: 1 }] });
  assert.equal(r.name, "NSCake");
  assert.equal(r.description, "Cakes for you");
});

// B344: App Sources (Find More for apps, screens/moresources.js) is the same page: Find More's plain list and rows,
// a search bar, and the same Add All in the nav bar over the rows it shows.
async function appSources() {
  const { memStorage, fakeIndexedDB } = await import("../fakes.test-helper.js");
  globalThis.localStorage ??= memStorage({ "ifizbox.device": "none" });
  globalThis.indexedDB ??= fakeIndexedDB();
  globalThis.CSS ??= { escape: (s) => String(s) };
  const more = await import("./moresources.js");
  const { RECOMMENDED_SOURCES } = await import("../core/recommended.js");
  const { recommendedRows } = await import("../core/sourcelist.js");
  const { findAppSources } = await import("../core/appsources.js");
  const rows = recommendedRows(findAppSources(RECOMMENDED_SOURCES), [], { jailbroken: false });
  rows[0].added = true;
  return { more, rows };
}

test("B344: App Sources has Find More's Add All top right and draws Find More's list, rows and ADD", async () => {
  const { more, rows } = await appSources();
  const bar = more.nav({ tab: "sources", path: ["more", "apps"] }, null);
  assert.equal(bar.right.label, "Add All");
  assert.equal(typeof bar.right.onClick, "function");
  const box = fakePage();
  await more.drawApps(box, null, { rows: async () => rows, preview: async () => null });
  const list = box.querySelector("ul.table.plain.find-list");
  assert.ok(list, "one plain list, as Find More's");
  assert.deepEqual(list.querySelectorAll(".section-header").map((h) => h.textContent), ["From the Developer", "Modded Apps"]);
  const cells = list.querySelectorAll(".find-row");
  assert.equal(cells.length, rows.length);
  assert.ok(cells.every((li) => li.classList.contains("source-row") && li.querySelector(".price-btn.find-add")));
  assert.ok(box.querySelector(".find-credit"), "the footer under the list");
});

test("B344: App Sources' Add All asks once, adds each shown source not added yet, counting, and names failures", async () => {
  const { more, rows } = await appSources();
  const box = fakePage();
  await more.drawApps(box, null, { rows: async () => rows, preview: async () => null });
  const todo = rows.filter((r) => !r.added);
  const failing = typeof todo[1].input === "string" ? todo[1].input : todo[1].input.uri;
  const { log, opts } = rig({ fail: [failing] });
  const { rows: _r, redraw: _d, ...rest } = opts;
  assert.equal(await more.addAllApps(null, rest), todo.length - 1);
  assert.equal(log.sheets.length, 1);
  assert.match(log.sheets[0].title, new RegExp(`the ${todo.length} sources listed here`));
  assert.deepEqual(log.sheets[0].buttons, ["Add All"]);
  assert.equal(log.added.length, todo.length - 1);
  assert.equal(log.hud.at(-1), `Adding ${todo.length} of ${todo.length}`);
  assert.equal(log.changed, 1);
  assert.equal(log.alerts[0].title, "Some Sources Failed");
  assert.match(log.alerts[0].message, new RegExp(`${todo[1].label}: No Release file`));
  const none = rig();
  assert.equal(await more.addAllApps(null, { ...none.opts, rows: [rows[0]] }), 0);
  assert.equal(none.log.sheets.length, 0);
  assert.match(none.log.alerts[0].message, /Every source listed here is in your sources/);
});

test("B344: App Sources' search keeps the rows that match, and Add All works on those", async () => {
  const { more, rows } = await appSources();
  const pick = rows.find((r) => !r.added);
  const box = fakePage();
  await more.drawApps(box, null, { rows: async () => rows, preview: async () => null, query: pick.label.toUpperCase() });
  const shown = box.querySelectorAll(".find-row .cell-label").map((n) => n.textContent);
  assert.ok(shown.includes(pick.label) && shown.length < rows.length, shown.join(", "));
  const { log, opts } = rig({ pick: -1 });
  const { rows: _r, redraw: _d, ...rest } = opts;
  await more.addAllApps(null, rest);
  const n = rows.filter((r) => !r.added && shown.includes(r.label)).length;
  assert.match(log.sheets[0].title, new RegExp(n === 1 ? "the 1 source " : `the ${n} sources`));
  await more.drawApps(box, null, { rows: async () => rows, preview: async () => null, query: "zzzz-nothing" });
  assert.match(box.textContent, /No app sources found/);
});
