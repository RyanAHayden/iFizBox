// This iPhone's page (screens/installroute.js): it draws at once with a spinner while idevice.status answers, then the
// way to connect from the VPN apps installed (idevice.vpnApps, core vpnRoute), and a tap on This iPhone acts at once.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped() and the pair page's sections.
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, leave, connectGroups, setupGroups, pickRoute } = await import("./installroute.js");
const { LOCALDEVVPN_STORE, TAILSCALE_URL, TAILSCALE_ID } = await import("../core/installroute.js");

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const tap = (box, label) => {
  const cell = withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
  assert.ok(cell, `no row ${label}: ${labels(box)}`);
  return Promise.all(cell.listeners.click.map((f) => f({})));
};
const store = (route = "server") => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const VPN_OFF = { paired: null, pairOnPhone: true, localDevVPN: false, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };

// A native bridge whose answers the test gives; every call is recorded.
function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p) => { calls.push([m, p]); const a = answers[m]; return typeof a === "function" ? a(p) : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("the page draws at once: the intro and a spinner while idevice.status answers", async () => {
  let answer;
  const native = bridge({ "idevice.status": () => new Promise((r) => { answer = r; }), "idevice.vpnApps": { localdevvpn: true, tailscale: false } });
  const box = make("div");
  const done = drawInstallation(box, "pair", { store: store(), native, alert: async () => ({ index: 0 }) });
  // before idevice.status answers
  assert.equal(withClass(box, "loading-spinner").length, 1);
  assert.match(withClass(box, "loading")[0].textContent, /Checking/);
  assert.match(box.textContent, /Install on This iPhone/);
  answer(VPN_OFF);
  await done;
  assert.ok(!box.textContent.includes("Checking…"));
  // B133: what spins now is the wait for the VPN
  assert.deepEqual(withClass(box, "loading").map((n) => n.textContent), ["Waiting for LocalDevVPN…"]);
  assert.deepEqual(labels(box), ["LocalDevVPN", "Open LocalDevVPN"]);
  leave();
});

test("only LocalDevVPN: as before, the Turn On LocalDevVPN alert once and Open LocalDevVPN", async () => {
  const native = bridge({ "idevice.status": VPN_OFF, "idevice.vpnApps": { localdevvpn: true, tailscale: false }, "idevice.openLocalDevVPN": { opened: true } });
  const asked = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async (a) => { asked.push(a.title); return { index: a.open }; } });
  await flush();
  assert.deepEqual(asked, ["Turn On LocalDevVPN"]);
  assert.ok(native.calls.some(([m]) => m === "idevice.openLocalDevVPN"));
  leave();
});

test("neither installed: Install LocalDevVPN opens its App Store page, Tailscale named, no jump to LocalDevVPN", async () => {
  const native = bridge({ "idevice.status": VPN_OFF, "idevice.vpnApps": { localdevvpn: false, tailscale: false }, "app.openURL": { opened: true } });
  const asked = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async (a) => { asked.push(a.title); return { index: 0 }; } });
  assert.deepEqual(labels(box), ["LocalDevVPN", "Install LocalDevVPN", "Install Tailscale"]); // F317: Tailscale's own group
  assert.match(box.textContent, /Not Installed/);
  assert.match(box.textContent, /Tailscale/);
  assert.match(box.textContent, /checks again when you come back/);
  assert.deepEqual(asked, []);
  assert.ok(!native.calls.some(([m]) => m === "idevice.openLocalDevVPN"));
  await tap(box, "Install LocalDevVPN");
  assert.deepEqual(native.calls.find(([m]) => m === "app.openURL")[1], { url: LOCALDEVVPN_STORE });
  leave();
});

test("both installed: asks which (Connect With), and the answer is kept with tailscale.setConnect", async () => {
  const native = bridge({ "idevice.status": VPN_OFF, "idevice.vpnApps": { localdevvpn: true, tailscale: true }, "tailscale.setConnect": null });
  const asked = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async (a) => { asked.push(a.title); return { index: 0 }; } });
  assert.match(box.textContent, /Connect With/);
  assert.deepEqual(labels(box), ["LocalDevVPN", "Tailscale"]);
  assert.deepEqual(asked, []);
  await tap(box, "Tailscale");
  assert.deepEqual(native.calls.find(([m]) => m === "tailscale.setConnect")[1], { value: "tailscale" });
  leave();
});

test("only Tailscale: Sign In and Open Tailscale; acting on it makes Connect With Tailscale", async () => {
  const native = bridge({ "idevice.status": VPN_OFF, "idevice.vpnApps": { localdevvpn: false, tailscale: true }, "tailscale.setConnect": null, "signing.openApp": { opened: true } });
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async () => ({ index: 0 }) });
  assert.deepEqual(labels(box), ["Sign In", "Open Tailscale"]);
  assert.ok(!native.calls.some(([m]) => m === "tailscale.setConnect"), "only drawing it changes nothing");
  await tap(box, "Open Tailscale");
  await flush();
  assert.deepEqual(native.calls.find(([m]) => m === "tailscale.setConnect")[1], { value: "tailscale" });
  // B323: by bundle ID; a tailscale: link makes Tailscale show "Could not sign device"
  assert.deepEqual(native.calls.find(([m]) => m === "signing.openApp")[1], { bundleId: TAILSCALE_ID });
  assert.ok(!native.calls.some(([m, p]) => m === "app.openURL" && p?.url === TAILSCALE_URL), "never opens tailscale:");
  leave();
});

test("B323: Open Tailscale says to open it by hand when iOS won't", async () => {
  const native = bridge({ "idevice.status": VPN_OFF, "idevice.vpnApps": { localdevvpn: false, tailscale: true }, "tailscale.setConnect": null, "signing.openApp": { opened: false } });
  const asked = [];
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async (a) => { asked.push(a); return { index: 0 }; } });
  await tap(box, "Open Tailscale");
  await flush();
  assert.equal(asked.at(-1)?.title, "Couldn't Open Tailscale");
  assert.match(asked.at(-1)?.message, /^Open Tailscale from the Home Screen/);
  leave();
});

test("an older shell without idevice.vpnApps keeps the LocalDevVPN page", async () => {
  const native = bridge({ "idevice.status": VPN_OFF, "idevice.vpnApps": new Error("unknown method") });
  const box = make("div");
  await drawInstallation(box, "pair", { store: store(), native, alert: async () => ({ index: 0 }) });
  assert.deepEqual(labels(box), ["LocalDevVPN", "Open LocalDevVPN"]);
  leave();
});

test("already paired: the page checks This iPhone itself", async () => {
  const native = bridge({ "idevice.status": { paired: "rp", localDevVPN: true }, "idevice.vpnApps": { localdevvpn: true, tailscale: false } });
  const s = store("server");
  const box = make("div");
  await drawInstallation(box, "pair", { store: s, native, alert: async () => ({ index: 0 }) });
  assert.equal(s.m.installRoute, "iphone");
  assert.ok(labels(box).includes("Check Connection"));
  leave();
});

test("connect groups: each way's rows and footer (pure)", () => {
  const signedIn = { tailscale: { signedIn: true, address: "100.1.2.3" } };
  assert.deepEqual(connectGroups("tailscale", signedIn)[0].rows.map((r) => [r.label, r.detail]), [["Tailscale", "On"], ["Open Tailscale", undefined]]);
  assert.match(connectGroups("tailscale", signedIn)[0].footer, /^Turn on the Tailscale app's VPN/);
  assert.deepEqual(connectGroups("tailscale", null, { busy: "Log in on the page" })[0].rows[0], { label: "Signing In…", detail: "Log in on the page", spin: true });
  assert.deepEqual(connectGroups("tailscale", null)[0].rows[0], { label: "Tailscale", detail: "Checking…", spin: true }, "B167: no status yet isn't signed out");
  const picked = [];
  connectGroups("ask", null, { choose: (v) => picked.push(v) })[0].rows.forEach((r) => r.onClick());
  assert.deepEqual(picked, ["localdevvpn", "tailscale"]);
  assert.deepEqual(setupGroups("checking", undefined, null)[1], { spinner: "Checking…" });
});

test("F300: a tap on This iPhone is checked at once, paired or not (Pairing shows right under it), never waiting", () => {
  const did = [];
  const h = { set: (v) => did.push(v) };
  pickRoute("iphone", h);
  pickRoute("server", h);
  assert.deepEqual(did, ["iphone", "server"]);
});

test("B321: while pairing, the VPN row names the way in from the last idevice.status (Tailscale, not LocalDevVPN)", async () => {
  const TS_ON = { paired: null, pairOnPhone: true, localDevVPN: false, otherVPN: true, tailscale: { connect: "tailscale", signedIn: true, address: "100.64.0.2", use: true } };
  let stop;
  const native = { call: (m, p, ev) => {
    if (m === "idevice.status") return Promise.resolve(TS_ON);
    if (m === "idevice.vpnApps") return Promise.resolve({ localdevvpn: true, tailscale: true });
    if (m === "idevice.pair") return new Promise((_, no) => { ev?.({ pin: "123456" }); stop = () => no(Object.assign(new Error("canceled"), { code: "canceled" })); });
    return Promise.resolve(null);
  } };
  const box = make("div");
  await drawInstallation(box, "pair", { store: store("iphone"), native, alert: async () => ({ index: 0 }) });
  await flush();
  assert.ok(stop, "idevice.pair started");
  assert.ok(labels(box).includes("Tailscale"), `rows: ${labels(box)}`);
  assert.ok(!labels(box).includes("LocalDevVPN"), `rows: ${labels(box)}`);
  leave();
  stop();
  // pure: no status at all still falls back to LocalDevVPN
  assert.equal(setupGroups("pairing", null, { pin: "1" })[1].rows[0].label, "LocalDevVPN");
  assert.equal(setupGroups("pairing", TS_ON, { pin: "1" })[1].rows[0].label, "Tailscale");
});
