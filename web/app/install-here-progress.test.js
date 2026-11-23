// B111: the This iPhone route's progress (installd through the built-in VPN): no iOS prompt, so the run's row goes Signing ->
// Copying to iPhone N% -> Installing N% -> Installed, the bar follows those numbers, the log says what happened (no
// "Asked iOS"), and the row ends installed at once. iFizBox itself says it will restart. signing-client.js maps the
// shell's events (herePhase for signing.open, hereLabel for signing.install).
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map([["ifizbox.installRoute", "iphone"]]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { herePhase, hereLabel, openPrepared, forgetRoute } = await import("./signing-client.js");
const { appRows, createAppRun, rowStatus, runStatus, runPercent, SELF_RESTART, SELF_CLOSING, selfClosing } = await import("./core/apprun.js");
const { SELF_ID } = await import("./core/appqueue.js");
const { openRow } = await import("./screens/apprun.js");
const { NAME } = await import("./brand.js");

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

test("herePhase: signing.open's copying / installing events, clamped; anything else is not a step", () => {
  assert.deepEqual(herePhase({ phase: "copying", progress: 0.42 }), { phase: "copying", fraction: 0.42 });
  assert.deepEqual(herePhase({ phase: "installing", progress: 1.5 }), { phase: "installing", fraction: 1 });
  assert.deepEqual(herePhase({ phase: "installing", progress: "x" }), { phase: "installing", fraction: 0 });
  assert.equal(herePhase({ phase: "here", progress: 0.5 }), null);
  assert.equal(herePhase({ log: "Connected to iOS" }), null);
  assert.equal(herePhase(null), null);
});

test("hereLabel: signing.install's {here} events as the page's step and percent", () => {
  assert.deepEqual(hereLabel({ here: "copying", progress: 0 }), { label: "Copying to iPhone" });
  assert.deepEqual(hereLabel({ here: "copying", progress: 0.4 }), { label: "Copying to iPhone 40%" });
  assert.deepEqual(hereLabel({ here: "installing", progress: 0.75 }), { label: "Installing 75%" });
  assert.deepEqual(hereLabel({ here: "installing", progress: 1 }), { label: "Installing" });
  assert.equal(hereLabel({ phase: "here", progress: 0.5 }), null);
});

// One row through the run with an install that reports This iPhone's steps; `steps` run in order, then it resolves.
async function hereRun(id, name, steps) {
  const rows = appRows([{ id, name, mode: "install", url: `https://x/${id}.ipa` }]);
  const lines = [];
  const seen = [];
  let go;
  const gate = new Promise((r) => { go = r; });
  const run = createAppRun({
    rows,
    sign: async (r, { progress }) => { progress("signing", 0.5); return { token: "t", bundleId: id }; },
    install: async (r, { progress }) => {
      for (const [phase, f] of steps) {
        progress(phase, f);
        seen.push({ status: rowStatus(r), run: runStatus(rows), pct: runPercent(rows), state: r.state });
      }
      await gate;
      return { installed: true };
    },
    onLog: ({ text }) => lines.push(text),
  });
  const end = run.start();
  return { rows, lines, seen, finish: async () => { go(); await end; await flush(); } };
}

test("a This iPhone row: Copying to iPhone N%, Installing N%, Installed; the bar goes up to 100; no iOS prompt", async () => {
  const t = await hereRun("a", "Alpha", [["copying", 0], ["copying", 0.5], ["copying", 1], ["installing", 0.4], ["installing", 1]]);
  await flush();
  assert.deepEqual(t.seen.map((s) => s.status),
    ["Copying to iPhone", "Copying to iPhone 50%", "Copying to iPhone", "Installing 40%", "Installing"]);
  assert.ok(t.seen.every((s) => s.state === "installing"), "never the prompt's 'asking'");
  assert.equal(t.seen[1].run, "Copying Alpha to iPhone (1 of 1)");
  assert.equal(t.seen[3].run, "Installing Alpha (1 of 1)");
  const pcts = t.seen.map((s) => s.pct);
  assert.deepEqual(pcts, [50, 55, 60, 76, 100]);
  for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] >= pcts[i - 1], "the bar only goes forward");
  await t.finish();
  assert.equal(t.rows[0].state, "installed");
  assert.equal(t.rows[0].unsure, false);
  assert.equal(rowStatus(t.rows[0]), "Installed");
  assert.equal(runPercent(t.rows), 100);
  assert.deepEqual(t.lines, ["Signing Alpha", "Signed Alpha", "Copying Alpha to this iPhone", "Installing Alpha", "Installed Alpha"]);
  assert.ok(!t.lines.some((l) => /Asked iOS|iOS is installing|prompt/.test(l)));
});

test("iFizBox itself on This iPhone: once installd accepts it, the log and the status say it is closing (B173)", async () => {
  assert.equal(SELF_CLOSING, "Closing so iOS can finish");
  assert.equal(SELF_RESTART, SELF_CLOSING, "the older name says the same");
  const t = await hereRun(SELF_ID, NAME, [["copying", 0.5], ["installing", 0.05], ["installing", 0.3], ["installing", 1]]);
  await flush();
  assert.equal(t.seen[0].status, "Copying to iPhone 50%", "not while copying");
  assert.equal(t.lines.filter((l) => l === SELF_CLOSING).length, 1, "said once, at installd's first status");
  assert.equal(t.seen[1].run, `Installing ${NAME}: ${SELF_CLOSING}`);
  assert.equal(t.seen[1].status, SELF_CLOSING, "from the first percent, not only at 100%");
  assert.equal(t.seen[2].status, SELF_CLOSING);
  assert.equal(t.seen[3].status, SELF_CLOSING);
  await t.finish();
});

test("selfClosing: only iFizBox's own row, on This iPhone, once installd has it (B173)", () => {
  const row = (o) => ({ id: SELF_ID, mode: "install", here: true, state: "installing", phase: "installing", fraction: 0.05, ...o });
  assert.equal(selfClosing(row()), true);
  assert.equal(selfClosing(row({ fraction: 0 })), true, "a 0% status counts");
  assert.equal(selfClosing(row({ phase: "copying" })), false, "still copying");
  assert.equal(selfClosing(row({ id: "other" })), false, "another app");
  assert.equal(selfClosing(row({ here: false, phase: "installing" })), false, "iOS's prompt route: the hosted close follows it");
  assert.equal(selfClosing(row({ state: "installed" })), false, "ended");
  assert.equal(selfClosing(row({ state: "asking", phase: "asking" })), false, "the Signing Server's prompt");
  assert.equal(selfClosing(null), false);
  assert.equal(rowStatus(row({ id: "other", name: "Other" })), "Installing 5%");
  assert.equal(rowStatus(row()), SELF_CLOSING);
});

test("the Signing Server route keeps its words: Asked iOS, Tap Install, iOS is installing", async () => {
  const t = await hereRun("b", "Beta", [["asking", 0], ["installing", 0.5]]);
  await flush();
  assert.equal(t.seen[0].status, "Tap Install on the iOS prompt");
  assert.equal(t.seen[0].pct, 50);
  assert.equal(t.seen[1].status, "Installing 50%");
  await t.finish();
  assert.ok(t.lines.includes("Asked iOS to install Beta"));
  assert.ok(t.lines.includes("iOS is installing Beta"));
  assert.equal(t.rows[0].here, false);
});

test("openPrepared on This iPhone: the steps from signing.open's events, installed at its reply, no prompt watch", async () => {
  forgetRoute();
  const calls = [];
  const native = {
    call: async (m, p, onEvent) => {
      calls.push(m);
      if (m === "idevice.status") return { paired: "rp", vpn: { available: true, tested: true } };
      if (m === "signing.open") {
        assert.equal(p.route, "idevice");
        onEvent({ log: "Connected to iOS (RemotePairing tunnel)" });
        onEvent({ phase: "copying", progress: 0.5 });
        onEvent({ phase: "installing", progress: 0.9 });
        return { bundleId: "a", installed: true, expires: "2026-12-01T00:00:00Z" };
      }
      throw new Error(`unexpected ${m}`);
    },
  };
  const steps = [];
  const logs = [];
  const r = await openPrepared({ id: "a", name: "Alpha", token: "t", bundleId: "a" },
    { tag: "a#1", native, progress: (ph, f) => steps.push([ph, f]), log: (l) => logs.push(l) });
  assert.deepEqual(r, { installed: true, expires: "2026-12-01T00:00:00Z" });
  assert.deepEqual(steps, [["copying", 0], ["copying", 0.5], ["installing", 0.9]]);
  assert.ok(!steps.some(([ph]) => ph === "asking"));
  assert.deepEqual(logs, ["Connected to iOS (RemotePairing tunnel)"]);
  assert.ok(!calls.includes("signing.progress"), "no wait for iOS's prompt");
  forgetRoute();
});

test("openRow: Open <app> after one app installed on This iPhone, not for iFizBox, a sent row or the server route", () => {
  const opened = [];
  const lanes = { open: (r) => opened.push(r.bundleId) };
  const row = (patch) => ({ id: "a", name: "Alpha", mode: "install", state: "installed", here: true, unsure: false, bundleId: "a", ...patch });
  const o = openRow([row({})], lanes);
  assert.equal(o.label, "Open Alpha");
  assert.equal(o.action(), false);
  assert.deepEqual(opened, ["a"]);
  assert.equal(openRow([row({ here: false })], lanes), null);
  assert.equal(openRow([row({ id: SELF_ID, bundleId: SELF_ID })], lanes), null);
  assert.equal(openRow([row({ unsure: true })], lanes), null);
  assert.equal(openRow([row({}), row({ id: "b" })], lanes), null);
  assert.equal(openRow([row({})], {}), null);
});

test("openRow: a single-app upgrade on This iPhone offers Open <app> too; a re-sign doesn't", () => {
  const lanes = { open: () => {} };
  const row = (patch) => ({ id: "a", name: "Alpha", mode: "upgrade", state: "installed", here: true, unsure: false, bundleId: "a", ...patch });
  assert.equal(openRow([row({})], lanes)?.label, "Open Alpha");
  assert.equal(openRow([row({ mode: "resign" })], lanes), null);
  assert.equal(openRow([row({ state: "failed" })], lanes), null);
});

// A progressHUD stand-in: what the single install's page was told.
function fakeHud() {
  const said = [];
  const steps = [];
  let finished = null;
  return {
    said, steps, get finished() { return finished; },
    hud: () => ({ set: (t) => said.push(t), done: (t) => said.push(`done:${t}`), hide: () => said.push("hide"), fail: (m) => said.push(`fail:${m}`),
      finish: (o) => { finished = o; }, onCancel: () => {}, cancelled: false, page: { raw: () => {}, step: (t) => steps.push(t) } }),
  };
}
const installNative = (events, reply) => ({
  calls: [],
  async call(m, p, onEvent) {
    this.calls.push(m);
    if (m === "idevice.status") return { paired: "rp", vpn: { available: true, tested: true } };
    if (m === "signing.install") { for (const e of events) onEvent(e); if (reply instanceof Promise) return reply; return reply; }
    if (m === "signing.openApp") return { opened: true };
    throw new Error(`unexpected ${m}`);
  },
});

test("single install on This iPhone: Copying / Installing percents, then Installed with Open <app>, not 'Sent to iOS'", async () => {
  const { installOnDevice } = await import("./signing-client.js");
  forgetRoute();
  const h = fakeHud();
  const native = installNative([{ phase: "signing", progress: 0.5 }, { here: "copying", progress: 0.3 }, { phase: "here", progress: 0.1 },
    { here: "installing", progress: 0.6 }, { phase: "here", progress: 0.72 }], { bundleId: "com.x.alpha", name: "Alpha" });
  let got = null;
  assert.equal(await installOnDevice({ url: "https://x/alpha.ipa", name: "Alpha", onInstalled: (r) => { got = r; } },
    { native, hud: h.hud, alert: () => assert.fail("no alert") }), true);
  assert.deepEqual(h.said, ["Signing 50%", "Copying to iPhone 30%", "Installing 60%", "Installed Alpha 100%"]);
  assert.equal(got?.bundleId, "com.x.alpha");
  assert.equal(h.finished.status, "Installed Alpha");
  assert.equal(h.finished.also.label, "Open Alpha");
  h.finished.also.action();
  await flush();
  assert.ok(native.calls.includes("signing.openApp"));
  assert.ok(!h.said.some((s) => /Sent to iOS/.test(s)));
  forgetRoute();
});

test("iFizBox's own update on This iPhone: 'Closing so iOS can finish' as installd starts (the app closes, no reply)", async () => {
  const { installOnDevice } = await import("./signing-client.js");
  forgetRoute();
  const h = fakeHud();
  const native = installNative([{ here: "copying", progress: 0.5 }, { here: "installing", progress: 0.1 }, { here: "installing", progress: 0.9 }],
    new Promise(() => {})); // the process is gone before signing.install answers
  installOnDevice({ url: "https://x/self.ipa", name: NAME, host: true }, { native, hud: h.hud, alert: () => assert.fail("no alert") });
  await flush();
  assert.deepEqual(h.steps, [SELF_RESTART], "said once");
  assert.deepEqual(h.said, ["Copying to iPhone 50%", "Installing 10%", "Installing 90%"]);
  forgetRoute();
});
