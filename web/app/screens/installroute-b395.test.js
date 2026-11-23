// B395: Shortcuts opens a bounded number of times whatever it does: one check at a time, one alert when an install
// stops for the Install Switch, and what stayed off in words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument } from "../fakes.test-helper.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.document ??= fakeDocument();
const { addShortcut, autoCheck, AUTO_CHECK } = await import("./installroute.js");
const core = await import("../core/installroute.js");
const { deviceError } = await import("../core/signing.js");
const { watchLeftOff } = await import("../incoming.js");
const { installOnDevice } = await import("../signing/route.js");
const failed = () => Object.assign(new Error("switch_failed: Could not find the shortcut “Install Switch.”"), { code: "switch_failed" });

test("a second Add or Update while a check runs starts nothing; a passed one clears the Install Switch's failure", async () => {
  const calls = [];
  let end;
  const native = { call: (m) => { calls.push(m); return m === "vpn.openShortcuts" ? Promise.resolve({ opened: true }) : new Promise((r) => { end = r; }); } };
  core.rememberRouteFailure(core.routeFailureOf(failed()));
  const first = addShortcut(native, "switch", { whenBack: async () => true });
  while (!end) await new Promise((r) => setTimeout(r, 1));
  assert.deepEqual(await addShortcut(native, "switch", { whenBack: async () => true }), { opened: false, ok: false, error: null });
  assert.deepEqual(calls, ["vpn.openShortcuts", "vpn.checkShortcut"]);
  end({ ok: true });
  assert.equal((await first).ok, true);
  assert.equal(core.routeFailure(), null);
});

test("the shell runs one check at most twice", () => {
  const swift = readFileSync(new URL("../../../native/sign/SwitchOpens.swift", import.meta.url), "utf8");
  assert.match(swift, /static let checkLimit = 2\b/);
});

test("switch_failed: Update and the Signing Server, in one alert with Cancel", async () => {
  const f = core.serverFallback(failed(), { route: "idevice" }, null);
  assert.equal(f.code, "switch_failed");
  assert.equal(f.fix, "shortcuts");
  assert.deepEqual(core.switchFailedAlert(f).buttons, ["Cancel", "Update", "Use Server"]);
  assert.equal(core.switchFailedAlert(f).cancel, 0);
  assert.match(f.message, /Could not find the shortcut/);
  assert.equal(deviceError(failed(), "X").fix, "shortcuts");
  mem.set("ifizbox.installRoute", "iphone");
  const st = { paired: "rp", tunnels: [], vpn: { available: true, tested: true, cellular: true, wifi: false, shortcuts: { switch: true } } };
  const asked = [], calls = [];
  const native = { call: async (m) => { calls.push(m); if (m === "signing.install") throw failed(); return m === "idevice.status" ? st : {}; } };
  const hud = () => ({ set() {}, hide() {}, done() {}, fail() {}, onCancel() {}, page: { raw() {}, help() {}, step() {} } });
  await installOnDevice({ url: "https://x.test/a.ipa", name: "A" }, { native, hud, keep: () => {}, alert: async (a) => { asked.push(a); return { index: 0 }; } });
  assert.deepEqual(asked.map((a) => a.buttons), [["Cancel", "Update", "Use Server"]]);
  assert.equal(calls.filter((m) => m === "signing.install").length, 1, "Cancel: nothing again");
});

test("the automatic check asks the shell never to open Shortcuts, and says nothing when it would", async () => {
  const st = { paired: "rp", vpn: { available: true, tested: true, shortcuts: { switch: true } } };
  const params = [];
  const native = { call: async (m, p) => { if (m !== "idevice.verify") return st; params.push(p); throw Object.assign(new Error("switch_needed: it would open Shortcuts"), { code: "switch_needed" }); } };
  core.rememberRouteFailure({ title: "T", message: "M", short: "S", fix: "check", button: "Check Again" });
  AUTO_CHECK.last = 0;
  await autoCheck(native, async () => assert.fail("no alert"), () => {}, { get: () => "iphone", set() {} });
  assert.deepEqual(params, [{ quiet: true }]);
  assert.equal(core.routeFailure().title, "T", "the failure it had stays");
  core.clearRouteFailure();
});

test("what stayed off is said once per answer, until the shell has no such call", async () => {
  const answers = [{ vpn: true, cellular: false }, { vpn: true, cellular: true }, { vpn: false, cellular: true }];
  const said = [];
  await watchLeftOff({ native: { call: async () => { if (!answers.length) throw new Error("unknown method"); return answers.shift(); } }, alert: async (a) => { said.push(a.title); } });
  assert.deepEqual(said, ["Your VPN Is Off", "Data and VPN Are Off", "Cellular Data Is Off"]);
  assert.equal(core.leftOffAlert({ vpn: false, cellular: false }), null);
});
