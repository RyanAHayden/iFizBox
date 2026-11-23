// B375: an install through This iPhone with the built-in VPN (iFizBox VPN) that couldn't connect offered "Open
// LocalDevVPN" as the row's fix on the queue run's Log (the user's phone, Install Switch added): the queue read the
// failure without idevice.status, so it took the route for LocalDevVPN's. The fix now comes from the status.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map([["ifizbox.installRoute", "iphone"]]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { openPrepared, forgetRoute } = await import("./signing-client.js");
const { serverFallback } = await import("./core/installroute.js");

const socketFailed = () => Object.assign(new Error('connect_failed: InternalError("connect: device socket io failed") (16)'), { code: "connect_failed" });
const BUILTIN = { paired: "rp", localDevVPN: false, otherVPN: true, tunnels: ["utun4"],
  vpn: { available: true, entitled: true, bundled: true, tested: true, on: false, cellular: false, wifi: true, shortcuts: { switch: true } },
  tailscale: { connect: "tailscale", signedIn: true, use: true } };

test("serverFallback: through the built-in VPN a failed connect never offers Open LocalDevVPN", () => {
  const without = serverFallback(socketFailed(), { route: "idevice" });
  assert.equal(without.fix, "openVPN", "without the status it can only guess LocalDevVPN (the bug)");
  const f = serverFallback(socketFailed(), { route: "idevice" }, BUILTIN);
  assert.ok(f, "still offers the Signing Server");
  assert.notEqual(f.fix, "openVPN");
  assert.doesNotMatch(`${f.button} ${f.title} ${f.message} ${f.short}`, /LocalDevVPN/);
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
  assert.notEqual(err.fallback.fix, "openVPN");
  assert.doesNotMatch(err.fallback.button, /LocalDevVPN/);
  assert.ok(calls.lastIndexOf("idevice.status") > calls.indexOf("signing.open"), "read after the failure");
});
