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
  vpn: { available: true, entitled: true, bundled: true, tested: true, on: false, cellular: false, wifi: true } };

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

test("B416: a queue row whose first connect was reset: the red line, Pair Again, and the kept failure", async () => {
  forgetRoute();
  store.delete("ifizbox.routeFailure");
  const e = Object.assign(new Error('Socket(Os { code: 54, kind: ConnectionReset, message: "Connection reset by peer" }) (1)'), { code: "connect_failed" });
  const native = { call: async (m) => { if (m === "idevice.status") return BUILTIN; if (m === "signing.open") throw e; return null; } };
  const err = await openPrepared({ id: "a", name: "Feather", token: "t", bundleId: "a" }, { tag: "a#1", native }).then(() => null, (x) => x);
  assert.equal(err.message, "This iPhone isn't paired with iFizBox any more. Pair again.");
  assert.equal(err.fallback.fix, "pair");
  assert.equal(err.fallback.button, "Fix");
  assert.equal(JSON.parse(store.get("ifizbox.routeFailure")).fix, "pair");
  // an install that goes through clears it
  const ok = { call: async (m) => (m === "idevice.status" ? BUILTIN : m === "signing.open" ? { installed: true } : null) };
  await openPrepared({ id: "a", name: "Feather", token: "t", bundleId: "a" }, { tag: "a#2", native: ok });
  assert.equal(store.has("ifizbox.routeFailure"), false);
  // a timeout, a mid-install drop: not the pairing
  for (const [code, text] of [["connect_failed", "Socket(Kind(TimedOut)) (1)"], ["upload_failed", e.message], ["timeout", "no answer from iOS for 30 s"]]) {
    const bad = { call: async (m) => { if (m === "idevice.status") return BUILTIN; if (m === "signing.open") throw Object.assign(new Error(text), { code }); return null; } };
    const x = await openPrepared({ id: "a", name: "Feather", token: "t", bundleId: "a" }, { tag: "a#3", native: bad }).then(() => null, (y) => y);
    assert.doesNotMatch(`${x.message} ${JSON.stringify(x.fallback ?? {})}`, /pair|Socket/i);
    // F409: kept too when it is the route's (the status cell says Fix)
    assert.equal(JSON.parse(store.get("ifizbox.routeFailure") ?? "null")?.fix, x.fallback?.fix);
    store.delete("ifizbox.routeFailure");
  }
});
