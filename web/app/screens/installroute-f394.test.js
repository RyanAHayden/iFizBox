// F394: an Install Switch from before the one-trip run keeps working, and its page offers Update.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../fakes.test-helper.js";

globalThis.document ??= fakeDocument();
const { shortcutGroups, SHARE_SHORTCUT } = await import("./installroute.js");
const { switchOld } = await import("../core/installroute.js");

test("Update shows only for an added Install Switch that can't do one trip, on an app that can", () => {
  const vpn = (trips, sw, trip) => ({ trips, shortcuts: { switch: sw, trip, idle: trip } });
  assert.equal(switchOld(vpn(true, true, false)), true);
  for (const v of [vpn(true, true, true), vpn(true, false, false), vpn(false, true, false), null, { shortcuts: { switch: true } }]) assert.equal(switchOld(v), false);
  const added = [];
  const old = shortcutGroups(vpn(true, true, false), { add: (k) => added.push(k) });
  assert.equal(old[0].rows[0].detail, "Update");
  old[0].rows[0].onClick();
  assert.deepEqual(added, ["switch"]);
  assert.match(old[0].footer, /delete Install Switch in Shortcuts, then tap Update/);
  assert.equal(old[1].rows[0].label, SHARE_SHORTCUT);
  assert.match(old[2].footer, /once each way/, "its test still runs the old way");
  const now = shortcutGroups(vpn(true, true, true));
  assert.equal(now[0].rows[0].detail, "Added");
  assert.match(now[1].footer, /^Runs it once:/);
});

// user 2026-11-23: the Install Switch is asked for only when it is needed and not added
const ST = (vpn = {}) => ({ paired: "rp", tunnels: [], vpn: { available: true, tested: true, cellular: false, otherVPN: false, trips: true, shortcuts: {}, ...vpn } });
const core = await import("../core/installroute.js");
const { cellularTile } = await import("./home.js");
const { localGroups } = await import("./installroute.js");
const { chooseRoute, forgetRoute } = await import("../signing-client.js");
const refused = Object.assign(new Error("route_refused: no"), { code: "route_refused" });
const failed = Object.assign(new Error("connect_failed: no"), { code: "connect_failed" });
const says = (o) => /Install Switch/.test(JSON.stringify(o ?? ""));

test("Wi-Fi, no other VPN, not added: nothing asks for it, This iPhone is set up, the row stays", () => {
  const st = ST();
  assert.equal(core.switchWanted(st), false);
  assert.deepEqual(core.decideRoute("iphone", st), { route: "idevice" });
  assert.equal(core.installStatus("iphone", st).state, "ready");
  assert.equal(cellularTile("sideload", "iphone", st.vpn), null);
  assert.equal(core.iphoneSetUp(st), true);
  assert.equal(says(core.setupFooter(st)), false);
  for (const e of [refused, failed]) assert.equal(says(core.verifyFailure(e, st)), false);
  assert.equal(core.verifyFailure(refused, st).fix, "check");
  assert.deepEqual(localGroups(st)[0].rows.map((r) => r.label).includes("Install Switch"), true);
});

test("cellular, not added: the existing prompts; added: none", () => {
  const st = ST({ cellular: true });
  assert.equal(core.decideRoute("iphone", st).alert, "cellular");
  assert.equal(core.installStatus("iphone", st).state, "cellular");
  assert.ok(cellularTile("sideload", "iphone", st.vpn));
  for (const e of [refused, failed]) assert.equal(says(core.verifyFailure(e, st)), true);
  const on = ST({ cellular: true, otherVPN: true, shortcuts: { switch: true } });
  assert.equal(core.switchWanted(on), false);
  assert.deepEqual(core.decideRoute("iphone", on), { route: "idevice" });
  for (const e of [refused, failed]) assert.equal(says(core.verifyFailure(e, on)), false);
});

test("another VPN on, not added: the install says it stays off and goes on; Set Up opens its page", async () => {
  const st = ST({ otherVPN: true });
  assert.equal(core.decideRoute("iphone", st).alert, "vpnStaysOff");
  assert.equal(core.decideRoute("iphone", ST({ otherVPN: true, shortcuts: { off: true, on: true } })).alert, "vpnStaysOff", "the old two don't bring it back");
  assert.equal(core.installStatus("iphone", st).state, "ready", "said at the install only");
  assert.equal(cellularTile("sideload", "iphone", st.vpn), null);
  const native = { call: () => Promise.resolve(st) };
  const storage = { getItem: () => "iphone" };
  let shown = null;
  forgetRoute();
  assert.deepEqual(await chooseRoute({ native, storage, alert: async (a) => { shown = a; return { index: 0 }; } }), { route: "idevice" });
  assert.match(shown.message, /stays off after/);
  forgetRoute();
  globalThis.location ??= { hash: "" };
  assert.equal(await chooseRoute({ native, storage, alert: async () => ({ index: 1 }) }), null);
  forgetRoute();
});

// B397: the test's row says what it is doing, and what the trip's redraw leaves behind ends with the test.
const { drawInstallation, forgetStatus } = await import("./installroute.js");
const every = (e) => [e, ...e.children.flatMap(every)];
const cell = (box, label) => every(box).filter((n) => n._cls.has("cell-inner")).find((n) => every(n).some((x) => x._cls.has("cell-label") && x.textContent === label));
const detail = (box, label) => every(cell(box, label)).find((n) => n._cls.has("cell-detail"))?.textContent;
const stepOf = (box, label) => every(cell(box, label)).find((n) => n._cls.has("cell-subtitle"))?.textContent;
const spins = (box, label) => every(cell(box, label)).some((n) => n._cls.has("loading-spinner"));
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const pending = () => { let answer; const p = new Promise((r) => { answer = r; }); return { p, answer }; };
const store = { get: () => "iphone", set() {} };

test("B397: Test Install Switch's row says each step, also on the page the trip redraws", async () => {
  forgetStatus();
  const run = pending(), alerts = [];
  let emit;
  const native = { call: (m, p, ev) => { if (m === "vpn.testSwitch") { emit = ev; return run.p; } return Promise.resolve(ST({ shortcuts: { switch: true, trip: true, idle: true } }).vpn); } };
  const o = { store, native, alert: async (a) => { alerts.push(a.title); return { index: 0 }; } };
  const box = document.createElement("div"), again = document.createElement("div");
  await drawInstallation(box, "shortcuts", o);
  const done = Promise.all(cell(box, "Test Install Switch").listeners.click.map((f) => f({})));
  await flush();
  assert.equal(stepOf(box, "Test Install Switch"), "Opening Shortcuts…");
  emit({ step: "connecting" });
  assert.equal(stepOf(box, "Test Install Switch"), "Connecting…");
  await drawInstallation(again, "shortcuts", o); // back from Shortcuts
  emit({ step: "back" });
  assert.equal(stepOf(again, "Test Install Switch"), "Putting Things Back…");
  assert.ok(spins(again, "Test Install Switch"));
  assert.deepEqual(alerts, [], "nothing is said before the answer");
  run.answer({ ok: true, start: { ok: true }, end: { ok: true }, vpnOn: true, vpnBack: true });
  await done;
  emit({ step: "connecting" }); // a late one
  assert.ok(!spins(again, "Test Install Switch"));
  assert.deepEqual(alerts, ["Install Switch Works"]);
});

test("B397: Test Connection's row stops on the page drawn again while it ran", async () => {
  forgetStatus();
  const run = pending();
  const native = { call: (m) => (m === "vpn.test" ? run.p : Promise.resolve(ST())) };
  const o = { store, native, alert: async () => ({ index: 0 }) };
  const box = document.createElement("div");
  await drawInstallation(box, "iphone", o);
  const done = Promise.all(cell(box, "Test Connection").listeners.click.map((f) => f({})));
  await flush();
  await drawInstallation(box, "iphone", o); // back from Shortcuts
  assert.ok(spins(box, "Test Connection"));
  run.answer({ ok: true, ms: 40 });
  await done; await flush();
  assert.ok(!spins(box, "Test Connection"));
  assert.equal(detail(box, "Test Connection"), "Connected");
});
