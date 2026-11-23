// B370: tapping Select… (Installed's and My IPAs' Manage) fast, again and again, keeps showing the same menu. The
// iOS 26 menu grows over the button, so the fast taps land on its first item: those presses do nothing until the
// menu has grown and the run of taps has stopped. And a tap on the button while its sheet is open opens no second one.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "./fakedom.test-helper.js";
import { showActionSheet, MENU_IN, MENU_REPEAT } from "./actionsheet.js";
import { selectPreset } from "./selection.js";

let saved, now, savedNow;
beforeEach(() => {
  saved = globalThis.document;
  globalThis.document = fakeDocument();
  document.documentElement.setAttribute("data-style", "ios26");
  now = 1000;
  savedNow = performance.now;
  performance.now = () => now;
});
afterEach(() => { globalThis.document = saved; performance.now = savedNow; });

const press = (el) => {
  for (const f of document.listeners.pointerdown ?? []) f({ target: el });
  el.click();
};
const items = () => document.body.querySelectorAll(".action-button");
const from = { x: 16, y: 6, width: 60, height: 32 };

test("fast taps on the menu while it grows, and in a run of fast taps after, pick nothing", async () => {
  let answer = null;
  showActionSheet({ buttons: ["All Apps", "Signed (2)"], from }).then((i) => { answer = i; });
  for (let t = 120; t <= MENU_IN + 4 * 120; t += 120) {
    now = 1000 + t;
    press(items()[0]);
    press(document.body.querySelector(".action-dim"));
  }
  await Promise.resolve();
  assert.equal(answer, null, "still open");
  assert.equal(document.body.querySelectorAll(".action-menu").length, 1);
  assert.deepEqual(items().map((b) => b.textContent), ["All Apps", "Signed (2)"]);
  now += MENU_REPEAT; // the taps stopped: the next press is a pick
  press(items()[1]);
  await Promise.resolve();
  assert.equal(answer, 1);
});

test("a deliberate tap once the menu has grown picks; a click with no touch (keyboard) always does", async () => {
  const a = showActionSheet({ buttons: ["All Apps"], from });
  now += Math.max(MENU_IN, MENU_REPEAT);
  press(items()[0]);
  assert.equal(await a, 0);
  globalThis.document = fakeDocument();
  document.documentElement.setAttribute("data-style", "ios26");
  const b = showActionSheet({ buttons: ["All Apps"], from });
  items()[0].click();
  assert.equal(await b, 0);
});

test("selectPreset: a tap while its sheet is open opens no second sheet and changes nothing", async () => {
  let opened = 0, applied = [], cleared = 0, answer;
  const sheet = () => { opened++; return new Promise((r) => { answer = r; }); };
  const parts = { selecting: true, options: () => [{ label: "All", preset: "all" }], apply: (p) => applied.push(p),
    clear: () => cleared++, sheet };
  const first = selectPreset(parts);
  assert.equal(await selectPreset(parts), null);
  assert.equal(await selectPreset({ ...parts, selecting: false }), null, "Deselect waits too");
  assert.equal(opened, 1);
  assert.equal(cleared, 0);
  answer(0);
  assert.equal(await first, "all");
  assert.deepEqual(applied, ["all"]);
  const again = selectPreset(parts); // closed: the next tap opens it again
  assert.equal(opened, 2);
  answer(-1);
  assert.equal(await again, null);
});
