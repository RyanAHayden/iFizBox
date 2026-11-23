// B232: the app page's Installed section, Change Installed Version (screens/altstore.js installWhichVersion): an
// "Install Which Version?" sheet of the source's versions, newest first, the installed one marked and not installable
// from there; a pick installs that version (sideload: queued as Version History does; site: signed in the browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installWhichButtons, installWhichVersion, INSTALL_WHICH_TITLE, MARK_WHICH_TITLE } from "./altstore.js";

const APP = { bundleIdentifier: "com.x.a", name: "A", sourceUrl: "https://s/apps.json",
  versions: [{ version: "2.0", downloadURL: "https://s/a20.ipa" }, { version: "2.1", downloadURL: "https://s/a21.ipa" },
    { version: "" }, { version: "1.9", downloadURL: "https://s/a19.ipa" }] };
const PKG = { key: "alt:https://s/apps.json", row: { id: "com.x.a" }, stanza: { kind: "ipa", ipa: APP } };

test("titles: the install sheet asks what to install, Mark as Installed's picker what was installed", () => {
  assert.equal(INSTALL_WHICH_TITLE, "Install Which Version?");
  assert.equal(MARK_WHICH_TITLE, "Which Version Did You Install?");
});

test("installWhichButtons: newest first, the installed one marked with nothing to install, numberless ones left out", () => {
  const { buttons, versions } = installWhichButtons(APP, "2.0");
  assert.deepEqual(buttons, ["2.1", "2.0 (Installed)", "1.9"]);
  assert.deepEqual(versions.map((v) => v?.version ?? null), ["2.1", null, "1.9"]);
  // an installed version the source no longer lists: every one installable
  assert.deepEqual(installWhichButtons(APP, "1.0").buttons, ["2.1", "2.0", "1.9"]);
  assert.deepEqual(installWhichButtons({ versions: [] }, "1").buttons, []);
});

test("installWhichButtons: as Version History, no version without a download or that this iOS can't run", () => {
  const app = { versions: [{ version: "3.0", downloadURL: "https://s/a3.ipa", minOSVersion: "28.0" }, { version: "2.5" },
    { version: "2.1", downloadURL: "https://s/a21.ipa" }, { version: "2.0", downloadURL: "https://s/a20.ipa" }] };
  assert.deepEqual(installWhichButtons(app, "2.0", "27.0").buttons, ["2.1", "2.0 (Installed)"]);
  // the installed one stays listed (marked) even when it couldn't be installed from here
  assert.deepEqual(installWhichButtons(app, "2.5", "27.0").buttons, ["2.5 (Installed)", "2.1", "2.0"]);
});

test("installWhichVersion (sideload): nothing queued (no job, not ready): the install row runs instead", async () => {
  const r = rig((b) => b.indexOf("2.0"), "sideload");
  r.opts.queueVersion = async (v) => { r.queued.push(v.version); return false; };
  assert.equal((await installWhichVersion(APP, PKG, null, r.opts)).version, "2.0");
  assert.deepEqual(r.queued, ["2.0"]);
  assert.deepEqual(r.signed, ["2.0"]);
});

test("installWhichVersion: only the installed one to offer: no sheet", async () => {
  const r = rig(() => 0, "sideload");
  assert.equal(await installWhichVersion({ versions: [{ version: "1", downloadURL: "https://s/1.ipa" }] }, PKG, null, { ...r.opts, installed: "1" }), null);
  assert.equal(r.asked.length, 0);
});

function rig(pick, mode) {
  const asked = [], queued = [], signed = [];
  const opts = { installed: "2.1", mode, ios: null, ask: async (o) => { asked.push(o); return pick(o.buttons); },
    queueVersion: async (v) => { queued.push(v.version); return true; }, siteInstall: async (v) => { signed.push(v.version); } };
  return { asked, queued, signed, opts };
}

test("installWhichVersion (sideload): a downgrade pick queues that version, as Version History does", async () => {
  const r = rig((b) => b.indexOf("1.9"), "sideload");
  const v = await installWhichVersion(APP, PKG, null, r.opts);
  assert.equal(v.version, "1.9");
  assert.equal(r.asked[0].title, INSTALL_WHICH_TITLE);
  assert.deepEqual(r.asked[0].buttons, ["2.1 (Installed)", "2.0", "1.9"]);
  assert.deepEqual(r.queued, ["1.9"]);
  assert.deepEqual(r.signed, []);
});

test("installWhichVersion (site): a pick signs that version in the browser", async () => {
  const r = rig((b) => b.indexOf("2.0"), "site");
  assert.equal((await installWhichVersion(APP, PKG, null, r.opts)).version, "2.0");
  assert.deepEqual(r.signed, ["2.0"]);
  assert.deepEqual(r.queued, []);
});

test("installWhichVersion: the installed row and Cancel install nothing; the jailbreak app never installs from here", async () => {
  for (const [pick, mode] of [[(b) => b.indexOf("2.1 (Installed)"), "sideload"], [() => -1, "site"], [(b) => b.indexOf("2.0"), "jailbreak"]]) {
    const r = rig(pick, mode);
    assert.equal(await installWhichVersion(APP, PKG, null, r.opts), null);
    assert.deepEqual([...r.queued, ...r.signed], []);
  }
});

// B372: on the app page, Mark as Not Installed (the nav bar's toggle, Modify's) holds signing.forget until the page is
// left; marking it installed again before that cancels it, so the signed record and its expiry stay.
import { toggleMarked, appPageAction, forgetHeld, flushHeldForgets, cancelHeldForget } from "./altstore.js";
import { memoryAppStore } from "../core/installed.js";
import { MARK_NOT_INSTALLED } from "../core/appqueue.js";
import { createAppQueue } from "../core/appqueue.js";

function signedRig() {
  const signed = new Map([["com.x.a", { bundleId: "com.x.a", version: "2.1", expires: "2026-12-01T00:00:00Z" }]]);
  const mem = memoryAppStore([{ id: "com.x.a", version: "2.1" }]);
  const calls = [];
  const native = { call: async (m, a) => { calls.push([m, a]); if (m === "signing.forget") signed.delete(a.bundleId); return {}; } };
  const opts = { store: async () => mem, signedOf: async (id) => signed.get(id) ?? null, native };
  return { signed, mem, calls, native, opts, forgets: () => calls.filter(([m]) => m === "signing.forget").length };
}

test("B372 toggle: off then on before leaving: signing.forget never called, the signed record and its expiry stay", async () => {
  const r = signedRig();
  const body = { isConnected: true };
  assert.equal(await toggleMarked(APP, PKG, null, { ...r.opts, body }), false);
  assert.equal(forgetHeld("com.x.a"), true);
  await flushHeldForgets(); // the page is still up: nothing runs
  assert.equal(r.forgets(), 0);
  assert.equal(await toggleMarked(APP, PKG, null, { ...r.opts, body }), true);
  assert.equal(forgetHeld("com.x.a"), false);
  body.isConnected = false;
  await flushHeldForgets();
  assert.equal(r.forgets(), 0);
  assert.equal(r.signed.get("com.x.a")?.expires, "2026-12-01T00:00:00Z");
  assert.deepEqual((await r.mem.all()).map((x) => [x.id, x.version]), [["com.x.a", "2.1"]]);
});

test("B372 toggle: off then leave the page: signing.forget once, the record removed", async () => {
  const r = signedRig();
  const body = { isConnected: true };
  assert.equal(await toggleMarked(APP, PKG, null, { ...r.opts, body }), false);
  assert.equal(r.forgets(), 0);
  assert.equal((await r.mem.all()).length, 1, "nothing forgotten while the page is up");
  body.isConnected = false;
  await flushHeldForgets();
  await flushHeldForgets(); // a second pass runs nothing again
  assert.equal(r.forgets(), 1);
  assert.equal(r.signed.has("com.x.a"), false);
  assert.deepEqual(await r.mem.all(), []);
  assert.equal(forgetHeld("com.x.a"), false);
});

test("B372 toggle: the app or tab going away runs a held forget although the page is up", async () => {
  const r = signedRig();
  await toggleMarked(APP, PKG, null, { ...r.opts, body: { isConnected: true } });
  await flushHeldForgets({ all: true });
  assert.equal(r.forgets(), 1);
});

test("B372 toggle: a held forget that fails shows the alert", async () => {
  const r = signedRig();
  const warned = [];
  r.native.call = async () => { throw new Error("no"); };
  await toggleMarked(APP, PKG, null, { ...r.opts, body: { isConnected: false }, warn: async (e) => warned.push(e.message) });
  await flushHeldForgets();
  assert.deepEqual(warned, ["no"]);
});

test("B372 Modify: Mark as Not Installed from the page is held; while held the app reads not installed; Install cancels it", async () => {
  const r = signedRig();
  const body = { isConnected: true };
  const queued = [];
  const base = { queue: createAppQueue(), mode: "sideload", ready: async () => true, store: r.opts.store, signedOf: r.opts.signedOf,
    forgetSigned: (s) => r.native.call("signing.forget", { bundleId: s.bundleId }), add: (j) => queued.push(j), tweaks: async () => true,
    warn: async () => "install", body };
  assert.equal(await appPageAction(PKG, null, { ...base, ask: async (o) => o.buttons.indexOf(MARK_NOT_INSTALLED) }), true);
  assert.equal(r.forgets(), 0);
  assert.equal(forgetHeld("com.x.a"), true);
  // the nav button now reads Install: no Modify sheet, the job queued and the held forget cancelled
  assert.equal(await appPageAction(PKG, null, { ...base, ask: async () => assert.fail("Modify sheet") }), true);
  assert.equal(queued.length, 1);
  assert.equal(forgetHeld("com.x.a"), false);
  body.isConnected = false;
  await flushHeldForgets();
  assert.equal(r.forgets(), 0);
  assert.ok(r.signed.get("com.x.a")?.expires);
});

test("B372 Modify: away from the page, Mark as Not Installed forgets at once, as before", async () => {
  const r = signedRig();
  const removed = [];
  await appPageAction(PKG, null, { queue: createAppQueue(), mode: "sideload", ready: async () => true, store: r.opts.store, signedOf: r.opts.signedOf,
    forgetSigned: (s) => r.native.call("signing.forget", { bundleId: s.bundleId }), forget: async (id) => removed.push(id),
    ask: async (o) => o.buttons.indexOf(MARK_NOT_INSTALLED) });
  assert.equal(r.forgets(), 1);
  assert.deepEqual(removed, ["com.x.a"]);
  cancelHeldForget("com.x.a");
});
