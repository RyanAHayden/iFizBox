// F77: Install on a My IPAs page (signing-client.js installFromLibrary) against a fake bridge: signs first (offline is
// fine), says so when the Signing Server can't be reached and keeps the signed copy, otherwise installs.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeNative } from "./fakes.test-helper.js";
import { installFromLibrary, serverReachable, offlineText, libraryCall } from "./signing-client.js";

const coded = (code, message) => Object.assign(new Error(message), { code });
function fakeUI() {
  const ui = { labels: [], hidden: 0, alerts: [], went: [], followed: [] };
  ui.deps = {
    hud: (t) => { ui.labels.push(t); return { set: (x) => ui.labels.push(x), hide: () => { ui.hidden++; } }; },
    alert: async (a) => { ui.alerts.push(a); return { index: 0 }; },
    go: (path) => ui.went.push(path),
    check: async () => null,
    follow: (n, id) => ui.followed.push(id),
    later: () => {},
  };
  return ui;
}

let saved;
beforeEach(() => { saved = globalThis.ifizboxNative; });
afterEach(() => { if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved; });

test("offline: signed and kept, and the alert says installing needs the Signing Server", async () => {
  const native = fakeNative({ "library.sign": (p, on) => { on({ phase: "signing", progress: 0.5 }); return { file: p.file, signed: { at: "x" } }; } });
  const ui = fakeUI();
  const r = await installFromLibrary({ file: "Delta.ipa", name: "Delta" }, { ...ui.deps, native, reachable: async () => false });
  assert.equal(r, "offline");
  assert.deepEqual(native.calls.map((c) => c.method), ["library.sign"]);
  assert.deepEqual(native.calls[0].params, { file: "Delta.ipa" });
  assert.ok(ui.labels.includes("Signing 50%"));
  assert.equal(ui.alerts[0].title, "No Connection");
  assert.match(ui.alerts[0].message, /Delta is signed and kept in My IPAs/);
  assert.match(ui.alerts[0].message, /sign\.ifizbox\.com/);
  assert.equal(ui.hidden, 1);
});

test("online: signs, installs with the manifest server, records and follows iOS's install", async () => {
  const native = fakeNative({ "library.sign": {}, "library.install": { bundleId: "com.me.delta", name: "Delta", version: "1.6", file: "Delta.ipa" } });
  const ui = fakeUI();
  const got = [];
  const r = await installFromLibrary({ file: "Delta.ipa", name: "Delta", onInstalled: (x) => got.push(x) },
    { ...ui.deps, native, reachable: async () => true });
  assert.equal(r, "installed");
  assert.deepEqual(native.calls.map((c) => c.method), ["library.sign", "library.install"]);
  assert.deepEqual(native.calls[1].params, { file: "Delta.ipa", manifestServer: "https://sign.ifizbox.com" });
  assert.equal(got[0].bundleId, "com.me.delta");
  assert.deepEqual(ui.followed, ["com.me.delta"]);
  assert.deepEqual(ui.alerts, []);
});

test("errors by code: no certificate opens Settings > Signing; a bad IPA says why", async () => {
  let ui = fakeUI();
  let native = fakeNative({ "library.sign": coded("no_identity", "import a certificate") });
  assert.equal(await installFromLibrary({ file: "A.ipa", name: "A" }, { ...ui.deps, native, reachable: async () => true }), false);
  assert.equal(ui.alerts[0].title, "No Certificate");
  assert.deepEqual(ui.went, [["signing"]]);
  ui = fakeUI();
  native = fakeNative({ "library.sign": {}, "library.install": coded("bad_ipa", "the IPA holds more than one app") });
  assert.equal(await installFromLibrary({ file: "A.ipa", name: "A" }, { ...ui.deps, native, reachable: async () => true }), false);
  assert.equal(ui.alerts[0].title, "Couldn't Install A");
});

test("the first-install walkthrough comes before anything is signed", async () => {
  const native = fakeNative();
  const ui = fakeUI();
  assert.equal(await installFromLibrary({ file: "A.ipa" }, { ...ui.deps, native, check: async () => "certificate" }), null);
  assert.deepEqual(native.calls, []);
});

test("the Signing Server's reachability and the library calls' names", async () => {
  assert.equal(await serverReachable("https://s.test", { fetcher: async (u) => ({ ok: u === "https://s.test/sign/status" }) }), true);
  assert.equal(await serverReachable("https://s.test", { fetcher: async () => { throw new Error("offline"); } }), false);
  assert.equal(await serverReachable("https://s.test", { fetcher: async () => ({ ok: false }) }), false);
  assert.match(offlineText("", "https://s.test"), /^The app is signed.*\(s\.test\)/);
  const native = fakeNative({ "library.list": { ipas: [] } });
  assert.deepEqual(await libraryCall("list", {}, undefined, native), { ipas: [] });
  assert.equal(native.calls[0].method, "library.list");
});

test("the log starts on the first step the shell reports: Reading, or Preparing for a signed copy (no placeholder Signing)", async () => {
  const native = fakeNative({ "library.sign": (p, on) => { on({ phase: "reading" }); on({ phase: "signing" }); return {}; }, "library.install": { bundleId: "a" } });
  let ui = fakeUI();
  await installFromLibrary({ file: "A.ipa", name: "A" }, { ...ui.deps, native, reachable: async () => true });
  assert.deepEqual(ui.labels.slice(0, 3), ["Reading", "Reading", "Signing"]); // the HUD drops the repeated Reading
  assert.ok(!ui.labels.slice(0, 1).includes("Signing"));
  ui = fakeUI();
  await installFromLibrary({ file: "A.ipa", name: "A", signed: true }, { ...ui.deps, native: fakeNative({ "library.sign": {}, "library.install": { bundleId: "a" } }), reachable: async () => true });
  assert.deepEqual(ui.labels, ["Preparing", "Handing to iOS"]);
});
