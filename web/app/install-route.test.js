// signing-client.js chooseRoute: what an install sends for Settings > Installation's route, and its alerts.
import test from "node:test";
import assert from "node:assert/strict";

const store = (v) => ({ getItem: (k) => (k === "ifizbox.installRoute" ? v : null) });
const fake = (status, calls = []) => ({ call: async (m, p) => { calls.push(m); if (m === "idevice.status") { if (status instanceof Error) throw status; return status; } return { opened: true }; } });
const { chooseRoute, forgetRoute } = await import("./signing-client.js");
const VPN = { available: true, tested: true, cellular: false };

test("Signing Server chosen: nothing asked, nothing added", async () => {
  forgetRoute();
  const calls = [];
  assert.deepEqual(await chooseRoute({ native: fake({}, calls), storage: store(null), alert: () => assert.fail("no alert") }), {});
  assert.deepEqual(calls, []);
});

test("This iPhone, paired, with the built-in VPN: route idevice, no alert", async () => {
  forgetRoute();
  const r = await chooseRoute({ native: fake({ paired: "rp", vpn: VPN }), storage: store("iphone"), alert: () => assert.fail("no alert") });
  assert.deepEqual(r, { route: "idevice" });
});

test("a profile without Network Extensions: the server, said in an alert", async () => {
  forgetRoute();
  const seen = [];
  const r = await chooseRoute({ native: fake({ paired: "rp" }), storage: store("iphone"), alert: async (a) => { seen.push([a.title, a.buttons]); return { index: 0 }; } });
  assert.deepEqual(r, {});
  assert.deepEqual(seen, [["No Network Extensions", ["OK"]]]);
});

test("not paired, or no answer: the server, said in an alert", async () => {
  for (const [st, title] of [[{ paired: null, vpn: VPN }, "Not Paired"], [new Error("down"), "Can't Reach This iPhone"]]) {
    forgetRoute();
    const seen = [];
    const r = await chooseRoute({ native: fake(st), storage: store("iphone"), alert: async (a) => { seen.push(a.title); return { index: 0 }; } });
    assert.deepEqual(r, {});
    assert.deepEqual(seen, [title]);
  }
});

test("on cellular without the Install Switch: Use Server goes through the server", async () => {
  const st = { paired: "rp", vpn: { ...VPN, cellular: true, shortcuts: {} } };
  forgetRoute();
  const seen = [];
  assert.deepEqual(await chooseRoute({ native: fake(st), storage: store("iphone"), alert: async (a) => { seen.push(a.title); return { index: 0 }; } }), {});
  assert.deepEqual(seen, ["Add the Install Switch"]);
});

test("a run asks once: the answer holds for a minute", async () => {
  forgetRoute();
  let t = 0, asked = 0;
  const opts = { native: fake({ paired: "rp" }), storage: store("iphone"), now: () => t, alert: async () => { asked++; return { index: 0 }; } };
  await chooseRoute(opts);
  t = 30_000; await chooseRoute(opts);
  assert.equal(asked, 1);
  t = 120_000; await chooseRoute(opts);
  assert.equal(asked, 2);
});
