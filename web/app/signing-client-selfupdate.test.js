// B83: iFizBox's own sideload update after iOS's prompt: the page follows signing.selfUpdate (native CloseForUpdate),
// offers Try Again when iOS never took the update, and the next launch says so when the version didn't land.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage as memory } from "./fakes.test-helper.js";
import { followSelfUpdate, SELF_UPDATE_LINES, SELF_UPDATE_FAILED } from "./signing-client.js";
import { unlockSelfUpdate, lockSelfUpdate, TRY_AGAIN_LABEL, CLOSING_LABEL } from "./nav/progress.js";
import { recordSelfUpdate, unfinishedSelfUpdate, PENDING_KEY, PENDING_TTL } from "./core/selfupdate.js";


// A HUD on a fake page: what lockSelfUpdate and unlockSelfUpdate use.
function fakeHUD() {
  const lines = [], finishes = [];
  const page = { closed: false, step: (t) => lines.push(["step", t]), error: (t) => lines.push(["error", t]),
    finish: (o) => finishes.push(o) };
  const h = { page, set: () => {}, finish: (o) => page.finish(o) };
  return { h, lines, finishes };
}

// signing.selfUpdate streaming `states`, then answering the last.
const native = (states) => ({
  calls: [],
  async call(method, params, onEvent) {
    this.calls.push(method);
    if (method !== "signing.selfUpdate") throw new Error("unexpected " + method);
    for (const s of states) onEvent?.({ state: s });
    return { state: states.at(-1) ?? null };
  },
});

test("followSelfUpdate: a line a step, and the page stays locked when iOS has it (the shell exits)", async () => {
  const { h, lines, finishes } = fakeHUD();
  lockSelfUpdate(h);
  assert.equal(finishes[0].label, CLOSING_LABEL);
  assert.equal(await followSelfUpdate(h, { native: native(["prompt", "waiting", "waiting", "asked", "finished"]) }), "finished");
  assert.deepEqual(lines, [["step", SELF_UPDATE_LINES.waiting], ["step", SELF_UPDATE_LINES.asked], ["step", SELF_UPDATE_LINES.finished]]);
  assert.equal(finishes.length, 1, "no Try Again");
});

for (const state of ["notStarted"]) {
  test(`followSelfUpdate: ${state} unlocks the page with Try Again`, async () => {
    const { h, lines, finishes } = fakeHUD();
    lockSelfUpdate(h);
    let retried = 0;
    assert.equal(await followSelfUpdate(h, { native: native(["prompt", "waiting", state]), retry: () => { retried++; } }), state);
    assert.deepEqual(lines.at(-1), ["error", SELF_UPDATE_FAILED[state]]);
    const last = finishes.at(-1);
    assert.equal(last.label, TRY_AGAIN_LABEL);
    assert.ok(!last.locked);
    assert.equal(await last.action(), false, "the page closes");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(retried, 1);
  });
}

test("followSelfUpdate: an older shell (no signing.selfUpdate) leaves the page locked", async () => {
  const { h, finishes } = fakeHUD();
  lockSelfUpdate(h);
  const old = { async call() { throw Object.assign(new Error("unknown method"), { code: "internal" }); } };
  assert.equal(await followSelfUpdate(h, { native: old }), null);
  assert.equal(finishes.length, 1);
  // and nothing running (null): nothing changes
  assert.equal(await followSelfUpdate(h, { native: native([]) }), null);
  assert.equal(finishes.length, 1);
});

test("unlockSelfUpdate: a closed page or none is left alone; no retry ends on Return", () => {
  assert.equal(unlockSelfUpdate(null), false);
  assert.equal(unlockSelfUpdate({ page: { closed: true, finish() {} } }), false);
  const { h, finishes } = fakeHUD();
  assert.equal(unlockSelfUpdate(h, { message: "x" }), true);
  assert.notEqual(finishes[0].label, TRY_AGAIN_LABEL);
});

test("pending self-update: recorded, reported while the app is older, dropped once it landed or went stale", () => {
  const s = memory();
  assert.equal(recordSelfUpdate(s, "nope", 0), false);
  assert.equal(recordSelfUpdate(s, "0.9.9", 1000), true);
  assert.equal(unfinishedSelfUpdate(s, "", 2000), null, "app.info unread: no answer, record kept");
  assert.ok(s.m.has(PENDING_KEY));
  assert.equal(unfinishedSelfUpdate(s, "0.9.8", 2000), "0.9.9");
  assert.equal(unfinishedSelfUpdate(s, "0.9.9", 3000), null, "landed");
  assert.ok(!s.m.has(PENDING_KEY));
  recordSelfUpdate(s, "0.9.9", 1000);
  assert.equal(unfinishedSelfUpdate(s, "0.9.8", 1000 + PENDING_TTL), null, "a day old");
  assert.ok(!s.m.has(PENDING_KEY));
  s.setItem(PENDING_KEY, "{bad");
  assert.equal(unfinishedSelfUpdate(s, "0.9.8", 0), null);
});

test("launch: an unfinished self-update shows its banner once, with Try Again, in place of 'X is out.'", async () => {
  const s = memory();
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  try {
    const { unfinishedOnce, bannerSeen } = await import("./essential-ui.js");
    recordSelfUpdate(s, "0.9.9");
    const banners = [];
    let upgraded = 0;
    const deps = { current: async () => "0.9.8", banner: (b) => banners.push(b), upgrade: () => { upgraded++; } };
    assert.equal(await unfinishedOnce("jailbreak", deps), false, "sideload only");
    assert.equal(await unfinishedOnce("sideload", deps), true);
    assert.match(banners[0].message, /0\.9\.9 didn't finish installing/);
    assert.equal(banners[0].action.label, "Try Again");
    banners[0].action.onClick();
    assert.equal(upgraded, 1);
    assert.equal(bannerSeen.version, "0.9.9", "the 'is out' banner doesn't repeat it");
    assert.ok(!s.m.has(PENDING_KEY), "said once");
    recordSelfUpdate(s, "0.9.9");
    assert.equal(await unfinishedOnce("sideload", deps), false, "once a launch");
  } finally {
    if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage;
  }
});
