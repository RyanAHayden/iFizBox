// F368: This iPhone on cellular: every app is signed first, then the install waits for Airplane Mode and says so.
import test from "node:test";
import assert from "node:assert/strict";
import { appRows, createAppRun, rowStatus, runStatus, airplaneStatus } from "./core/apprun.js";
import { AIRPLANE_ON, AIRPLANE_OFF, AIRPLANE_TIMEOUT, serverFallback, routeFailureOf } from "./core/installroute.js";
import { hereLabel } from "./signing/common.js";
import { openPrepared, herePhase } from "./signing/queue.js";
import { callWithStall } from "./core/signing.js";

const tick = () => new Promise((r) => setImmediate(r));
const job = (id) => ({ id, name: id, url: `https://x/${id}.ipa` });

test("the run waits with every other download and signing before it asks iOS", async () => {
  const rows = appRows([job("a"), job("b")]);
  const signB = {};
  const gate = [];
  const run = createAppRun({ rows, ahead: Infinity, parallel: 3, local: () => true,
    sign: (r) => (r.id === "a" ? Promise.resolve({ token: "ta" }) : new Promise((ok) => { signB.ok = ok; })),
    install: async (r, { progress, allSigned }) => {
      progress("hold", 0);
      await allSigned();
      gate.push(r.id);
      progress("airplane", 0);
      return { installed: true };
    } });
  const end = run.start();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(gate, []);
  assert.equal(rowStatus(rows[0]), "Signed: Waiting to Install");
  assert.match(runStatus(rows), /^Downloading b/);
  signB.ok({ token: "tb" });
  await end;
  assert.deepEqual(gate, ["a", "b"]);
});

test("Cancel on a row held for the other downloads ends it", async () => {
  const rows = appRows([job("a"), job("b")]);
  const run = createAppRun({ rows, ahead: Infinity, local: () => true,
    sign: (r) => (r.id === "a" ? Promise.resolve({ token: "t" }) : new Promise(() => {})),
    install: async (r, { signal, allSigned }) => { await allSigned(); if (signal.aborted) throw new Error("cancelled"); return { installed: true }; } });
  const end = run.start();
  for (let i = 0; i < 4; i++) await tick();
  run.cancel();
  await end;
  assert.ok(rows.every((r) => r.state === "cancelled"));
});

test("the wait, then the line that it can go off, once every app is connected", () => {
  const [a, b] = appRows([job("a"), job("b")]);
  Object.assign(a, { state: "installing", phase: "airplane", here: true, airplane: "on" });
  Object.assign(b, { state: "signed" });
  assert.equal(rowStatus(a), AIRPLANE_ON);
  assert.equal(runStatus([a, b]), AIRPLANE_ON);
  Object.assign(a, { phase: "copying", airplane: "off", fraction: 0.4 });
  assert.equal(airplaneStatus([a, b]), null, "b has yet to connect");
  Object.assign(b, { state: "installing", phase: "copying", here: true, airplane: null, fraction: 0.1 });
  assert.equal(runStatus([a, b]), AIRPLANE_OFF);
  Object.assign(a, { state: "installed" });
  assert.equal(runStatus([a, b]), AIRPLANE_OFF);
});

test("openPrepared waits only on cellular", async () => {
  globalThis.localStorage = { getItem: (k) => (k === "ifizbox.installRoute" ? "iphone" : null), setItem() {}, removeItem() {} };
  const { forgetRoute } = await import("./signing/route.js");
  for (const cellular of [true, false]) {
    forgetRoute();
    const order = [];
    const native = { call: async (m, p, on) => {
      if (m === "idevice.status") return { paired: "rp", vpn: { available: true, tested: true, cellular } };
      if (m === "signing.open") { order.push("open"); on({ phase: "airplane", progress: 0 }); on({ phase: "airplaneOff", progress: 0 }); return { installed: true }; }
      return {};
    } };
    const phases = [];
    await openPrepared({ id: "a", token: "t" }, { tag: "x", native, progress: (p) => phases.push(p), allSigned: async () => { order.push("signed"); } });
    assert.deepEqual(order, cellular ? ["signed", "open"] : ["open"]);
    assert.deepEqual(phases, [...(cellular ? ["hold"] : []), "copying", "airplane", "airplaneOff"]);
  }
  delete globalThis.localStorage;
});

test("labels, and the wait running out", () => {
  assert.deepEqual(hereLabel({ here: "airplane" }), { label: AIRPLANE_ON });
  assert.deepEqual(herePhase({ phase: "airplaneOff", progress: 0 }), { phase: "airplaneOff", fraction: 0 });
  const e = Object.assign(new Error("Airplane Mode wasn't turned on in 5 minutes"), { code: "airplane_timeout" });
  assert.equal(serverFallback(e), AIRPLANE_TIMEOUT);
  assert.equal(routeFailureOf(e), null, "not remembered as a broken route");
});

test("a re-sign's stall limit leaves the airplane wait to the shell", async () => {
  let fired = 0;
  const timers = new Set();
  const native = { call: async (m, p, on) => { on({ phase: "airplane", progress: 0 }); await tick(); fired += timers.size; return "ok"; } };
  await callWithStall(native, "signing.resignAll", {}, () => {}, { later: () => { const t = {}; timers.add(t); return t; }, clear: (t) => timers.delete(t) });
  assert.equal(fired, 0);
});
