// F352: the Add Tweaks page (browse.js renderAddTweaks, pushed under an app's page): its groups (Added, Made for <app>,
// Works in Any App), the search bar's filter, the price button's ADD / ADDED, More Tweaks with one footer, and the app
// page's row pushing the page instead of the sheet.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addTweaksItems, addTweakButton, moreTweaksGroup, addTweaksGroup, pushAddTweaks, addTweaksToken, addTweaksAppName,
  savedTweaks, saveTweaks } from "./tweaks.js";
import { parseToken, pageOf, nav } from "./browse.js";
import { memoryIpaStore } from "../core/myipas.js";
import { fakeDocument, tick, withDocument } from "../fakes.test-helper.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`../core/fixtures/tweaks/${n}`, import.meta.url)));
const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const memStore = () => { const mem = memoryIpaStore(); return async () => mem; };
const doc = Object.assign(fakeDocument(), { head: { append() {} } });
const withDoc = (f) => withDocument(f, doc);

const made = [
  { id: "com.a.ytlite", name: "YTLite", version: "5.0", short: "Background play and downloads", author: "dayanch96", key: "k1" },
  { id: "com.a.rydislike", name: "Return YouTube Dislike", version: "1.2", short: "Dislikes are back", author: "PoomSmart", key: "k1" },
];
const any = [{ id: "com.b.flex", name: "FLEXing", version: "1.4", short: "Inspect any app", author: "NSExceptional", key: "k2" }];
const kept = (...names) => names.map((n) => ({ name: n, data: new Uint8Array([1]) }));
const shape = (items) => items.map((x) => x.header ?? x.id);

test("Add Tweaks' groups: Added first (listed, then from Files), then Made for <app>, then Works in Any App", () => {
  assert.deepEqual(shape(addTweaksItems({ made, any, appName: "YouTube" })),
    ["Made for YouTube", "com.a.ytlite", "com.a.rydislike", "Works in Any App", "com.b.flex"]);
  const items = addTweaksItems({ made, any, kept: kept("com.a.rydislike_1.2.deb", "Mine.dylib"), appName: "YouTube" });
  assert.deepEqual(shape(items), ["Added", "com.a.rydislike", "file:Mine.dylib", "Made for YouTube", "com.a.ytlite", "Works in Any App", "com.b.flex"]);
  assert.equal(items[1].added, true);
  assert.equal(items[1].key, "k1", "the row keeps its Tweak Source, for its page");
  assert.equal(items[2].file, "Mine.dylib");
  assert.equal(items[2].added, true);
  assert.equal(items[4].added, undefined);
  // an empty group has no header; no app name: This App
  assert.deepEqual(shape(addTweaksItems({ made: [], any })), ["Works in Any App", "com.b.flex"]);
  assert.deepEqual(shape(addTweaksItems({ made })), ["Made for This App", "com.a.ytlite", "com.a.rydislike"]);
  assert.deepEqual(addTweaksItems({}), []);
});

test("Add Tweaks' search filters by name, description and author, in every group", () => {
  const k = kept("com.b.flex_1.4.deb");
  assert.deepEqual(shape(addTweaksItems({ made, any, kept: k, query: "ytl", appName: "YouTube" })), ["Made for YouTube", "com.a.ytlite"]);
  assert.deepEqual(shape(addTweaksItems({ made, any, kept: k, query: "dislikes" })), ["Made for This App", "com.a.rydislike"]);
  assert.deepEqual(shape(addTweaksItems({ made, any, kept: k, query: "poomsmart" })), ["Made for This App", "com.a.rydislike"]);
  assert.deepEqual(shape(addTweaksItems({ made, any, kept: k, query: "inspect" })), ["Added", "com.b.flex"]);
  assert.deepEqual(addTweaksItems({ made, any, query: "nothing like it" }), []);
});

test("Add Tweaks' price button: ADD turns ADDED with a spinner at once, keeps the .deb once checked; ADDED offers Remove", () => withDoc(async () => {
  const store = memStore();
  const s = storage();
  s.setItem("ifizbox.tweakInfo", JSON.stringify({ "com.me.fixture@1.0": { ok: true, bundles: ["com.me.app"] } }));
  const r = { id: "com.me.fixture", name: "Fixture", version: "1.0", key: "k1" };
  const st = { package: "com.me.fixture", name: "Fixture", version: "1.0", debUrl: "https://repo.x/fixture.deb", depends: "mobilesubstrate" };
  let release, changes = 0;
  const gate = new Promise((ok) => { release = ok; });
  const opts = { bundleId: "com.me.app", cls: "price-btn tw-row-add", onCls: "added", busyCls: "adding", store, storage: s,
    pkg: async () => st, fetchDeb: async () => { await gate; return fx("tweak-xz.deb"); }, alert: async () => {}, onChange: () => { changes++; } };
  const btn = addTweakButton(r, opts);
  assert.ok(btn.classList.contains("price-btn"));
  assert.equal(btn.textContent, "ADD");
  const tap = btn.fire("click");
  assert.ok(btn.classList.contains("added") && btn.classList.contains("adding"), "ADDED at once, busy");
  // the row drawn again while it's being added (a recycled list row): the spinner too, and a tap does nothing
  const again = addTweakButton(r, opts);
  assert.ok(again.classList.contains("adding"));
  release();
  await tap;
  assert.equal(btn.textContent, "ADDED");
  assert.equal(btn.classList.contains("adding"), false);
  assert.equal(changes, 1);
  assert.deepEqual((await savedTweaks("com.me.app", { store })).map((x) => x.title), ["Fixture"]);
  assert.equal(addTweakButton(r, opts).classList.contains("adding"), false, "done: drawn plainly again");

  // ADDED: Remove from the action sheet
  const sheets = [];
  const on = addTweakButton(r, { ...opts, on: true, sheet: async (o) => { sheets.push(o); return 0; } });
  assert.equal(on.textContent, "ADDED");
  await on.fire("click");
  assert.deepEqual(sheets[0].buttons, ["Remove"]);
  assert.deepEqual(await savedTweaks("com.me.app", { store }), []);

  // a tweak from Files: Remove drops that file
  await saveTweaks("com.me.app", kept("Mine.dylib", "Other.dylib"), { store });
  const file = addTweaksItems({ kept: await savedTweaks("com.me.app", { store }) })[1];
  await addTweakButton(file, { ...opts, on: true, sheet: async () => 0 }).fire("click");
  assert.deepEqual((await savedTweaks("com.me.app", { store })).map((x) => x.name), ["Other.dylib"]);
}));

test("Add Tweaks' price button: a failed check turns it back to ADD, with words", () => withDoc(async () => {
  const store = memStore();
  const alerts = [];
  const r = { id: "com.me.gone", name: "Gone", version: "1" };
  const btn = addTweakButton(r, { bundleId: "com.me.app", onCls: "added", store, storage: storage(), pkg: async () => null,
    alert: async (o) => { alerts.push(o); } });
  await btn.fire("click");
  assert.equal(btn.textContent, "ADD");
  assert.equal(btn.classList.contains("added"), false);
  assert.equal(alerts[0].title, "Can't Add This Tweak");
  assert.deepEqual(await savedTweaks("com.me.app", { store }), []);
}));

test("More Tweaks: Browse Tweak Sources, Search All Repos, From Files, and one short footer", () => withDoc(async () => {
  const opened = [];
  const g = moreTweaksGroup({ bundleId: "com.me.app", name: "YouTube", store: memStore(), browse: (o) => opened.push(["browse", o.bundleId]),
    searchAll: (o) => opened.push(["search", o.appName]) });
  assert.match(g.textContent, /More Tweaks.*Browse Tweak Sources.*Search All Repos.*From Files…/);
  const feet = g.querySelectorAll(".group-footer");
  assert.equal(feet.length, 1);
  assert.equal(feet[0].textContent, "Only tweaks that work in YouTube without a jailbreak are listed.");
  for (const b of g.querySelectorAll("button")) await b.fire("click");
  assert.deepEqual(opened, [["browse", "com.me.app"], ["search", "YouTube"]]);
}));

test("the app page's Add Tweaks row pushes the Add Tweaks page; its detail counts, no footer names tweaks", () => withDoc(async () => {
  const s = storage();
  s.setItem("ifizbox.tweakInfo", JSON.stringify({ "com.t.yt@2": { ok: true, bundles: ["com.x.tube"] } }));
  const pushed = [];
  const g = addTweaksGroup({ bundleId: "com.x.tube", name: "Tube", rows: async () => [{ id: "com.t.yt", name: "YTLite", version: "2" }],
    store: memStore(), storage: s, push: (id) => pushed.push(id) });
  await g.ready;
  assert.equal(g.el.querySelectorAll(".cell-detail")[0].textContent, "1 for This App");
  assert.doesNotMatch(g.el.textContent, /YTLite/);
  await g.el.querySelectorAll("button")[0].fire("click");
  await tick();
  assert.deepEqual(pushed, ["com.x.tube"]);
  assert.equal(addTweaksAppName("com.x.tube"), "Tube");
}));

test("the Add Tweaks route: addtweaks:<bundle id> under the app's page, its tweak pages in their Tweak Source", () => {
  const loc = { hash: "#sources/alt%3Ax/package%3Acom.x.tube/" };
  pushAddTweaks("com.x.tube", loc);
  assert.equal(loc.hash, "#sources/alt%3Ax/package%3Acom.x.tube/addtweaks%3Acom.x.tube");
  assert.deepEqual(parseToken(addTweaksToken("com.x.tube")), { kind: "addtweaks", value: "com.x.tube" });
  const route = { tab: "sources", path: ["alt:x", "package:com.x.tube", "addtweaks:com.x.tube"] };
  assert.deepEqual(pageOf(route), { key: "alt:x", page: "addtweaks", value: "com.x.tube" });
  assert.equal(nav(route).title, "Add Tweaks");
  // a tweak opened from it: package:<id>@<its source>, in the Sources tab too
  assert.deepEqual(pageOf({ tab: "sources", path: ["alt:x", "package:com.x.tube", "addtweaks:com.x.tube", "package:com.t.yt@k1"] }),
    { key: "k1", page: "package", value: "com.t.yt" });
});
