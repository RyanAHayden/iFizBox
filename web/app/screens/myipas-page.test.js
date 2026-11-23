// F224: Install IPAs' list (screens/myipas.js): Not Installed and Installed groups (F392: no button on a row), a left swipe's Delete (at once, no sheet), Manage's circles, Select… presets and toolbar runs
// (Sign, Unsign keeping the file, Delete) against a fake library, and which IPAs iOS has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryGroup, swipeDelete, deleteMany, selectButton, runManage, signMany, installedOf,
  sharedInstalls, sharedSections, confirmReplace } from "./myipas.js";
import { listState, memoryIpaStore, siteEntries } from "../core/myipas.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

function withDom(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = fakeDom();
  const done = () => { if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document; };
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  return Promise.resolve(out).finally(done);
}

const MB = 1048576;
const LIST = [
  { file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 10 * MB, signed: null },
  { file: "Alpha.ipa", name: "Alpha", bundleId: "com.x.alpha", version: "2.0", size: 20 * MB, signed: { at: "2026-11-18T00:00:00Z", bundleId: "com.x.alpha" } },
  { file: "Broken.ipa", name: "Broken", size: 1 * MB, error: "not a zip" },
];
const INSTALLED = { "com.x.alpha": true };

function tap(ul, target) {
  let stopped = false;
  ul.fire("click", { target, preventDefault() { stopped = true; }, stopPropagation() {} });
  return !stopped; // true: the row's link opens
}
const swipe = (ul, li, dx) => {
  const target = li.querySelector(".cell-label");
  ul.fire("pointerdown", { target, clientX: 200, clientY: 10 });
  ul.fire("pointermove", { target, clientX: 200 + dx, clientY: 12 });
};
const groupsOf = (g) => g.el.querySelectorAll(".group").map((x) => ({
  header: x.querySelector(".group-header")?.textContent ?? null,
  rows: x.querySelectorAll(".cell").map((li) => li.dataset.file),
  footer: x.querySelector(".group-footer")?.textContent ?? null,
}));

test("F224: Not Installed then Installed, A-Z, each row's line, no button (F392); the footer under the last", () => withDom(() => {
  const g = libraryGroup(LIST, { site: false, jailbreak: false, installed: INSTALLED });
  const gs = groupsOf(g);
  assert.deepEqual(gs.map((x) => [x.header, x.rows]), [["Not Installed", ["Broken.ipa", "Delta.ipa"]], ["Installed", ["Alpha.ipa"]]]);
  assert.equal(gs[0].footer, null);
  assert.match(gs[1].footer, /share an \.ipa to iFizBox from Files, Safari or Mail/);
  const delta = g.cellOf("Delta.ipa");
  assert.equal(delta.querySelector(".cell-subtitle").textContent, "Version 1.5 · 10.0 MB · Not signed");
  for (const f of ["Delta.ipa", "Alpha.ipa", "Broken.ipa"]) assert.equal(g.cellOf(f).querySelector(".price-btn"), null, f);
  assert.ok(delta.querySelector(".cell-inner").classList.contains("chevron"), "the chevron to the IPA's page");
  assert.equal(delta.querySelector(".cell-inner").href, "#/installed/myipas/ipa%3ADelta.ipa");
  // empty, and a search with no match
  assert.match(groupsOf(libraryGroup([], { site: false, jailbreak: false }))[0].footer, /^No IPAs yet/);
  assert.equal(groupsOf(libraryGroup(LIST, { site: false, jailbreak: false, query: "zzz" }))[0].footer, "No Results");
  // F212: the jailbreak app's rows say nothing about signing
  const jb = libraryGroup(LIST, { site: false, jailbreak: true });
  assert.equal(jb.cellOf("Delta.ipa").querySelector(".cell-subtitle").textContent, "Version 1.5 · 10.0 MB");
}));

test("F224: a left swipe shows Delete; its tap deletes at once (no sheet); a tap elsewhere hides it", () => withDom(async () => {
  const asked = [];
  const g = libraryGroup(LIST, { site: false, jailbreak: false, installed: INSTALLED, on: { delete: (es) => asked.push(es.map((e) => e.file)) } });
  const a = g.cellOf("Alpha.ipa"), d = g.cellOf("Delta.ipa");
  assert.ok(tap(g.ul, d.querySelector(".cell-label")), "a plain tap opens the IPA's page");
  swipe(g.ul, d, -60);
  assert.ok(d.classList.contains("armed"));
  tap(g.ul, d.querySelector(".cell-label")); // the lift that ends the swipe
  assert.ok(!tap(g.ul, a.querySelector(".cell-label")), "with a Delete showing, a tap only hides it");
  assert.ok(!d.classList.contains("armed"));
  swipe(g.ul, d, -60);
  d.querySelector(".del-confirm").click();
  assert.deepEqual(asked, [["Delta.ipa"]]);
  // the delete itself: library.delete (the IPA and its signed copy) without asking
  const calls = [];
  const r = await swipeDelete([g.rows.find((x) => x.file === "Delta.ipa")], { isSite: false,
    call: async (m, p) => { calls.push([m, p.file]); return { ipas: [] }; }, alert: async () => assert.fail("no alert") });
  assert.deepEqual(calls, [["delete", "Delta.ipa"]]);
  assert.deepEqual(r.deleted, ["Delta.ipa"]);
}));

test("F224: Manage: circles slide in, swipes are off, taps pick (nothing opens), Done drops the pick", () => withDom(() => {
  const g = libraryGroup(LIST, { site: false, jailbreak: false, installed: INSTALLED });
  const d = g.cellOf("Delta.ipa"), a = g.cellOf("Alpha.ipa");
  assert.ok(d.querySelector(".manage-check") && d.classList.contains("manage-row"));
  g.step({ type: "edit" });
  assert.ok(g.ul.classList.contains("managing"));
  swipe(g.ul, d, -60);
  assert.ok(!d.classList.contains("armed"), "no swipe while managing");
  assert.ok(!tap(g.ul, d.querySelector(".cell-label")), "a tap picks, nothing opens");
  assert.ok(d.classList.contains("picked"));
  assert.ok(!tap(g.ul, d.querySelector(".cell-label")));
  assert.ok(!d.classList.contains("picked"), "a second tap unpicks");
  assert.ok(!tap(g.ul, a.querySelector(".cell-label")));
  assert.ok(a.classList.contains("picked"));
  assert.deepEqual(g.state.selected, ["Alpha.ipa"]);
  g.step({ type: "done" });
  assert.ok(!g.ul.classList.contains("managing") && !a.classList.contains("picked"));
  assert.ok(tap(g.ul, a.querySelector(".cell-label")), "out of Manage a tap opens again");
}));

test("F224: Select… sheet: All IPAs / Not Installed (n) / Signed (n) replace the pick; Deselect drops it", () => withDom(async () => {
  const g = libraryGroup(LIST, { site: false, jailbreak: false, installed: INSTALLED });
  g.step({ type: "edit" });
  const sheets = [];
  assert.equal(await selectButton({ ctl: g, sheet: async (s) => { sheets.push(s.buttons); return 1; } }), "notInstalled");
  assert.deepEqual(sheets[0], ["All IPAs", "Not Installed (2)", "Signed (1)"]);
  assert.deepEqual(g.state.selected, ["Broken.ipa", "Delta.ipa"]);
  assert.equal(await selectButton({ ctl: g, sheet: async () => 2 }), "signed");
  assert.deepEqual(g.state.selected, ["Alpha.ipa"], "a preset replaces the pick");
  assert.equal(await selectButton({ ctl: g, sheet: async () => -1 }), null);
  assert.equal(await selectButton({ ctl: g, sheet: async () => 0 }), "all");
  assert.equal(g.state.selected.length, 3);
  assert.equal(await selectButton({ ctl: g, sheet: async () => assert.fail("Deselect asks nothing") }), "none");
  assert.deepEqual(g.state.selected, []);
}));

// A fake library backend: the IPA files and their signed copies, as the shell keeps them.
function fakeLibrary(entries) {
  const files = new Map(entries.map((e) => [e.file, { ...e }]));
  const calls = [];
  const call = async (method, { file }) => {
    calls.push([method, file]);
    const e = files.get(file);
    if (!e) throw Object.assign(new Error(`${file} isn't in My IPAs any more.`), { code: "gone" });
    if (method === "unsign") e.signed = null;
    else if (method === "delete") files.delete(file);
    else throw new Error("unexpected " + method);
    return { ipas: [...files.values()] };
  };
  return { files, calls, call };
}

test("F224: Unsign (n): the sheet, then the signed copies go and the IPA files stay, one HUD each (1 of n)", async () => {
  const lib = fakeLibrary([...LIST, { file: "Car.ipa", name: "Car", signed: { at: "x" } }]);
  const rows = [...lib.files.values()].map((e) => ({ ...e, title: e.name }));
  const huds = [];
  const sheets = [];
  let done = 0;
  const ok = await runManage("unsign", { rows, selected: ["Alpha.ipa", "Car.ipa", "Delta.ipa"], isSite: false, isJailbreak: false,
    call: lib.call, sheet: async (s) => { sheets.push(s); return 0; }, hud: (t) => { huds.push(t); return () => {}; }, done: () => { done++; } });
  assert.ok(ok);
  assert.deepEqual(sheets[0], { title: "2 signed copies are deleted. The IPA files stay.", buttons: ["Unsign 2 IPAs"], destructive: 0 });
  assert.deepEqual(huds, ["Unsigning Alpha (1 of 2)", "Unsigning Car (2 of 2)"], "Delta has no signed copy: not counted");
  assert.deepEqual(lib.calls, [["unsign", "Alpha.ipa"], ["unsign", "Car.ipa"]]);
  assert.equal(lib.files.size, 4, "every IPA file stays");
  assert.equal(lib.files.get("Alpha.ipa").signed, null);
  assert.equal(done, 1, "Manage ends and the list loads again");
  // Cancel does nothing
  const lib2 = fakeLibrary(LIST);
  assert.equal(await runManage("unsign", { rows: LIST, selected: ["Alpha.ipa"], isSite: false, isJailbreak: false, call: lib2.call,
    sheet: async () => -1, hud: () => () => {}, done: () => assert.fail("not done") }), false);
  assert.deepEqual(lib2.calls, []);
});

test("F224: Delete (n): files and signed copies go; installed apps stay (the sheet says Installed); a failure is named", async () => {
  const lib = fakeLibrary(LIST);
  const rows = [...lib.files.values()].map((e) => ({ ...e, title: e.name, installed: e.file === "Alpha.ipa" }));
  rows.push({ file: "Gone.ipa", name: "Gone", title: "Gone" });
  const alerts = [];
  let sheet = null;
  await runManage("delete", { rows, selected: ["Alpha.ipa", "Delta.ipa", "Gone.ipa"], isSite: false, isJailbreak: false, call: lib.call,
    sheet: async (s) => { sheet = s; return 0; }, hud: () => () => {}, done: () => {}, alert: async (a) => { alerts.push(a); } });
  assert.equal(sheet.buttons[0], "Delete 3 IPAs");
  assert.match(sheet.title, /The installed app stays on your iPhone: manage it in Installed\./);
  assert.deepEqual([...lib.files.keys()], ["Broken.ipa"]);
  assert.equal(alerts[0].title, "Couldn't Delete");
  assert.match(alerts[0].message, /^Gone: /);
});

test("F224: Sign (n): only signable picks, one after another; the first that doesn't install stops the run", async () => {
  const rows = [...LIST, { file: "Car.ipa", name: "Car", signed: null }].map((e) => ({ ...e, title: e.name }));
  let sheet = null;
  let got = null;
  await runManage("sign", { rows, selected: ["Broken.ipa", "Delta.ipa", "Car.ipa"], isSite: false, isJailbreak: false,
    sheet: async (s) => { sheet = s; return 0; }, sign: async (picked) => { got = picked.map((r) => r.file); }, done: () => {} });
  assert.deepEqual(sheet, { title: "Each IPA is signed with your certificate and installed.", buttons: ["Sign and Install 2 IPAs"] });
  assert.deepEqual(got, ["Delta.ipa", "Car.ipa"], "a broken file isn't signed");
  // the run itself
  const runs = [];
  const labels = [];
  const out = await signMany(rows.filter((r) => r.file !== "Broken.ipa"), { isSite: false,
    hudFor: (name, i, n) => { labels.push(`Signing ${name} (${i} of ${n})`); return () => ({}); },
    install: async ({ file }) => { runs.push(file); return file === "Alpha.ipa" ? "offline" : "installed"; } });
  assert.deepEqual(runs, ["Delta.ipa", "Alpha.ipa"]);
  assert.deepEqual(out, ["installed", "offline"]);
  assert.deepEqual(labels, ["Signing Delta (1 of 3)", "Signing Alpha (2 of 3)"]);
  // F212: no Sign in the jailbreak app
  assert.equal(await runManage("sign", { rows, selected: ["Delta.ipa"], isSite: false, isJailbreak: true, sheet: async () => assert.fail() }), false);
});

test("F224: which IPAs iOS has: apps.isInstalled by the signed bundle ID; unknown ones and the website by Installed's records", async () => {
  const asked = [];
  const native = { call: async (m, p) => { asked.push([m, p.bundleIds]); return { installed: { "com.x.alpha": true, "com.x.delta": null } }; } };
  const map = await installedOf(LIST, { mode: "sideload", native, records: async () => [{ id: "com.x.delta" }] });
  assert.deepEqual(asked, [["apps.isInstalled", ["com.x.delta", "com.x.alpha"]]]);
  assert.deepEqual(map, { "com.x.alpha": true, "com.x.delta": true });
  // iOS says no: no record overrides it
  const no = await installedOf(LIST, { mode: "jailbreak", native: { call: async () => ({ installed: { "com.x.alpha": false } }) },
    records: async () => [{ id: "com.x.alpha" }] });
  assert.deepEqual(no, {});
  const site = await installedOf([{ file: "k.ipa", stored: true, bundleId: "com.k" }], { mode: "site", native,
    records: async () => [{ id: "com.k" }] });
  assert.deepEqual(site, { "com.k": true });
  assert.equal(asked.length, 1, "the website asks no shell");
});

test("F224: the hold sheet's Delete still asks first ('Delete n IPAs'), then deletes the kept files", async () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
  const kept = [{ file: "A.ipa", stored: true, name: "A", size: 10 * MB }, { file: "B.ipa", stored: true, name: "B", size: 20 * MB }];
  storage.setItem("ifizbox.myIpas", JSON.stringify(kept));
  const store = memoryIpaStore();
  for (const e of kept) await store.put(e.file, new Blob([e.file]));
  assert.equal(await deleteMany(kept.slice(0, 1), { isSite: true, storage, store, sheet: async () => -1 }), null);
  const r = await deleteMany(kept.slice(0, 1), { isSite: true, storage, store,
    sheet: async (s) => { assert.deepEqual(s, { title: "The IPA is deleted from this browser.", buttons: ["Delete IPA"], destructive: 0 }); return 0; } });
  assert.deepEqual(r.deleted, ["A.ipa"]);
  assert.deepEqual(siteEntries(storage).map((e) => e.file), ["B.ipa"]);
  assert.deepEqual([...store.files.keys()], ["B.ipa"]);
  assert.deepEqual(listState(), { editing: false, armed: null, selected: [] });
});

// B80: two IPAs in the library with one bundle ID, one of them on the phone.
const RYUK = [
  { file: "RyukGram.ipa", name: "RyukGram", bundleId: "com.burbn.instagram", version: "1.0", size: 10 * MB, signed: null },
  { file: "RyukGram No Plugins.ipa", name: "RyukGram", options: { name: "RyukGram No Plugins" }, bundleId: "com.burbn.instagram",
    version: "1.0", size: 9 * MB, signed: null },
  { file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 10 * MB, signed: null },
];
const RYUK_ON = { "com.burbn.instagram": true, "com.x.delta": true };

test("B80: a shared bundle ID: only the IPA Installed's record names is Installed; the other says what it replaces", () => withDom(async () => {
  const shared = await sharedInstalls(RYUK, RYUK_ON, { records: async () => [
    { id: "com.burbn.instagram", name: "RyukGram", version: "1.0", key: "library:RyukGram.ipa" }, { id: "com.x.delta", name: "Delta" }] });
  assert.deepEqual(shared, { "com.burbn.instagram": { file: "RyukGram.ipa", name: "RyukGram" } }, "an ID with one IPA is left out");
  const g = libraryGroup(RYUK, { site: false, jailbreak: false, installed: RYUK_ON, shared });
  assert.deepEqual(groupsOf(g).map((x) => [x.header, x.rows]),
    [["Not Installed", ["RyukGram No Plugins.ipa"]], ["Installed", ["Delta.ipa", "RyukGram.ipa"]]]);
  assert.equal(g.cellOf("RyukGram No Plugins.ipa").querySelector(".cell-subtitle").textContent,
    "Replaces RyukGram · Version 1.0 · 9.0 MB · Not signed");
  assert.equal(g.cellOf("RyukGram.ipa").querySelector(".cell-subtitle").textContent, "Version 1.0 · 10.0 MB · Not signed");
  // its install asks first: Cancel stops it, Replace goes on; the installed one and Delta don't ask
  const asked = [];
  const alert = async (a) => { asked.push(a); return { index: asked.length === 1 ? 0 : 1 }; };
  assert.equal(await confirmReplace(RYUK[1], { shared, alert }), false);
  assert.equal(await confirmReplace(RYUK[1], { shared, alert }), true);
  assert.equal(asked[0].message, "RyukGram is already on this iPhone with the same ID. Installing RyukGram No Plugins will replace it.");
  assert.deepEqual(asked[0].buttons, ["Cancel", "Replace"]);
  assert.equal(await confirmReplace(RYUK[0], { shared, alert: () => assert.fail("asked") }), true);
  assert.equal(await confirmReplace(RYUK[2], { shared, alert: () => assert.fail("asked") }), true);
  // Sign (n): a cancelled replace skips that IPA and the run goes on
  const runs = [];
  const out = await signMany([RYUK[1], RYUK[2]], { isSite: false, hudFor: () => () => ({}), confirm: (e) => confirmReplace(e, { shared, alert: async () => ({ index: 0 }) }),
    install: async ({ file }) => { runs.push(file); return "installed"; } });
  assert.deepEqual(runs, ["Delta.ipa"]);
  assert.deepEqual(out, ["cancelled", "installed"]);
}));

test("B80: the record's name and version match when there's no file key; nothing to tell them apart marks none Installed", async () => {
  const byName = await sharedInstalls(RYUK, RYUK_ON, { records: async () => [{ id: "com.burbn.instagram", name: "RyukGram No Plugins", version: "1.0", key: null }] });
  assert.deepEqual(byName, { "com.burbn.instagram": { file: "RyukGram No Plugins.ipa", name: "RyukGram No Plugins" } });
  // both IPAs carry the name "RyukGram": a tie, so none
  const tie = await sharedInstalls(RYUK, RYUK_ON, { records: async () => [{ id: "com.burbn.instagram", name: "RyukGram", version: "1.0" }] });
  assert.deepEqual(tie, { "com.burbn.instagram": { file: null, name: "RyukGram" } });
  // installed outside the app: no record
  const none = await sharedInstalls(RYUK, RYUK_ON, { records: async () => [] });
  assert.deepEqual(none, { "com.burbn.instagram": { file: null, name: "com.burbn.instagram" } });
  const s = sharedSections(RYUK, { installed: RYUK_ON, shared: none });
  assert.deepEqual(s.map((x) => [x.header, x.rows.map((r) => r.file)]),
    [["Not Installed", ["RyukGram No Plugins.ipa", "RyukGram.ipa"]], ["Installed", ["Delta.ipa"]]]);
  assert.ok(s[0].rows.every((r) => r.replaces === "com.burbn.instagram"));
  assert.equal(await confirmReplace(RYUK[0], { shared: none, alert: async () => ({ index: 1 }) }), true);
  // not on the phone: nothing shared, today's list
  assert.deepEqual(await sharedInstalls(RYUK, { "com.x.delta": true }, { records: async () => assert.fail("read") }), {});
});
