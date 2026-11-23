// B378: an install through the built-in VPN that couldn't start it (no network) says the VPN's own error (vpn_failed),
// worded here, and the Signing Server is still offered.
import test from "node:test";
import assert from "node:assert/strict";
import { routeFailureOf, serverFallback, verifyFailure, BUILTIN_VPN } from "./installroute.js";

const noNetwork = () => Object.assign(new Error(`vpn_failed: ${BUILTIN_VPN} can't start without a network: iOS starts a VPN only with Wi-Fi or cellular data on`), { code: "vpn_failed" });
const ST = { paired: "rp", otherVPN: false, tunnels: [],
  vpn: { available: true, entitled: true, bundled: true, tested: true, on: false, cellular: false, wifi: false } };

test("vpn_failed reads as the built-in VPN's own error, not a connect failure", () => {
  const why = verifyFailure(noNetwork(), ST);
  assert.equal(why.title, `${BUILTIN_VPN} Didn't Start`);
  assert.match(why.message, /without a network/);
  assert.match(why.message, /\.$/);
  assert.equal(why.again, false);
  assert.doesNotMatch(`${why.title} ${why.message}`, /socket|Pair/);
});

test("vpn_failed is a route failure: Check Again as the fix, a short line for the status cell", () => {
  const f = routeFailureOf(noNetwork(), ST);
  assert.ok(f);
  assert.equal(f.fix, "check");
  assert.equal(f.button, "Check Again");
  assert.match(f.short, /Wi-Fi or cellular data/);
});

test("an install that hit vpn_failed still offers the Signing Server", () => {
  const f = serverFallback(noNetwork(), { route: "idevice" }, ST);
  assert.ok(f, "offers the Signing Server");
  assert.equal(f.title, `${BUILTIN_VPN} Didn't Start`);
  assert.equal(serverFallback(noNetwork(), { route: "server" }, ST), null);
});

test("another vpn_failed reason keeps its own words", () => {
  const f = routeFailureOf({ code: "vpn_failed", message: `vpn_failed: ${BUILTIN_VPN} didn't connect in 20 s` }, ST);
  assert.equal(f.message, `${BUILTIN_VPN} didn't connect in 20 s.`);
  assert.equal(f.short, `${BUILTIN_VPN} didn't start.`);
});
