// B375: an install through This iPhone with the built-in VPN (iFizBox VPN) that couldn't connect offers its fix on the
// queue run's Log from idevice.status: the queue reads the failure with the status, so the words name the built-in VPN.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map([["ifizbox.installRoute", "iphone"]]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { openPrepared, forgetRoute } = await import("./signing-client.js");
const { serverFallback } = await import("./core/installroute.js");

const socketFailed = () => Object.assign(new Error('connect_failed: InternalError("connect: device socket io failed") (16)'), { code: "connect_failed" });
const BUILTIN = { paired: "rp", otherVPN: true, tunnels: ["utun4"],
  vpn: { available: true, entitled: true, bundled: true, tested: true, on: false, cellular: false, wifi: true, shortcuts: { switch: true } } };

test("serverFallback: a failed connect through the built-in VPN offers the Signing Server and Check Again", () => {
  const f = serverFallback(socketFailed(), { route: "idevice" }, BUILTIN);
  assert.ok(f, "still offers the Signing Server");
  assert.equal(f.fix, "check");
  assert.match(f.message, /iFizBox VPN/);
  assert.doesNotMatch(`${f.button} ${f.title} ${f.message} ${f.short}`, /LocalDevVPN|Tailscale/i);
});

test("openPrepared: a This iPhone row that failed reads idevice.status for its fix", async () => {
  forgetRoute();
  const calls = [];
  const native = {
    call: async (m, p) => {
      calls.push(m);
      if (m === "idevice.status") return BUILTIN;
      if (m === "signing.open") throw socketFailed();
      return null;
    },
  };
  const err = await openPrepared({ id: "a", name: "Alpha", token: "t", bundleId: "a" }, { tag: "a#1", native }).then(() => null, (e) => e);
  assert.ok(err?.fallback, "the row's error carries the fallback");
  assert.equal(err.fallback.fix, "check");
  assert.ok(calls.lastIndexOf("idevice.status") > calls.indexOf("signing.open"), "read after the failure");
});
