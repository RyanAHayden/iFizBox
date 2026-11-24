// B316: Home's slot after an install on this iPhone failed to reach it: the failure, red, until a check passes; a
// signing problem that stops every install stays first, a coming expiry gives way to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document ??= fakeDocument();
const { routeTile, slotOrRoute, slotTile, phoneStatus, paintCert, PAIR_TILE, ROUTE_TILE_SUBTITLE } = await import("./home.js");
const { routeWords } = await import("../signing/route.js");
const { routeFailure, clearRouteFailure } = await import("../core/installroute.js");

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const CELL_ST = { paired: "rp", otherVPN: false, vpn: { available: true, tested: true, cellular: true, shortcuts: {} } };
const refused = Object.assign(new Error("refused: this iPhone refused RemotePairing on port 49152: it no longer has this pairing. Pair again"), { code: "refused" });
const native = (st) => ({ call: (m) => (m === "idevice.status" ? Promise.resolve(st) : Promise.reject(new Error("no"))) });

test("after a failed install the slot says the failure; after a passing check it's gone", async () => {
  clearRouteFailure();
  assert.equal(slotOrRoute(slotTile("sideload", { setUp: true, serverUp: true, identity: null }), routeTile("sideload", routeFailure(), "iphone")), null, "green before");
  const noRoute = Object.assign(new Error("route_refused: every port"), { code: "route_refused" });
  const why = await routeWords(noRoute, { title: "Couldn't Install Unbound", message: noRoute.message, open: null }, native(CELL_ST));
  assert.equal(why.title, "iPhone Refused", "the install's alert and log");
  assert.equal(why.button, "Fix");
  const t = slotOrRoute(slotTile("sideload", { setUp: true, serverUp: true, identity: null }), routeTile("sideload", routeFailure(), "iphone"));
  assert.deepEqual(t, { stage: "close", kind: "route", title: "iPhone Refused", subtitle: ROUTE_TILE_SUBTITLE });
  clearRouteFailure(); // a check passed
  assert.equal(routeTile("sideload", routeFailure(), "iphone"), null);
});

test("only the sideload app installing through This iPhone; signing that stops everything stays first", () => {
  const f = { title: "iPhone Refused", short: "x", fix: "check" };
  assert.equal(routeTile("site", f, "iphone"), null);
  assert.equal(routeTile("jailbreak", f, "iphone"), null);
  assert.equal(routeTile("sideload", f, "server"), null, "the Signing Server route doesn't go through the phone");
  const setup = { stage: "gone", kind: "setup", title: "Signing Needs Setup", subtitle: "y" };
  assert.equal(slotOrRoute(setup, routeTile("sideload", f, "iphone")).kind, "setup");
  const soon = { stage: "soon", kind: "expiry", title: "Certificate Expires Soon", subtitle: "z" };
  assert.equal(slotOrRoute(soon, routeTile("sideload", f, "iphone")).kind, "route");
  assert.equal(slotOrRoute(soon, null).kind, "expiry");
});

test("the slot follows the failure as it's set or cleared, and the install clears it when one goes through", () => {
  const home = src("./home.js");
  assert.match(home, /addEventListener\("ifizbox:route-failure", onRoute\)/);
  assert.match(home, /removeEventListener\("ifizbox:route-failure", onRoute\)/);
  const route = src("../signing/route.js");
  assert.match(route, /if \(route\.route\) why = await routeWords\(e, why, native\)/);
  assert.match(route, /if \(route\.route\) clearRouteFailure\(\)/);
});

test("F410a: This iPhone, not paired: Pair This iPhone, opening Pairing, before a failure; paired or not known: not", () => {
  const f = { title: "iPhone Refused", short: "x", fix: "check" };
  const t = routeTile("sideload", f, "iphone", { paired: null });
  assert.equal(t.title, "Pair This iPhone");
  assert.match(t.href, /settings\/installation\/pair$/);
  assert.equal(routeTile("sideload", null, "iphone", { paired: false }).kind, "pair");
  assert.equal(routeTile("sideload", null, "iphone", { paired: "rp" }), null);
  assert.equal(routeTile("sideload", f, "iphone", { paired: "rp" }).kind, "route");
  assert.equal(routeTile("sideload", null, "iphone", null), null, "no answer: no warning");
  assert.equal(routeTile("sideload", null, "server", { paired: null }), null);
  for (const mode of ["site", "jailbreak"]) assert.equal(routeTile(mode, null, "iphone", { paired: null }), null);
  const setup = { stage: "gone", kind: "setup", title: "Signing Needs Setup", subtitle: "y" };
  assert.equal(slotOrRoute(setup, t).kind, "setup", "signing that stops everything stays first");
  const row = { hidden: true, classList: { toggle() {} }, parts: {}, querySelector(s) { return (this.parts[s] ??= {}); } };
  paintCert(row, t);
  assert.equal(row.hidden, false);
  assert.equal(row.parts[".home-tile"].href, t.href, "a tap opens Pairing");
  assert.equal(row.parts[".cell-subtitle"].textContent, PAIR_TILE.subtitle);
  paintCert(row, routeTile("sideload", f, "iphone", { paired: "rp" }));
  assert.match(row.parts[".home-tile"].href, /settings\/signing$/, "a failure opens Installation & Signing again");
});

test("F410a: idevice.status alone is asked, and only by the sideload app on This iPhone", async () => {
  const calls = [];
  const n = { call: async (m) => { calls.push(m); return { paired: null }; } };
  assert.equal(await phoneStatus("site", "iphone", n), null);
  assert.equal(await phoneStatus("sideload", "server", n), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(await phoneStatus("sideload", "iphone", n), { paired: null });
  assert.deepEqual(calls, ["idevice.status"], "no verify: no VPN");
  assert.equal(await phoneStatus("sideload", "iphone", { call: async () => { throw new Error("no"); } }), null);
  assert.equal(await phoneStatus("sideload", "iphone", undefined), null);
});

test("F410a: read at launch and on coming back: with the slot's check", () => {
  const home = src("./home.js");
  assert.match(home, /const check = async \(\) => \{\n\s+readPhone\(\);/);
  assert.match(home, /visibilityState !== "hidden"\) check\(\)/);
  assert.match(home, /key === ROUTE_KEY && alive\(\)/);
});
