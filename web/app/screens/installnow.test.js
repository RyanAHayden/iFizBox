// F177 (user 2026-11-18: "when the user got to the signing section from clicking install, popup an install now prompt
// alert"): Install that sends the user to Settings > Signing remembers the install (signing.js rememberInstall); the
// Signing page, each time it draws, offers Install Now once signing is ready (offerInstall), once per trip, and never
// when the user opened Signing themselves.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { rememberInstall, pendingInstall, forgetInstall, offerInstall, routeLeftSigning, siteReady } from "./signing.js";
import { installApp } from "./home.js";
import { APP_IPA_URL, APP_NAME } from "../core/appoffer.js";
import { NAME } from "../brand.js";

// A fake showAlert: records what it was asked and taps `tap` (an index).
const fakeAlert = (tap) => {
  const asked = [];
  const alert = async (spec) => { asked.push(spec); return { index: tap }; };
  return { alert, asked };
};

beforeEach(() => forgetInstall());

test("Signing opened directly (nothing remembered): no alert, ready or not", async () => {
  const { alert, asked } = fakeAlert(1);
  assert.equal(pendingInstall(), null);
  assert.equal(await offerInstall(true, { alert }), null);
  assert.equal(await offerInstall(false, { alert }), null);
  assert.equal(asked.length, 0);
});

test("already ready on arrival: the alert at once; Install Now runs the install the tap wanted", async () => {
  let ran = 0;
  rememberInstall({ name: "Delta", run: () => ran++ });
  assert.equal(pendingInstall().name, "Delta");
  const { alert, asked } = fakeAlert(1);
  assert.equal(await offerInstall(true, { alert }), "install");
  assert.equal(ran, 1);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Install Delta?");
  assert.match(asked[0].message, /Delta/);
  assert.deepEqual(asked[0].buttons, ["Later", "Install Now"]);
  assert.equal(asked[0].cancel, 0);
});

test("not ready on arrival: nothing until signing becomes ready, then the alert once", async () => {
  let ran = 0;
  rememberInstall({ name: APP_NAME, run: () => ran++ });
  const { alert, asked } = fakeAlert(1);
  assert.equal(await offerInstall(false, { alert }), null, "certificate missing: no alert yet");
  assert.equal(await offerInstall(false, { alert }), null);
  assert.ok(pendingInstall(), "still remembered while the user sets signing up");
  assert.equal(await offerInstall(true, { alert }), "install", "importIfComplete / passwordOk redraws the page ready");
  assert.equal(await offerInstall(true, { alert }), null, "once per trip: a later redraw asks nothing");
  assert.equal(asked.length, 1);
  assert.equal(ran, 1);
});

test("Later stays on Signing: nothing installs, and it isn't asked again", async () => {
  let ran = 0;
  rememberInstall({ name: "Delta", run: () => ran++ });
  const { alert } = fakeAlert(0);
  assert.equal(await offerInstall(true, { alert }), "later");
  assert.equal(ran, 0);
  assert.equal(pendingInstall(), null);
  assert.equal(await offerInstall(true, { alert }), null);
});

test("a redraw while the alert is up doesn't ask twice", async () => {
  rememberInstall({ name: "Delta", run: () => {} });
  let release;
  const asked = [];
  const alert = (spec) => { asked.push(spec); return new Promise((r) => { release = r; }); };
  const first = offerInstall(true, { alert });
  assert.equal(await offerInstall(true, { alert }), null);
  release({ index: 0 });
  assert.equal(await first, "later");
  assert.equal(asked.length, 1);
});

test("no name: the alert names the app itself", async () => {
  rememberInstall({ run: () => {} });
  const { alert, asked } = fakeAlert(0);
  await offerInstall(true, { alert });
  assert.equal(asked[0].title, `Install ${NAME}?`);
});

test("leaving Signing ends the trip: opening it again later is the user's own", () => {
  assert.equal(routeLeftSigning("#/home/settings/signing"), false);
  assert.equal(routeLeftSigning("#/home/settings/signing/help"), false);
  assert.equal(routeLeftSigning("#/home"), true);
  assert.equal(routeLeftSigning("#/home/settings"), true);
  assert.equal(routeLeftSigning("#/sources"), true);
  // the listener rememberInstall adds forgets on such a route
  const listeners = [];
  const had = { add: globalThis.addEventListener, loc: globalThis.location };
  globalThis.addEventListener = (type, fn) => listeners.push([type, fn]);
  globalThis.location = { hash: "#/home/settings/signing" };
  try {
    rememberInstall({ name: "Delta", run: () => {} });
    const change = listeners.find(([t]) => t === "hashchange")?.[1];
    assert.ok(change, "listens for route changes");
    change();
    assert.ok(pendingInstall(), "still on Signing: kept");
    globalThis.location.hash = "#/home";
    change();
    assert.equal(pendingInstall(), null, "back on Home: forgotten");
  } finally {
    globalThis.addEventListener = had.add;
    globalThis.location = had.loc;
  }
});

test("Home's Install iFizBox App without a certificate remembers the install on its way to Signing", async () => {
  const calls = [];
  const remembered = [];
  const deps = (ready) => ({ ready: async () => ready, bring: () => true, go: (h) => calls.push(["go", h]), installed: () => {},
    install: ({ onInstalled, ...o }) => calls.push(["install", o]), remember: (r) => remembered.push(r),
    sheet: async () => "certificate", free: async () => false, focus: () => {} }); // F385: Sign iFizBox First's pick
  assert.equal(await installApp(deps(false)), "signing");
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].name, APP_NAME);
  assert.deepEqual(calls, [["go", "/home/settings/signing"]]);
  remembered[0].run(); // Install Now
  assert.deepEqual(calls[1], ["install", { url: APP_IPA_URL, name: APP_NAME, bring: true }]);
  assert.equal(await installApp(deps(true)), "install");
  assert.equal(remembered.length, 1, "with a certificate it installs straight away, nothing remembered");
});

test("the website's certificate is ready with the .p12, the profile and a password not known to be wrong", () => {
  const b = new Uint8Array([1]);
  assert.equal(siteReady(null), false);
  assert.equal(siteReady({ p12: b }), false);
  assert.equal(siteReady({ p12: b, profile: b }), false, "no password yet");
  assert.equal(siteReady({ p12: b, profile: b, password: "x", passwordOk: false }), false);
  assert.equal(siteReady({ p12: b, profile: b, password: "x", passwordOk: true }), true);
  assert.equal(siteReady({ p12: b, profile: b, password: "", passwordOk: null }), true);
});

test("every Signing page offers it as it draws (app and website, page and walkthrough); Install redirects remember", () => {
  const settings = readFileSync(new URL("./settings.js", import.meta.url), "utf8");
  for (const fn of ["drawDeviceSigning", "drawSiteSigning", "drawSigningHelp"]) {
    const body = settings.slice(settings.indexOf(`async function ${fn}(`)).split(/\n}\n/)[0];
    assert.match(body, /offerInstall\(/, fn);
  }
  const dir = new URL("../signing/", import.meta.url);
  const client = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  assert.equal((client.match(/rememberInstall\(/g) ?? []).length, 3,
    "the app's first Install, My IPAs' Install (B39) and the website's No Certificate");
});
