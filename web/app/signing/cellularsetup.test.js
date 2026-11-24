// F417b: adding, checking and running Cellular Installs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backInApp, checkFailed, popupShortcut, readShortcut, repairShortcut, setUpShortcut } from "./cellularsetup.js";
import { SHORTCUT_RAN_KEY } from "../core/cellular.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
// a shell whose answers come in turn, the last one staying; an Error rejects
function shell(answers) {
  const calls = [];
  return { calls, call: async (m) => {
    calls.push(m.replace("cellular.", ""));
    const a = [].concat(answers[m.replace("cellular.", "")] ?? {});
    const r = a.length > 1 ? (answers[m.replace("cellular.", "")] = a.slice(1), a[0]) : a[0];
    if (r instanceof Error) throw r;
    return r;
  } };
}
function alerts(...taps) {
  const said = [];
  return { said, alert: async (a) => { said.push([a.title, a.buttons.at(-1)]); return { index: taps.shift() ?? 0 }; } };
}
const whenBack = async () => true;
const ok = { ok: true }, bad = (error) => ({ ok: false, error });

test("read: available and bundled; added by a check, or a run that passed; an older shell has none", async () => {
  mem.clear();
  assert.deepEqual(await readShortcut(shell({ status: { available: true, bundled: true, added: false } })), { available: true, added: false });
  mem.set(SHORTCUT_RAN_KEY, "1");
  assert.deepEqual(await readShortcut(shell({ status: { available: true, bundled: true, added: false } })), { available: true, added: true });
  assert.equal((await readShortcut(shell({ status: { available: true, bundled: false } }))).available, false);
  assert.equal(await readShortcut(shell({ status: new Error("unknown method") })), null);
});

test("set up: shared, then checked once back; a closed sheet checks nothing", async () => {
  const n = shell({ add: { opened: true }, check: ok });
  assert.equal(await setUpShortcut(n, { alert: alerts().alert, whenBack }), true);
  assert.deepEqual(n.calls, ["add", "check"]);
  const closed = shell({ add: { opened: false } });
  assert.equal(await setUpShortcut(closed, { alert: alerts().alert, whenBack }), false);
  assert.deepEqual(closed.calls, ["add"]);
  const away = shell({ add: { opened: true } });
  assert.equal(await setUpShortcut(away, { alert: alerts().alert, whenBack: async () => false }), false);
  assert.deepEqual(away.calls, ["add"]);
  const no = alerts();
  assert.equal(await setUpShortcut(shell({ add: new Error("missing") }), { alert: no.alert, whenBack }), false);
  assert.equal(no.said[0][0], "Couldn't Add Shortcut");
});

test("a check that fails says so with its fix", async () => {
  mem.set(SHORTCUT_RAN_KEY, "1");
  const n = shell({ add: { opened: true }, check: [bad("not_run"), ok] });
  const { said, alert } = alerts(1);
  assert.equal(await checkFailed(n), "not_run");
  assert.equal(mem.get(SHORTCUT_RAN_KEY), "0");
  assert.equal(await repairShortcut(n, "not_run", { alert, whenBack }), true);
  assert.deepEqual([said, n.calls], [[["Shortcut Didn't Run", "Add Shortcut Again"]], ["check", "add", "check"]]);
  const busy = shell({ check: ok }), b = alerts(1);
  assert.equal(await repairShortcut(busy, "busy", { alert: b.alert, whenBack }), true);
  assert.deepEqual([b.said, busy.calls], [[["Shortcut Didn't Run", "Try Again"]], ["check"]]);
  assert.equal(await repairShortcut(shell({}), "not_run", { alert: alerts(0).alert }), false);
});

test("the popup's: a run that passed counts as added; a put-back is said", async () => {
  mem.clear();
  const status = { available: true, bundled: true, added: false };
  assert.equal(await popupShortcut(shell({ status: { available: false } })), null);
  const sc = await popupShortcut(shell({ status, run: [{ ok: true, putBack: null }, { ok: false, error: "no_end", putBack: "on" }, { ok: false, error: "not_waiting" }] }), { alert: async (a) => { mem.set("said", a.title); return { index: 0 }; } });
  assert.equal(await sc.run(), null);
  assert.equal(mem.get(SHORTCUT_RAN_KEY), "1");
  assert.equal(await sc.run(), "no_end");
  assert.deepEqual([mem.get("said"), mem.get(SHORTCUT_RAN_KEY)], ["Cellular Data Is Back On", "0"]);
  assert.equal(await sc.run(), "not_waiting");
});

test("back in the app: hidden, then visible", async () => {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const show = (hidden) => { doc.hidden = hidden; doc.dispatchEvent(new Event("visibilitychange")); };
  const back = backInApp(doc);
  show(true); show(false);
  assert.equal(await back, true);
  assert.equal(await backInApp(Object.assign(new EventTarget(), { hidden: true }), { limit: 1 }), false);
  assert.equal(await backInApp(doc, { leaveMs: 1 }), true);
});
