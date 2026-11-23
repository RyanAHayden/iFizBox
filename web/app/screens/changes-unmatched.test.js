// B358: an installed app whose source entry is gone (Unbound installed under a custom bundle ID taken from another
// app on a source): Changes' row opened "Package not found" with no way out, and the source's app page lost Modify.
// Holding a Changes row offers Mark as Not Installed (sideload app, website); the app page keeps Modify from the signed
// record; the record is matched by the installed bundle ID, and Re-sign signs the app under that ID.
import { test } from "node:test";
import assert from "node:assert/strict";
import { holdItems, markRowNotInstalled } from "./changes.js";
import { appPageAction, trackingSection } from "./altstore.js";
import { createAppQueue, MARK_NOT_INSTALLED } from "../core/appqueue.js";
import { memoryAppStore, recordOf, forgetInstalled } from "../core/installed.js";
import { pageHandle } from "../nav/go.js";
import { fakeDocument, withDocument } from "../fakes.test-helper.js";

const SOURCE_ID = "com.unbound.app"; // the source's app the IPA came from
const CUSTOM_ID = "com.other.app"; // the custom bundle ID it was installed under: another app's, gone from its source
const SIGNED = { bundleId: CUSTOM_ID, originalBundleId: SOURCE_ID, name: "Unbound", version: "1.2", expires: "2026-11-24T00:00:00Z" };
const APP = { bundleIdentifier: SOURCE_ID, name: "Unbound", sourceUrl: "https://s/apps.json", sourceName: "S", iconURL: "https://s/u.png",
  versions: [{ version: "1.3", downloadURL: "https://s/u13.ipa" }, { version: "1.2", downloadURL: "https://s/u12.ipa" }] };
const PKG = { key: "alt:https://s/apps.json", row: { id: SOURCE_ID }, stanza: { kind: "ipa", ipa: APP } };
// Needs Re-sign's row for it (core/signing.js needsResign): the installed ID, which no source lists any more
const ROW = { id: CUSTOM_ID, name: "Unbound", version: "1 day", installed: "1.2", change: "resign", sig: "soon" };

const shell = (apps = [SIGNED]) => {
  const calls = [];
  let list = [...apps];
  return { calls, call: async (name, args) => {
    calls.push([name, args]);
    if (name === "signing.installed") return { apps: list };
    if (name === "signing.forget") { list = list.filter((a) => a.bundleId !== args.bundleId); return {}; }
    return {};
  } };
};

test("holdItems: Mark as Not Installed for an installed row, apps and packages alike, where apps can't be removed", () => {
  for (const mode of ["sideload", "site"]) {
    assert.deepEqual(holdItems(ROW, { mode }).map((i) => i.label), [MARK_NOT_INSTALLED], `${mode}: Needs Re-sign row`);
    assert.deepEqual(holdItems({ id: "com.x.a", change: "upgrade" }, { mode }).map((i) => i.label), [MARK_NOT_INSTALLED]);
    const installed = new Set(["com.ex.tweak"]);
    assert.deepEqual(holdItems({ id: "com.ex.tweak", change: "updated" }, { mode, installed }).map((i) => i.label), [MARK_NOT_INSTALLED],
      "a day's package row, installed");
    assert.deepEqual(holdItems({ id: "com.ex.other", change: "new" }, { mode, installed }), [], "not installed: nothing to forget");
  }
  assert.deepEqual(holdItems(ROW, { mode: "jailbreak" }), [], "the jailbreak app removes instead");
  assert.deepEqual(holdItems({ id: "com.ryha.ifizbox", change: "upgrade" }, { mode: "sideload" }), [], "never iFizBox itself");
});

test("recordOf: the installed bundle ID's record first, then the asked ID, then the signed original", () => {
  const recs = [{ id: SOURCE_ID, version: "1.0" }, { id: CUSTOM_ID, version: "1.2" }];
  assert.equal(recordOf(recs, SOURCE_ID, SIGNED).id, CUSTOM_ID);
  assert.equal(recordOf([{ id: SOURCE_ID }], CUSTOM_ID, SIGNED).id, SOURCE_ID, "an older record under the source's ID");
  assert.equal(recordOf(recs, SOURCE_ID, null).id, SOURCE_ID);
  assert.equal(recordOf([{ id: "com.x.z" }], SOURCE_ID, SIGNED), null);
  assert.equal(recordOf([{ id: CUSTOM_ID, self: true }], CUSTOM_ID, null), null);
});

test("Changes hold, sideload: Mark as Not Installed forgets the signed record and the record under the custom ID", async () => {
  const mem = memoryAppStore([{ id: CUSTOM_ID, version: "1.2", key: PKG.key, source: APP.sourceUrl }, { id: "com.x.b", version: "1" }]);
  const native = shell();
  assert.equal(await markRowNotInstalled(ROW, { mode: "sideload", native, store: async () => mem }), true);
  assert.deepEqual(native.calls.filter(([n]) => n === "signing.forget"), [["signing.forget", { bundleId: CUSTOM_ID }]]);
  assert.deepEqual((await mem.all()).map((r) => r.id), ["com.x.b"]);
});

test("Changes hold, sideload: a signed app with no record at all is still forgotten (its signature)", async () => {
  const mem = memoryAppStore([]);
  const native = shell();
  assert.equal(await markRowNotInstalled(ROW, { mode: "sideload", native, store: async () => mem }), true);
  assert.deepEqual(native.calls.at(-1), ["signing.forget", { bundleId: CUSTOM_ID }]);
});

test("Changes hold, website: the record goes, no shell asked", async () => {
  const mem = memoryAppStore([{ id: "com.x.a", version: "2" }]);
  const native = { call: async () => assert.fail("no shell on the website") };
  assert.equal(await markRowNotInstalled({ id: "com.x.a", change: "upgrade" }, { mode: "site", native, store: async () => mem }), true);
  assert.deepEqual(await mem.all(), []);
  assert.equal(await forgetInstalled({ id: "com.x.gone" }, { store: async () => mem }), false, "nothing to forget");
});

test("app page, sideload: signed under a custom ID with no matching record: Modify's sheet, Re-sign under the installed ID", async () => {
  const mem = memoryAppStore([]);
  const q = createAppQueue();
  const added = [];
  let sheet = null;
  const base = { queue: q, mode: "sideload", ready: async () => true, store: async () => mem,
    signedOf: async (id) => (id === SOURCE_ID || id === CUSTOM_ID ? SIGNED : null), add: (j) => added.push(j), forgetSigned: async () => {} };
  assert.equal(await appPageAction(PKG, null, { ...base, ask: async (o) => { sheet = o; return o.buttons.indexOf("Re-sign"); } }), true);
  assert.ok(sheet, "Modify's sheet, not a fresh install");
  assert.ok(sheet.buttons.includes(MARK_NOT_INSTALLED), sheet.buttons.join());
  assert.equal(added.length, 1);
  assert.equal(added[0].mode, "resign");
  assert.equal(added[0].id, CUSTOM_ID, "signing.resign finds the app by the ID it is installed under");

  const forgot = [];
  await appPageAction(PKG, null, { ...base, forgetSigned: async (s) => forgot.push(s.bundleId),
    ask: async (o) => o.buttons.indexOf(MARK_NOT_INSTALLED) });
  assert.deepEqual(forgot, [CUSTOM_ID], "Mark as Not Installed forgets iFizBox's signature too");
});

test("app page: the nav button reads Modify for an app signed under a custom ID, with no record under the source's ID", async () => {
  await withDocument(async (doc) => {
    const el = (t) => fakeDocument().createElement(t);
    const body = el("div");
    doc.body.append(body);
    const item = el("div");
    const right = el("div");
    right.className = "nav-right";
    const button = el("button");
    button.className = "bar-button";
    button.textContent = "Install";
    right.append(button);
    item.append(right);
    pageHandle(item, body);
    const mem = memoryAppStore([{ id: CUSTOM_ID, version: "1.2", key: PKG.key }]);
    const tracking = trackingSection(APP, PKG, null, body, { store: async () => mem, signedOf: async (id) => (id === SOURCE_ID ? SIGNED : null) });
    body.append(tracking);
    await tracking.drawn;
    assert.equal(button.textContent, "Modify");

    const bare = trackingSection(APP, PKG, null, body, { store: async () => memoryAppStore([]), signedOf: async (id) => (id === SOURCE_ID ? SIGNED : null) });
    await bare.drawn;
    assert.equal(button.textContent, "Modify", "the signed record alone keeps Modify");
  });
});
