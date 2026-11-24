// F58: signing-client.js in the sideload build, against a fake ifizboxNative: status and import calls, the picks
// kept in memory, Install's HUD following signing.install's phases, and its errors by code.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeNative } from "./fakes.test-helper.js";
import {
  localSigning, signingReady, deviceStatus, importToDevice, removeFromDevice,
  installOnDevice, loadIdentity, saveIdentity, clearIdentity, firstInstallCheck, getServer, setServer,
} from "./signing-client.js";
import { walkOpen } from "./screens/signing.js";
import { IFIZBOX_ID } from "./core/websign.js";

const coded = (code, message) => Object.assign(new Error(message), { code });
function fakeUI() {
  const ui = { labels: [], hidden: 0, alerts: [], went: [], later: [], followed: [] };
  ui.deps = {
    hud: (t) => { ui.labels.push(t); return { set: (x) => ui.labels.push(x), hide: () => { ui.hidden++; } }; },
    alert: async (a) => { ui.alerts.push(a); return { index: 0 }; },
    go: (path) => ui.went.push(path),
    later: (f, ms) => ui.later.push([f, ms]),
    follow: (n, id, h, o) => ui.followed.push({ id, name: o.name }),
  };
  return ui;
}

let saved;
beforeEach(() => { saved = globalThis.ifizboxNative; });
afterEach(async () => { await clearIdentity().catch(() => {}); globalThis.ifizboxNative = saved; });

test("only the sideload build signs (F89: the website has no signer)", async () => {
  globalThis.ifizboxNative = fakeNative();
  assert.equal(localSigning(), true);
  delete globalThis.ifizboxNative;
  assert.equal(localSigning(), false);
  assert.equal(await signingReady(), false);
});

test("the Signing Server: brand.js SIGN_HOST (sign.ifizbox.com) by default, and the website's own address means the default", () => {
  const m = new Map();
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  try {
    assert.equal(getServer(), "https://sign.ifizbox.com");
    m.set("ifizbox.signingServer", "https://ifizbox.com");
    assert.equal(getServer(), "https://sign.ifizbox.com");
    assert.equal(setServer("my.example.org"), "https://my.example.org");
    assert.equal(getServer(), "https://my.example.org");
    setServer("https://ifizbox.com");
    assert.equal(m.has("ifizbox.signingServer"), false);
    setServer("");
    assert.equal(getServer(), "https://sign.ifizbox.com");
  } finally { globalThis.localStorage = saved; }
});

test("ready once the Keychain holds an identity", async () => {
  globalThis.ifizboxNative = fakeNative({ "signing.status": { identity: null } });
  assert.equal(await signingReady(), false);
  globalThis.ifizboxNative = fakeNative({ "signing.status": { identity: { name: "X" } } });
  assert.equal(await signingReady(), true);
  globalThis.ifizboxNative = fakeNative({ "signing.status": coded("internal", "boom") });
  assert.equal(await signingReady(), false);
});

test("the picks stay in memory in the sideload build", async () => {
  globalThis.ifizboxNative = fakeNative();
  await saveIdentity({ p12: new Uint8Array([0x30, 1]), p12Name: "me.p12" });
  await saveIdentity({ password: "pw" });
  const id = await loadIdentity();
  assert.equal(id.p12Name, "me.p12");
  assert.equal(id.password, "pw");
  await clearIdentity();
  assert.equal(await loadIdentity(), null);
});

test("status, import (base64) and remove go to their bridge calls", async () => {
  const st = { identity: { name: "X" } };
  const n = fakeNative({ "signing.status": st, "signing.import": st, "signing.remove": { identity: null } });
  assert.equal(await deviceStatus(n), st);
  await importToDevice({ p12: new Uint8Array([1, 2, 3]), profile: new Uint8Array([4, 5]), password: "pw" }, n);
  await importToDevice({ p12: new Uint8Array([1]), profile: new Uint8Array([2]) }, n);
  await removeFromDevice(n);
  assert.deepEqual(n.calls.map((c) => c.method), ["signing.status", "signing.import", "signing.import", "signing.remove"]);
  assert.deepEqual(n.calls[1].params, { p12: "AQID", profile: "BAU=", password: "pw" });
  assert.equal(n.calls[2].params.password, "");
});

// F75 (1): the first Install with no certificate (or no server) asks first (Set Up Signing), then opens the walkthrough at that step.
test("first install: no certificate opens Settings > Signing at the certificate step", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": { identity: null } });
  assert.equal(await firstInstallCheck({ native: n, server: "https://ifizbox.com", go: (p) => went.push(p), alert: async () => ({ index: 1 }), wait: async () => {} }), "certificate");
  assert.deepEqual(went, [["signing"]]);
  assert.deepEqual(walkOpen, { certificate: true, server: false });
});

test("first install: Cancel on Set Up Signing stays on the page", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": { identity: null } });
  assert.equal(await firstInstallCheck({ native: n, server: "https://ifizbox.com", go: (p) => went.push(p), alert: async () => ({ index: 0 }), wait: async () => {} }), "cancel");
  assert.deepEqual(went, []);
});

test("first install: a certificate but no usable server opens the server step", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": { identity: { name: "X" } } });
  for (const server of [null, "http://plain.example"]) {
    assert.equal(await firstInstallCheck({ native: n, server, go: (p) => went.push(p), alert: async () => ({ index: 1 }), wait: async () => {} }), "server");
  }
  assert.deepEqual(walkOpen, { certificate: false, server: true });
  assert.equal(went.length, 2);
});

test("first install: certificate and server there, Install goes on (no wait for anything else)", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": { identity: { name: "X" } } });
  assert.equal(await firstInstallCheck({ native: n, server: "https://ifizbox.com", go: (p) => went.push(p), alert: async () => ({ index: 1 }) }), null);
  assert.deepEqual(went, []);
  assert.deepEqual(n.calls.map((c) => c.method), ["signing.status"]);
});

test("first install: a signer that doesn't answer counts as no certificate", async () => {
  const went = [];
  const n = fakeNative({ "signing.status": coded("internal", "boom") });
  assert.equal(await firstInstallCheck({ native: n, server: "https://ifizbox.com", go: (p) => went.push(p), alert: async () => ({ index: 1 }), wait: async () => {} }), "certificate");
});

test("Install: the HUD follows the phases, then Waiting for iOS, and records the app", async () => {
  const done = { bundleId: "com.x", name: "X", version: "1.0", removed: [] };
  const n = fakeNative({
    "signing.install": async (params, onEvent) => {
      for (const ev of [{ phase: "downloading", progress: 0.5 }, { phase: "downloading", progress: 1 }, { phase: "reading", progress: 0 },
        { phase: "signing", progress: 0.25 }, { phase: "handoff", progress: 0 }]) onEvent(ev);
      return done;
    },
  });
  const ui = fakeUI();
  let recorded = null;
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "X", onInstalled: (r) => { recorded = r; } }, { native: n, ...ui.deps }), true);
  assert.deepEqual(n.calls[0], { method: "signing.hold", params: { on: true } }); // B252: held from Confirm
  assert.deepEqual(n.calls[1], { method: "signing.install", params: { url: "https://e.example/x.ipa", manifestServer: "https://sign.ifizbox.com" } }); // the manifest from the signing server
  assert.deepEqual(n.calls[2], { method: "signing.hold", params: { on: false } });
  assert.deepEqual(ui.labels, ["Downloading", "Downloading 50%", "Downloading", "Reading", "Signing 25%", "Handing to iOS", "Waiting for iOS"]);
  assert.equal(recorded, done);
  assert.equal(ui.alerts.length, 0);
  assert.equal(ui.hidden, 0);
  assert.deepEqual(ui.followed, [{ id: "com.x", name: "X" }]); // F169: then iOS's own install, ending on Open X
  assert.equal(ui.later.length, 0);
});

// F169: the plain Install ends like Custom Install (F155's Open <app>) when signing.install answers the app's ID.
test("Install: follows iOS's install with the signed app's ID and name", async () => {
  const n = fakeNative({ "signing.install": { bundleId: "com.me.delta", name: "Delta" } });
  const ui = fakeUI();
  assert.equal(await installOnDevice({ url: "https://e.example/d.ipa", name: "delta.ipa" }, { native: n, ...ui.deps }), true);
  assert.deepEqual(ui.followed, [{ id: "com.me.delta", name: "Delta" }]);
});

test("Install: the real followInstall ends on Done once iOS has the link, without following iOS (user 2026-11-18)", async () => {
  const n = fakeNative({ "signing.install": { bundleId: "com.x", name: "X" } });
  const ui = fakeUI();
  delete ui.deps.follow;
  const finished = [];
  const hud = (t) => ({ set: (x) => ui.labels.push(x), hide: () => { ui.hidden++; }, finish: (f) => finished.push(f) });
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "X" }, { native: n, ...ui.deps, hud }), true);
  for (let i = 0; i < 20 && !finished.length; i++) await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(n.calls.map((c) => c.method), ["signing.hold", "signing.install", "signing.hold"]);
  assert.equal(finished[0]?.status, "Sent to iOS. Press Home to watch it install."); // F252
  assert.equal(ui.hidden, 0);
});

test("Install: no bundleId from the signer ends on Done as before", async () => {
  const n = fakeNative({ "signing.install": { name: "X" } });
  const ui = fakeUI();
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "X" }, { native: n, ...ui.deps }), true);
  assert.deepEqual(ui.followed, []);
  assert.equal(ui.later[0][1], 1200); // then the checkmark, which fades on its own
  ui.later[0][0]();
  assert.equal(ui.hidden, 1);
});

// (host: true too, but its banner needs a DOM, so it isn't run here.)
test("Install: iFizBox itself (its own IPA, or its ID) isn't followed", async () => {
  const self = "https://github.com/RyanAHayden/iFizBox/releases/latest/download/iFizBox.ipa";
  for (const [opts, answer] of [
    [{ url: self }, { bundleId: "com.x" }],
    [{ url: "https://e.example/c.ipa" }, { bundleId: IFIZBOX_ID }],
  ]) {
    const n = fakeNative({ "signing.install": answer });
    const ui = fakeUI();
    assert.equal(await installOnDevice({ name: "iFizBox", ...opts }, { native: n, ...ui.deps }), true);
    assert.deepEqual(ui.followed, [], JSON.stringify(opts));
    assert.equal(ui.later[0][1], 1200);
  }
});

for (const code of ["no_server", "no_identity"]) {
  test(`Install: ${code} explains and opens Settings > Signing`, async () => {
    const n = fakeNative({ "signing.install": coded(code, "no") });
    const ui = fakeUI();
    let recorded = false;
    assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", onInstalled: () => { recorded = true; } }, { native: n, ...ui.deps }), false);
    assert.equal(ui.hidden, 1);
    assert.equal(ui.alerts.length, 1);
    assert.deepEqual(ui.went, [["signing"]]);
    assert.equal(recorded, false);
  });
}

test("Install: other errors show the signer's message and stay put", async () => {
  const n = fakeNative({ "signing.install": async (p, onEvent) => { onEvent({ phase: "downloading", progress: 0.1 }); throw coded("too_large", "the IPA is bigger than 4 GB"); } });
  const ui = fakeUI();
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa", name: "Big" }, { native: n, ...ui.deps }), false);
  assert.deepEqual(ui.alerts[0], { title: "Couldn't Install Big", message: "The IPA is bigger than 4 GB", buttons: ["OK"] });
  assert.deepEqual(ui.went, []);
  assert.equal(ui.hidden, 1);
});

test("Install without a bridge fails with an alert, not a throw", async () => {
  delete globalThis.ifizboxNative;
  const ui = fakeUI();
  assert.equal(await installOnDevice({ url: "https://e.example/x.ipa" }, ui.deps), false);
  assert.equal(ui.alerts.length, 1);
});
