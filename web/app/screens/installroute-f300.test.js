// F300: Settings > Installation & Signing (sideload build): one Install Apps With row on the main page; its page holds
// the choice and the chosen route's groups; no LocalDevVPN rows when Tailscale is the way in; no Developer Mode row
// (an install it stops says so in its alert); checkmark choices that need a call move at once and spin until it answers.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDocument } from "../fakes.test-helper.js";

// The shared fake DOM: enough for nav/ui.js grouped().
globalThis.document = fakeDocument();
const make = (tag) => document.createElement(tag);

const { drawInstallation, installationGroups, hudHooks, withDetail } = await import("./installroute.js");
const { tailscaleRoute, developerModeFailure, DEV_MODE_STEPS, CHECKING } = await import("../core/installroute.js");
const { deviceError } = await import("../core/signing.js");

const all = (e) => [e, ...e.children.flatMap(all)];
const withClass = (box, c) => all(box).filter((n) => n._cls.has(c));
const labels = (box) => withClass(box, "cell-label").map((n) => n.textContent);
const cellOf = (box, label) => withClass(box, "cell-inner").find((n) => withClass(n, "cell-label")[0]?.textContent === label);
const spins = (box, label) => withClass(cellOf(box, label), "loading-spinner").length === 1;
const tap = (box, label) => {
  const cell = cellOf(box, label);
  assert.ok(cell, `no row ${label}: ${labels(box)}`);
  return Promise.all(cell.listeners.click.map((f) => f({})));
};
const store = (route) => { const m = { installRoute: route }; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const later = () => { let answer; const p = new Promise((r) => { answer = r; }); return { p, answer }; };
const PAIRED_ON = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false } };
const LDV_ROWS = ["LocalDevVPN", "Open LocalDevVPN"];
const hasLdv = (rows) => rows.some((r) => LDV_ROWS.includes(r.label));

function bridge(answers) {
  const calls = [];
  return { calls, call: (m, p, ev) => { calls.push(m); const a = answers[m]; return typeof a === "function" ? a(p, ev) : a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } };
}

test("Tailscale is the way in: Connect With Tailscale, or Automatic with Tailscale signed in and on", () => {
  const st = (ts, extra = {}) => ({ paired: "rp", ...extra, tailscale: ts });
  assert.equal(tailscaleRoute(st({ connect: "tailscale", signedIn: false })), true);
  assert.equal(tailscaleRoute(st({ connect: "auto", signedIn: true, address: "100.1.2.3" })), true);
  assert.equal(tailscaleRoute(st({ connect: "auto", use: true })), true);
  assert.equal(tailscaleRoute(st({ connect: "auto", signedIn: true, address: null })), false, "its VPN off");
  assert.equal(tailscaleRoute(st({ connect: "auto", signedIn: false, address: "100.1.2.3" })), false, "not signed in");
  assert.equal(tailscaleRoute(st({ connect: "localdevvpn", signedIn: true, address: "100.1.2.3" })), false);
  assert.equal(tailscaleRoute(null), false);
  assert.equal(tailscaleRoute(null, "tailscale"), true, "a pick ahead of the status");
});

test("This iPhone's group: no LocalDevVPN row, Open LocalDevVPN or its footer when Tailscale is the way in", () => {
  const via = (ts) => installationGroups("iphone", { ...PAIRED_ON, localDevVPN: false, tailscale: ts })[1];
  for (const ts of [{ connect: "tailscale", signedIn: true }, { connect: "auto", signedIn: true, address: "100.1.2.3" }]) {
    const g = via(ts);
    assert.deepEqual(g.rows.map((r) => r.label), ["Pairing"]);
    assert.equal(g.footer, undefined);
  }
  const ldv = via({ connect: "auto", signedIn: false });
  assert.deepEqual(ldv.rows.map((r) => r.label), ["Pairing", ...LDV_ROWS]);
  assert.match(ldv.footer, /^LocalDevVPN must be on/);
  // while the page reads again, the last answer decides, so the rows don't come and go
  const hint = { ...PAIRED_ON, tailscale: { connect: "tailscale", signedIn: true } };
  const g = installationGroups("iphone", null, { reading: true, hint });
  assert.ok(!hasLdv(g[1].rows), g[1].rows.map((r) => r.label).join(", "));
  assert.equal(g[2].rows.find((r) => r.checked).label, "Tailscale", "Connect With keeps the last answer while it reads");
});

test("no Developer Mode row; an install it stops says so in its alert, with the steps", () => {
  const gs = installationGroups("iphone", PAIRED_ON);
  assert.ok(!gs.flatMap((g) => g.rows ?? []).some((r) => /Developer Mode/.test(r.label)));
  assert.ok(!gs.some((g) => /Developer Mode/.test(g.footer ?? "")));
  for (const e of [Object.assign(new Error("x"), { code: "developer_mode" }), Object.assign(new Error("install_failed: DeveloperModeRequired"), { code: "install_failed" }),
    new Error("Developer Mode is off")]) {
    const why = deviceError(e, "Delta");
    assert.equal(why.title, "Turn On Developer Mode");
    assert.ok(why.message.includes(DEV_MODE_STEPS));
  }
  assert.equal(developerModeFailure(new Error("install_failed: ApplicationVerificationFailed")), null);
  assert.equal(deviceError(new Error("disk full"), "Delta").title, "Couldn't Install Delta");
  assert.doesNotMatch(CHECKING.subtitle, /Developer Mode/);
});

test("the main page's Install Apps With detail: This iPhone's pairing (the route is the row's own label)", () => {
  assert.equal(withDetail("server", PAIRED_ON), "");
  assert.equal(withDetail("iphone", PAIRED_ON), "Paired");
  assert.equal(withDetail("iphone", { paired: null }), "Not Paired");
  assert.equal(withDetail("iphone", null), "");
});

test("Install Apps With: a tap moves the checkmark at once and spins that row until idevice.status answers; the route's groups follow", async () => {
  const st = later();
  let n = 0;
  const native = bridge({ "idevice.status": () => (n++ ? st.p : Promise.resolve(PAIRED_ON)) });
  const s = store("server");
  const box = make("div");
  const server = () => [{ header: "Signing Server", rows: [{ label: "Server", detail: "ifizbox.com" }, { label: "Check Server" }, { label: "Run Your Own" }] }];
  await drawInstallation(box, "with", { store: s, native, server });
  assert.deepEqual(labels(box), ["This iPhone", "Signing Server", "Server", "Check Server", "Run Your Own"]);
  assert.ok(!spins(box, "Signing Server"), "the first draw doesn't spin the Signing Server choice");
  tap(box, "This iPhone");
  assert.equal(s.m.installRoute, "iphone");
  assert.ok(spins(box, "This iPhone"), "spins at once");
  assert.ok(labels(box).includes("Pairing"), `This iPhone's groups come in at once: ${labels(box)}`);
  assert.ok(!labels(box).includes("Check Server"));
  st.answer(PAIRED_ON);
  await flush();
  await flush();
  assert.ok(!spins(box, "This iPhone"), "the spinner goes once the status answers");
  assert.ok(labels(box).includes("Connect With") || labels(box).includes("Automatic"));
});

test("Connect With: a tap moves the checkmark at once with the spinner, no HUD, until setConnect and the status answer", async () => {
  const huds = [];
  hudHooks.show = (l) => { huds.push(l); return () => {}; };
  hudHooks.delay = 0;
  const set = later(), again = later();
  let n = 0;
  const native = bridge({ "idevice.status": () => (n++ ? again.p : Promise.resolve(PAIRED_ON)), "tailscale.setConnect": () => set.p });
  const box = make("div");
  await drawInstallation(box, "iphone", { store: store("iphone"), native });
  assert.ok(labels(box).includes("LocalDevVPN"));
  tap(box, "Tailscale");
  const rowsNow = withClass(box, "cell-inner").filter((c) => withClass(c, "cell-label")[0]?.textContent === "Tailscale");
  assert.ok(rowsNow.some((c) => withClass(c, "loading-spinner").length === 1), "the Tailscale choice spins at once");
  assert.ok(!labels(box).includes("Open LocalDevVPN"), "Tailscale picked: the LocalDevVPN rows go at once");
  assert.deepEqual(huds, [], "no HUD over a checkmark choice");
  set.answer(null);
  await flush();
  assert.ok(withClass(box, "loading-spinner").length >= 1, "still spinning while the status reads");
  again.answer({ ...PAIRED_ON, tailscale: { connect: "tailscale", signedIn: true, name: "ifizbox-on-iphone", address: "100.1.2.3" } });
  await flush();
  await flush();
  assert.equal(withClass(box, "loading-spinner").length, 0, `nothing spins once it answered: ${labels(box)}`);
  assert.ok(!labels(box).includes("Open LocalDevVPN"));
  assert.ok(labels(box).includes("Sign Out"));
});
