// F302a: tweaks on the app side, screens/tweaks.js: the kept tweaks go with a plain install's signing.prepare (one log
// line per tweak), Install queues at once with them, the app page's Add Tweaks row
// counts them, Add to App greys App Store copies, an encrypted IPA picked in Files is flagged, and a newer .deb on a
// Tweak Source is a tweak update.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keptTweakParams, addTweaksGroup, addToApp, isEncrypted, markEncrypted, checkPickedIpa,
  tweakUpdatesFor, updateTweaks, savedTweaks, saveTweaks, addDebTo, ENC_KEY, tweakUpdateApps, runTweakUpdates } from "./tweaks.js";
import { appPageAction } from "./altstore.js";
import { queueApp } from "./queue.js";
import { createAppQueue } from "../core/appqueue.js";
import { memoryIpaStore } from "../core/myipas.js";
import { HOW_TO_GET_ONE } from "../core/tweaks.js";
import { addTweakPill } from "./installed.js";
import { fakeDocument, tick, withDocument } from "../fakes.test-helper.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`../core/fixtures/tweaks/${n}`, import.meta.url)));
const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const memStore = () => { const mem = memoryIpaStore(); return async () => mem; };
const st = (o = {}) => ({ package: "com.me.fixture", name: "Fixture", version: "1.0", debUrl: "https://repo.x/fixture.deb", depends: "mobilesubstrate", ...o });

// ---- the shared fake DOM, each element with all(cls): itself (when it has the class) and every node under it that does ----
const doc = Object.assign(fakeDocument(), { head: { append() {} } });
const plainElement = doc.createElement;
function fakeEl(tag) {
  const e = plainElement(tag);
  e.all = (c) => [...(e._cls.has(c) ? [e] : []), ...e.querySelectorAll(`.${c}`)];
  return e;
}
doc.createElement = fakeEl;
const withDoc = (f) => withDocument(f, doc);

test("keptTweakParams: a plain install from a source takes the app's kept tweaks, ElleKit with them, a log line each", async () => {
  const store = memStore();
  await addDebTo("com.me.fixture", st({ version: "9" }), fx("tweak-xz.deb"), { store });
  const lines = [];
  const p = await keptTweakParams({ url: "https://x/a.ipa" }, { id: "com.me.fixture" },
    { store, log: (l) => lines.push(l), ellekit: async () => fx("ellekit.deb"), toBase64: (b) => `b64:${b.length}` });
  assert.equal(p.url, "https://x/a.ipa");
  assert.ok(p.tweaks.files.length > 0);
  assert.deepEqual(p.tweaks.names, ["com.me.fixture_9.deb"]);
  assert.equal(lines[0], "Adding Fixture");
  // nothing kept, a Custom Install's own, a record re-sign (unless a tweak update), iFizBox itself: as they are
  const same = { url: "u" };
  assert.equal(await keptTweakParams(same, { id: "com.none" }, { store }), same);
  const own = { url: "u", tweaks: null };
  assert.equal(await keptTweakParams(own, { id: "com.me.fixture" }, { store }), own);
  // a re-sign from the record: its own tweaks, unless the kept ones changed since (a tweak update)
  const rec = { record: "com.me.fixture" };
  const signedWith = (names) => async () => [{ bundleId: "com.me.fixture", originalBundleId: "com.me.fixture", tweaks: names }];
  assert.equal(await keptTweakParams(rec, { id: "com.me.fixture", mode: "resign" }, { store, records: signedWith(["com.me.fixture_9.deb"]) }), rec);
  assert.equal(await keptTweakParams(rec, { id: "com.me.fixture", mode: "resign" }, { store, records: async () => [] }), rec);
  const up = await keptTweakParams(rec, { id: "com.me.fixture", mode: "resign" },
    { store, records: signedWith(["com.me.fixture_8.deb"]), ellekit: async () => fx("ellekit.deb"), toBase64: () => "x" });
  assert.equal(up.record, "com.me.fixture");
  assert.deepEqual(up.tweaks.names, ["com.me.fixture_9.deb"]);
  assert.equal(await keptTweakParams(same, { id: "library:x.ipa" }, { store }), same);
});

test("Install on an app with kept tweaks queues at once and asks nothing; the kept tweaks go in with the job", async () => {
  const store = memStore();
  await addDebTo("com.x.tube", st({ version: "9" }), fx("tweak-xz.deb"), { store });
  const pkg = { key: "alt:k", row: { id: "com.x.tube", name: "Tube" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.tube", name: "Tube",
    sourceUrl: "https://s/", versions: [{ version: "2", downloadURL: "https://s/t.ipa", size: 2048 }] } } };
  const q = createAppQueue();
  const opened = [];
  const add = (j, o) => queueApp(j, { ...o, open: (qq) => opened.push(qq) });
  assert.equal(await appPageAction(pkg, null, { queue: q, add, mode: "sideload", ready: async () => true, store: async () => ({ all: async () => [] }),
    ask: async () => assert.fail("no popup") }), true);
  assert.ok(q.get("com.x.tube"));
  assert.equal(opened.length, 1);
  const p = await keptTweakParams({ url: "https://s/t.ipa" }, { id: "com.x.tube" }, { store, ellekit: async () => fx("ellekit.deb"), toBase64: (b) => `b64:${b.length}` });
  assert.deepEqual(p.tweaks.names, ["com.me.fixture_9.deb"]);
  // tweaks made for it (cached checks, none added), and a Version History row (`version`): also at once, nothing asked
  const s = storage();
  s.setItem("ifizbox.tweakInfo", JSON.stringify({ "com.t.yt@2": { ok: true, bundles: ["com.x.tube"], anyApp: false } }));
  for (const version of [null, "2"]) {
    const q2 = createAppQueue();
    assert.equal(await appPageAction(pkg, null, { queue: q2, add, mode: "sideload", ready: async () => true, store: async () => ({ all: async () => [] }), version,
      ask: async () => assert.fail("no popup") }), true);
    assert.ok(q2.get("com.x.tube"));
  }
  assert.equal(opened.length, 3);
  const src = readFileSync(new URL("./tweaks.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /installTweaksChoice|pushAddTweaksUntilBack|openAddTweaks|showPushedPage/);
});

test("the app page's Add Tweaks row counts the tweaks made for the app, then the ones added", () => withDoc(async () => {
  const store = memStore();
  const s = storage();
  s.setItem("ifizbox.tweakInfo", JSON.stringify({ "com.t.yt@2": { ok: true, bundles: ["com.x.tube"] }, "com.t.other@1": { ok: true, bundles: ["com.y"] } }));
  const rows = async () => [{ id: "com.t.yt", name: "YTLite", version: "2" }, { id: "com.t.other", name: "Other", version: "1" }];
  const g = addTweaksGroup({ bundleId: "com.x.tube", name: "Tube", rows, store, storage: s, push: () => {} });
  await g.ready;
  assert.equal(g.el.all("cell-detail")[0].textContent, "1 for This App");
  assert.equal(g.el.all("group-footer")[0].textContent, ""); // F352: no footer naming the tweaks
  await saveTweaks("com.x.tube", [{ name: "com.t.yt_2.deb", data: new Uint8Array([1]), title: "YTLite" }], { store });
  await g.refresh();
  assert.equal(g.el.all("cell-detail")[0].textContent, "1 Added");
}));

test("Add to App: an App Store copy is listed under Can't Take Tweaks, not offered", async () => {
  const s = storage();
  markEncrypted("com.me.fixture", true, { storage: s });
  assert.equal(isEncrypted("com.me.fixture", { storage: s }), true);
  const picks = [];
  const r = await addToApp(st({ version: "7" }), { hud: () => () => {}, storage: s, store: memStore(), alert: async () => 0,
    apps: async () => [{ bundleId: "com.me.fixture", name: "Fixture" }], fetchDeb: async () => fx("tweak-xz.deb"),
    pick: async (o) => { picks.push(o); return o.locked[0]; } });
  assert.equal(r, null, "a locked app can't be chosen");
  assert.deepEqual(picks[0].locked.map((a) => a.name), ["Fixture"]);
  assert.equal(picks[0].made.length, 0);
  markEncrypted("com.me.fixture", false, { storage: s });
  assert.deepEqual(JSON.parse(s.m.get(ENC_KEY)), []);
});

test("checkPickedIpa: an encrypted IPA is flagged with How to Get One; a decrypted one clears the flag", async () => {
  const s = storage();
  const alerts = [];
  await checkPickedIpa({}, { storage: s, read: async () => ({ encrypted: true, bundleId: "com.g.yt", name: "YouTube" }),
    alert: async (o) => { alerts.push(o); return { index: 0 }; } });
  assert.equal(alerts[0].title, "YouTube Is Locked");
  assert.equal(alerts[1].title, HOW_TO_GET_ONE);
  assert.equal(isEncrypted("com.g.yt", { storage: s }), true);
  await checkPickedIpa({}, { storage: s, read: async () => ({ encrypted: false, bundleId: "com.g.yt", name: "YouTube" }), alert: async () => { throw new Error("no alert"); } });
  assert.equal(isEncrypted("com.g.yt", { storage: s }), false);
});

test("tweak updates: a newer .deb on a source, fetched and kept in place of the old one", async () => {
  const store = memStore();
  await addDebTo("com.me.fixture", st({ version: "1.0" }), new Uint8Array([1]), { store });
  const rows = async () => [{ id: "com.me.fixture", name: "Fixture", version: "1.1", key: "k" }];
  const ups = await tweakUpdatesFor("com.me.fixture", { rows, store });
  assert.deepEqual(ups.map((u) => [u.title, u.from, u.to]), [["Fixture", "1.0", "1.1"]]);
  await updateTweaks("com.me.fixture", ups, { store, storage: storage(), pkg: async () => st({ version: "1.1" }), fetchDeb: async () => fx("tweak-xz.deb") });
  assert.deepEqual((await savedTweaks("com.me.fixture", { store })).map((x) => x.name), ["com.me.fixture_1.1.deb"]);
  assert.deepEqual(await tweakUpdatesFor("com.me.fixture", { rows, store }), []);
});

test("Installed's Tweak Updates: the signed apps with newer tweaks, updated and queued as re-signs", async () => {
  const store = memStore();
  await addDebTo("com.me.fixture", st({ version: "1.0" }), new Uint8Array([1]), { store });
  const rows = async () => [{ id: "com.me.fixture", name: "Fixture", version: "1.1", key: "k" }];
  const records = [{ bundleId: "com.me.fixture", originalBundleId: "com.me.fixture", name: "Fix App", tweaks: ["com.me.fixture_1.0.deb"] },
    { bundleId: "com.no.tweaks", name: "Plain" }];
  const found = await tweakUpdateApps(records, { rows, store });
  assert.deepEqual(found.map((f) => f.app.name), ["Fix App"]);
  const asked = [], queued = [], updated = [];
  const n = await runTweakUpdates(found, { hud: () => () => {}, ask: async (o) => { asked.push(o); return 0; },
    update: async (id, ups) => { updated.push([id, ups.length]); }, queue: async (j) => { queued.push(j); } });
  assert.equal(n, 1);
  assert.match(asked[0].title, /Fix App: Fixture 1\.1/);
  assert.deepEqual(updated, [["com.me.fixture", 1]]);
  assert.equal(queued[0].mode, "resign");
  assert.equal(queued[0].id, "com.me.fixture");
  // Cancel: nothing fetched or queued
  assert.equal(await runTweakUpdates(found, { ask: async () => -1, update: async () => { throw new Error("no"); }, queue: async () => { throw new Error("no"); } }), 0);
});

test("Installed rows: '2 Tweaks' after a signed app's subtitle, 'Tweak Update' when one is newer, nothing without tweaks", () => withDoc(async () => {
  const li = () => { const l = fakeEl("li"); const sub = fakeEl("span"); sub.className = "cell-subtitle"; l.append(sub); l.querySelector = () => sub; return l; };
  const a = li();
  addTweakPill(a, { bundleId: "com.a", tweaks: ["x.deb", "y.dylib"] }, []);
  assert.equal(a.all("tweak-pill")[0].textContent, "2 Tweaks");
  const b = li();
  addTweakPill(b, { bundleId: "com.a", tweaks: ["x.deb"] }, [{ app: { bundleId: "com.a" } }]);
  assert.equal(b.all("tweak-pill")[0].textContent, "Tweak Update");
  assert.ok(b.all("tweak-pill")[0].classList.contains("up"));
  assert.equal(addTweakPill(li(), { bundleId: "com.b" }, []), null);
}));
