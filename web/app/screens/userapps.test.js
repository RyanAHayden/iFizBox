// F374: Installed Apps' screens (screens/userapps.js, under Install IPAs in myipas.js): the routes, the row on Install
// IPAs, an app's page's rows, Decrypt on the progress page and Add Tweaks' copy, with the shell faked.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pageOf, addGroups, jailbreakIpaGroups } from "./myipas.js";
import { appGroups, decryptApp, buildWithTweaks, appHref, ipaHref } from "./userapps.js";

const r = (...path) => ({ tab: "installed", path });
const saved = globalThis.ifizboxNative;
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

const TUBE = { bundleId: "com.x.tube", name: "Tube", version: "2.1", build: "210", path: "/x/Tube.app", encrypted: true, store: true };

// nav/progress.js's page, kept as a log
function fakeProgress() {
  const p = { lines: [], statuses: [], finished: null, opened: null };
  const open = (o) => { p.opened = o; return {
    line: (kind, text) => p.lines.push([kind, text]), status: (t) => p.statuses.push(t), progress: () => {},
    finish: (f) => { p.finished = f; } }; };
  return { p, open };
}

test("routes: Installed Apps and an app's page under Install IPAs", () => {
  globalThis.ifizboxNative = { mode: "jailbreak", call: async () => null };
  assert.deepEqual(pageOf(r("myipas", "userapps")), { page: "userapps" });
  assert.deepEqual(pageOf(r("myipas", "userapps", "userapp:com.x.tube")), { page: "userapp", id: "com.x.tube" });
  assert.deepEqual(pageOf(r("myipas", "userapps", "userapp:bad id")), { page: "missing" });
  assert.deepEqual(pageOf(r("myipas", "userapps", "userapp:com.x.tube", "more")), { page: "missing" });
  assert.equal(decodeURIComponent(appHref("com.x.tube")), "#/installed/myipas/userapps/userapp:com.x.tube");
  assert.match(decodeURIComponent(ipaHref("Tube 2.1 (decrypted).ipa")), /^#\/installed\/myipas\/ipa:/);
});

test("Install IPAs' Add an IPA group: Installed Apps in the jailbreak app only", () => {
  const rows = (g) => g.flatMap((x) => x.rows.map((y) => y.label));
  assert.deepEqual(rows(addGroups(false, { jailbreak: true })), ["Choose from Files", "Download from URL", "Installed Apps"]);
  assert.equal(addGroups(false, { jailbreak: true })[0].rows[2].href, "#/installed/myipas/userapps");
  assert.deepEqual(rows(addGroups(false, { jailbreak: false })), ["Choose from Files", "Download from URL"]);
  assert.deepEqual(rows(addGroups(true, { jailbreak: true })), ["Choose File", "Download from URL"]);
});

test("a jailbreak IPA's page has Share (the file itself) above Delete", () => {
  let shared = 0;
  const groups = jailbreakIpaGroups({ file: "A.ipa", name: "A", version: "1", bundleId: "a.b", size: 10 }, () => {}, () => shared++);
  const labels = groups.flatMap((g) => g.rows.map((x) => x.label));
  assert.deepEqual(labels.slice(-2), ["Share", "Delete"]);
  groups.at(-2).rows[0].onClick();
  assert.equal(shared, 1);
  // a file that can't be read: nothing to share
  const broken = jailbreakIpaGroups({ file: "B.ipa", error: "not a zip" }, () => {}, () => {});
  assert.ok(!broken.flatMap((g) => g.rows.map((x) => x.label)).includes("Share"));
});

test("an app's page: details, Decrypt (Again, with the copy's row, once there is one)", () => {
  const g = appGroups(TUBE, { ipas: [] });
  assert.deepEqual(g.details.rows.map((x) => [x.label, x.detail]),
    [["Version", "2.1 (210)"], ["Bundle ID", "com.x.tube"], ["From", "App Store"], ["Encrypted", "Yes"]]);
  assert.deepEqual(g.decrypt.rows.map((x) => x.label), ["Decrypt"]);
  assert.match(g.decrypt.footer, /isn't changed or run/);
  const again = appGroups(TUBE, { ipas: [{ file: "Tube 2.1 (decrypted).ipa", bundleId: "com.x.tube" }] });
  assert.deepEqual(again.decrypt.rows.map((x) => x.label), ["Decrypt Again", "Tube 2.1 (decrypted).ipa"]);
  assert.match(decodeURIComponent(again.decrypt.rows[1].href), /ipa:Tube 2\.1 \(decrypted\)\.ipa$/);
  assert.match(appGroups({ ...TUBE, encrypted: false }, {}).decrypt.footer, /isn't encrypted/);
});

test("Decrypt: the helper's lines on the progress page, Complete opens the IPA; a failure says why", async () => {
  const { p, open } = fakeProgress();
  const backend = { decryptApp: async (id, on) => {
    assert.equal(id, "com.x.tube");
    on({ fd: "status", line: "pmstatus:com.x.tube:10:Decrypting Tube" });
    on([{ fd: "out", line: "Decrypted Tube (3413 KB)" }, { fd: "out", line: "Still encrypted PlugIns/A.appex/A: Operation not permitted" }]);
    return { file: "Tube 2.1 (decrypted).ipa", left: ["PlugIns/A.appex/A"] };
  } };
  const out = await decryptApp(TUBE, { backend, open });
  assert.equal(out.file, "Tube 2.1 (decrypted).ipa");
  assert.equal(p.opened.title, "Decrypting");
  assert.deepEqual(p.lines, [["step", "Decrypting Tube"], ["raw", "Decrypted Tube (3413 KB)"],
    ["warning", "Still encrypted PlugIns/A.appex/A: Operation not permitted"]]);
  assert.ok(p.statuses.includes("Decrypting Tube"));
  assert.equal(p.finished.label, "Open in My IPAs");

  const f = fakeProgress();
  const none = await decryptApp(TUBE, { backend: { decryptApp: async () => { throw new Error("decrypt: can't decrypt Tube: Operation not permitted"); } }, open: f.open });
  assert.equal(none, null);
  assert.deepEqual(f.p.lines.at(-1), ["error", "can't decrypt Tube: Operation not permitted"]);
  assert.equal(f.p.finished.status, "Couldn't decrypt");
});

test("Add Tweaks: none yet is an alert; no decrypted copy asks to decrypt first; then the copy with the tweaks", async () => {
  const alerts = [];
  const alert = async (a) => { alerts.push(a.title); return { index: 1 }; };
  const empty = { items: () => [], prepared: async () => null };
  assert.equal(await buildWithTweaks(TUBE, empty, { alert, backend: {} }), null);
  assert.deepEqual(alerts, ["No Tweaks Yet"]);

  const dylib = { name: "Hook.dylib", data: new Uint8Array([1, 2, 3]) };
  const tg = { items: () => [dylib], prepared: async () => ({ files: [{ path: "Frameworks/Hook.dylib", data: new Uint8Array([1, 2, 3]) }], inject: ["@rpath/Hook.dylib"], names: ["Hook.dylib"] }) };
  const calls = [];
  const backend = { addTweaksTo: async (file, tweaks) => { calls.push([file, tweaks]); return { file: "Tube 2.1 (tweaks).ipa", injected: ["@rpath/Hook.dylib"] }; } };
  const { p, open } = fakeProgress();
  let decrypted = 0;
  const decrypt = async () => { decrypted++; return { file: "Tube 2.1 (decrypted).ipa" }; };
  const file = await buildWithTweaks(TUBE, tg, { alert, backend, open, list: async () => [], decrypt });
  assert.equal(file, "Tube 2.1 (tweaks).ipa");
  assert.equal(decrypted, 1);
  assert.equal(alerts.at(-1), "Decrypt Tube First?");
  assert.equal(calls[0][0], "Tube 2.1 (decrypted).ipa");
  assert.deepEqual(calls[0][1], { files: [{ path: "Frameworks/Hook.dylib", data: "AQID" }], inject: ["@rpath/Hook.dylib"], names: ["Hook.dylib"] });
  assert.ok(p.lines.some(([k, t]) => k === "raw" && t === "Injected @rpath/Hook.dylib"));

  // a decrypted copy there already: no question, no decrypt
  const before = alerts.length;
  await buildWithTweaks(TUBE, tg, { alert, backend, open, list: async () => [{ file: "Tube 2.1 (decrypted).ipa", bundleId: "com.x.tube" }], decrypt });
  assert.equal(alerts.length, before);
  assert.equal(decrypted, 1);
  // Cancel on the question: nothing happens
  const no = await buildWithTweaks(TUBE, tg, { alert: async () => ({ index: 0 }), backend, open, list: async () => [], decrypt });
  assert.equal(no, null);
  assert.equal(decrypted, 1);
});
