// B277: an IPA page's Install of another version queues it as an Upgrade (or Downgrade) from the version on the phone,
// not Reinstall; the Pairing page names the VPN that's on; an install's end draws My IPAs again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppQueue } from "../core/appqueue.js";
import { queueLibraryInstall, installedVersionOf, afterInstall, ipaChanged } from "./myipas.js";
import { setupGroups } from "./installroute.js";

const R55 = { file: "R55-3.0.ipa", name: "R55 Test", bundleId: "com.x.r55", version: "3.0", size: 10, icon: null };

test("queueLibraryInstall: 3.0 over 2.0 queues an Upgrade, 1.0 a Downgrade, the same version a Reinstall", async () => {
  const q = createAppQueue();
  const opts = (v) => ({ reachable: async () => true, add: (j) => q.add(j), installed: { "com.x.r55": true }, shared: {}, versionOf: async () => v });
  assert.equal(await queueLibraryInstall(R55, opts("2.0")), true);
  assert.equal(q.get("com.x.r55").installed, "2.0");
  assert.equal(q.get("com.x.r55").mode, "upgrade");
  q.clearAll();
  await queueLibraryInstall(R55, opts("4.0"));
  assert.equal(q.get("com.x.r55").mode, "downgrade");
  q.clearAll();
  await queueLibraryInstall(R55, opts("3.0"));
  assert.equal(q.get("com.x.r55").mode, "reinstall");
  q.clearAll();
  // the installed version unknown: as before (Reinstall); not installed: Install, and nothing is asked
  await queueLibraryInstall(R55, opts(null));
  assert.equal(q.get("com.x.r55").mode, "reinstall");
  q.clearAll();
  await queueLibraryInstall(R55, { ...opts("2.0"), installed: {}, versionOf: () => assert.fail("asked") });
  assert.equal(q.get("com.x.r55").mode, "install");
});

test("installedVersionOf: Installed's record first, else the shell's signing record (by either bundle ID)", async () => {
  const records = async () => [{ id: "com.x.r55", version: "2.0" }];
  assert.equal(await installedVersionOf("com.x.r55", { records, signed: () => assert.fail("asked") }), "2.0");
  const signed = async () => [{ bundleId: "com.team.r55", originalBundleId: "com.x.r55", version: "1.9" }];
  assert.equal(await installedVersionOf("com.x.r55", { records: async () => [], signed }), "1.9");
  assert.equal(await installedVersionOf("com.team.r55", { records: async () => [{ id: "com.team.r55" }], signed }), "1.9");
  assert.equal(await installedVersionOf("com.y", { records: async () => { throw new Error("no store"); }, signed: async () => { throw new Error("x"); } }), null);
  assert.equal(await installedVersionOf(null), null);
});

test("afterInstall: several changes at once read the list and draw the IPA page once", async () => {
  let lists = 0, pages = 0;
  const hooks = { list: () => lists++, page: () => pages++ };
  afterInstall(hooks); afterInstall(hooks); afterInstall(hooks);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([lists, pages], [1, 1]);
  afterInstall(hooks);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([lists, pages], [2, 2]);
});

test("ipaChanged: the IPA page redraws only when its entry differs from the one drawn", async () => {
  const entry = { file: "A.ipa", signed: null };
  const shown = { body: { isConnected: true }, file: "A.ipa", drawn: JSON.stringify({ entry, identity: true }) };
  assert.equal(await ipaChanged(shown, { read: async () => ({ entry, identity: true }) }), false);
  assert.equal(await ipaChanged(shown, { read: async () => ({ entry: { ...entry, signed: { at: "x" } }, identity: true }) }), true);
  assert.equal(await ipaChanged(shown, { read: async () => { throw new Error("x"); } }), false);
  assert.equal(await ipaChanged({ ...shown, body: { isConnected: false } }, { read: () => assert.fail("read") }), false);
  assert.equal(await ipaChanged({ ...shown, drawn: null }, { read: () => assert.fail("read") }), false);
});

test("the Pairing page names the VPN that's on: the built-in VPN", () => {
  const p = { pin: "123456", text: "Pairing…", error: "" };
  const g = setupGroups("pairing", { paired: false, vpn: { available: true } }, p);
  assert.deepEqual(g[1].rows.map((r) => [r.label, r.detail]), [["iFizBox VPN", "On"]]);
});
