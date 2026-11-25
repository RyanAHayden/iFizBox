// F428: Restore My VPN's question on coming back, and what each answer does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument, fakeNative, memStorage, tick } from "../fakes.test-helper.js";

globalThis.document ??= fakeDocument();
globalThis.localStorage = memStorage();
const { askRestore, pageClear, runFailed, QUESTION } = await import("./restoreask.js");

// The shell: say(due) tells the stream; reply answers restore.answer. The alert: tap(index) taps its button.
function rig({ reply = { ok: true }, clear = () => true } = {}) {
  const r = { alerts: [], taps: [], clear };
  let tell;
  const native = fakeNative({ "restore.due": (p, on) => { tell = on; return new Promise(() => {}); },
    "restore.answer": (p) => { r.taps.push(p.answer); if (reply instanceof Error) throw reply; return typeof reply === "function" ? reply(r, p) : reply; } });
  r.alert = (a) => new Promise((done) => {
    const up = { ...a, open: true };
    up.tap = (index) => { up.open = false; done({ index }); };
    a.signal?.addEventListener("abort", () => up.tap(-1));
    r.alerts.push(up);
  });
  askRestore(native, { alert: r.alert, clear: () => r.clear(), wait: tick });
  r.tell = (due) => tell({ due });
  r.say = async (due) => { r.tell(due); await settle(); };
  r.tap = async (i) => { r.alerts.at(-1).tap(i); await settle(); };
  return r;
}
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };

test("the question, its words; nothing is answered without a tap", async () => {
  const r = rig();
  await r.say(false);
  assert.equal(r.alerts.length, 0);
  await r.say(true);
  const { title, message, buttons, cancel } = r.alerts[0];
  assert.deepEqual([title, message, buttons, buttons[cancel]],
    ["Turn Your VPN Back On?", "Shortcuts opens for a moment.", ["Turn VPN On", "Not Now", "Don't Ask Again"], "Not Now"]);
  assert.deepEqual(r.taps, []);
});

for (const [i, answer] of ["on", "notNow", "never"].entries()) {
  test(`${QUESTION.buttons[i]} answers ${answer}, asked once`, async () => {
    const r = rig();
    await r.say(true);
    await r.say(true);
    await r.tap(i);
    assert.deepEqual([r.taps, r.alerts.length], [[answer], 1]);
    await r.say(false);
    await r.say(true);
    assert.equal(r.alerts.length, 2, "the next queue's");
  });
}

test("a failed run says so; later, on_already and not_due are none, nor is a failed Not Now", async () => {
  for (const error of ["not_run", "not_stored", "not_back", "no_return", "not_opened"]) {
    const r = rig({ reply: (rr) => { rr.tell(false); return { ok: false, error }; } });
    await r.say(true);
    await r.tap(0);
    assert.deepEqual(r.alerts.slice(1).map((a) => [a.title, a.message, a.buttons]), [["VPN Not Turned On", runFailed(error).message, ["OK"]]], error);
  }
  for (const error of ["later", "on_already", "not_due"]) {
    const r = rig({ reply: { ok: false, error } });
    await r.say(true);
    await r.tap(0);
    assert.equal(r.alerts.length, 1, error);
  }
  const gone = rig({ reply: new Error("gone") });
  await gone.say(true);
  await gone.tap(0);
  assert.equal(gone.alerts[1].title, "VPN Not Turned On");
  const no = rig({ reply: new Error("gone") });
  await no.say(true);
  await no.tap(1);
  assert.equal(no.alerts.length, 1);
});

test("left as Turn VPN On was tapped: nothing ran and it is still due, so it asks again", async () => {
  const r = rig({ reply: { ok: false, error: "not_opened" } });
  await r.say(true);
  await r.tap(0);
  assert.deepEqual(r.alerts.map((a) => a.title), [QUESTION.title, QUESTION.title]);
});

test("waits while something is in the way, the failure too; not asked when no longer due by then", async () => {
  let free = false;
  const r = rig({ clear: () => free, reply: (rr) => { rr.tell(false); free = false; return { ok: false, error: "not_run" }; } });
  await r.say(true);
  assert.equal(r.alerts.length, 0);
  free = true;
  await settle();
  assert.equal(r.alerts.length, 1);
  await r.tap(0);
  assert.equal(r.alerts.length, 1);
  free = true;
  await settle();
  assert.equal(r.alerts.length, 2);

  const gone = rig({ clear: () => false });
  await gone.say(true);
  await gone.say(false);
  gone.clear = () => true;
  await settle();
  assert.equal(gone.alerts.length, 0);
});

test("withdrawn: the alert goes unanswered; due again, it asks", async () => {
  const r = rig();
  await r.say(true);
  await r.say(false);
  assert.deepEqual([r.alerts[0].open, r.taps], [false, []]);
  await r.say(true);
  assert.equal(r.alerts.length, 2);
  r.tell(false); r.tell(true); // at once
  await settle();
  assert.deepEqual([r.alerts.length, r.alerts[2].open, r.taps], [3, true, []]);
});

test("clear: in front, no popup or menu up, not typing", () => {
  const doc = ({ state = "visible", popup = false, menu = false, field = false } = {}) => ({ visibilityState: state,
    activeElement: { matches: () => field }, querySelectorAll: () => (popup ? [{}] : []), querySelector: () => (menu ? {} : null) });
  assert.equal(pageClear(doc()), true);
  for (const no of [{ state: "hidden" }, { popup: true }, { menu: true }, { field: true }]) assert.equal(pageClear(doc(no)), false, JSON.stringify(no));
});

test("Don't Ask Again that isn't kept says so", async () => {
  const r = rig({ reply: new Error("gone") });
  await r.say(true);
  await r.tap(2);
  assert.equal(r.alerts[1].title, "Couldn't Save That");
});

test("the next queue's, due while a failure is up, is asked after it", async () => {
  const r = rig({ reply: (rr) => { rr.tell(false); return { ok: false, error: "not_run" }; } });
  await r.say(true);
  await r.tap(0);
  await r.say(true);
  assert.equal(r.alerts.length, 2);
  await r.tap(0);
  assert.deepEqual(r.alerts.map((a) => a.title), [QUESTION.title, "VPN Not Turned On", QUESTION.title]);
});
