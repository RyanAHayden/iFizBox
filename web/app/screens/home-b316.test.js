// B316: Home's slot after an install on this iPhone failed to reach it: the failure, red, until a check passes; a
// signing problem that stops every install stays first, a coming expiry gives way to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fakeDocument } from "../fakes.test-helper.js";

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document ??= fakeDocument();
const { routeTile, slotOrRoute, slotTile, ROUTE_TILE_SUBTITLE } = await import("./home.js");
const { routeWords } = await import("../signing/route.js");
const { routeFailure, clearRouteFailure } = await import("../core/installroute.js");

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const TS_SIGNED_OUT = { paired: "rp", localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: false, address: "100.64.0.2", use: false } };
const refused = Object.assign(new Error("refused: this iPhone refused RemotePairing on port 49152: it no longer has this pairing. Pair again"), { code: "refused" });
const native = (st) => ({ call: (m) => (m === "idevice.status" ? Promise.resolve(st) : Promise.reject(new Error("no"))) });

test("after a failed install the slot says the failure; after a passing check it's gone", async () => {
  clearRouteFailure();
  assert.equal(slotOrRoute(slotTile("sideload", { setUp: true, serverUp: true, identity: null }), routeTile("sideload", routeFailure(), "iphone")), null, "green before");
  const why = await routeWords(refused, { title: "Couldn't Install Unbound", message: refused.message, open: null }, native(TS_SIGNED_OUT));
  assert.equal(why.title, "Tailscale Is Signed Out", "the install's alert and log");
  assert.equal(why.button, "Sign In");
  const t = slotOrRoute(slotTile("sideload", { setUp: true, serverUp: true, identity: null }), routeTile("sideload", routeFailure(), "iphone"));
  assert.deepEqual(t, { stage: "close", kind: "route", title: "Tailscale Is Signed Out", subtitle: ROUTE_TILE_SUBTITLE });
  clearRouteFailure(); // a check passed
  assert.equal(routeTile("sideload", routeFailure(), "iphone"), null);
});

test("only the sideload app installing through This iPhone; signing that stops everything stays first", () => {
  const f = { title: "Tailscale Is Signed Out", short: "x", fix: "signIn" };
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
