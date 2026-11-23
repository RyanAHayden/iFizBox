// B351: in the iOS 26 era a sheet opened from a button is an anchored menu that grows out of that button
// (actionsheet.js menuSheet); with no source button, and in every other era, the bottom sheet stays.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, tick } from "./fakedom.test-helper.js";
import { showActionSheet, sourceRect, placeMenu, watchTaps, TAP_FRESH_MS } from "./actionsheet.js";

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const era = (style) => document.documentElement.setAttribute("data-style", style);
const placed = (el, r) => Object.assign(el, { getBoundingClientRect: () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height }) });
const button = (r = { left: 300, top: 50, width: 80, height: 38 }) => {
  const b = placed(document.createElement("button"), r);
  document.body.append(b);
  return b;
};

test("iOS 26: a sheet from a button is the anchored menu: no Cancel, the button's rect is where it grows from", async () => {
  era("ios26");
  const select = button();
  const answer = showActionSheet({ title: "T", buttons: ["All Apps", "Delete"], destructive: 1, from: select });
  const menu = document.body.querySelector(".action-menu");
  assert.ok(menu, "menu drawn");
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(document.body.querySelectorAll(".action-button").some((b) => b.textContent === "Cancel"), false);
  assert.ok(document.body.querySelectorAll(".action-button")[1].classList.contains("destructive"));
  assert.equal(menu.style.transformOrigin, "0 0");
  assert.ok(menu.style.left && menu.style.top, "placed by script");
  document.body.querySelectorAll(".action-button")[0].click();
  assert.equal(await answer, 0);
  await tick();
  assert.equal(document.body.querySelector(".action-scrim"), null);
});

test("iOS 26: a tap outside the menu answers -1", async () => {
  era("ios26");
  const answer = showActionSheet({ buttons: ["One"], from: { x: 10, y: 10, width: 40, height: 40 } });
  document.body.querySelector(".action-dim").click();
  assert.equal(await answer, -1);
});

test("iOS 26 with no source button, and the other eras, keep the bottom sheet", async () => {
  for (const style of ["ios26", "ios6", "ios7", "ios13"]) {
    globalThis.document = fakeDocument();
    era(style);
    const from = style === "ios26" ? null : button();
    const answer = showActionSheet({ buttons: ["One"], from });
    assert.equal(document.body.querySelector(".action-menu"), null, style);
    assert.ok(document.body.querySelector(".action-sheet"), style);
    document.body.querySelectorAll(".action-button").find((b) => b.textContent === "Cancel").click();
    assert.equal(await answer, -1);
  }
});

test("the source button: `from`, else the button the last recent tap landed on; a tap in a sheet keeps it", () => {
  assert.deepEqual(sourceRect({ x: 1, y: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 });
  const listeners = {};
  document.addEventListener = (t, f) => { listeners[t] = f; };
  watchTaps(document);
  const modify = button({ left: 290, top: 44, width: 76, height: 38 });
  const label = document.createElement("span");
  modify.append(label);
  listeners.click({ target: label });
  assert.deepEqual(sourceRect(), { x: 290, y: 44, width: 76, height: 38 });
  const scrim = document.createElement("div");
  scrim.className = "action-scrim";
  const row = document.createElement("button");
  scrim.append(row);
  document.body.append(scrim);
  listeners.pointerdown({ target: row });
  assert.deepEqual(sourceRect(), { x: 290, y: 44, width: 76, height: 38 }, "Modify > Downgrade grows from Modify again");
  assert.equal(sourceRect(null, Date.now() + TAP_FRESH_MS + 1), null, "too long after the tap");
  const li = placed(document.createElement("li"), { left: 0, top: 200, width: 390, height: 44 });
  document.body.append(li);
  listeners.pointerdown({ target: li });
  assert.equal(sourceRect(), null, "a row is no source button");
});

test("placeMenu: covers the button, its corner pinned, and stays in the room", () => {
  const room = { left: 8, top: 60, right: 382, bottom: 800 };
  // a bar button on the right: grows down, right edges together
  let at = placeMenu({ x: 300, y: 64, width: 80, height: 38 }, { width: 250, height: 200 }, room, 390);
  assert.deepEqual(at, { left: 130, top: 64, maxHeight: null, down: true, right: true });
  // a toolbar button at the bottom left: grows up, left edges together
  at = placeMenu({ x: 10, y: 740, width: 90, height: 44 }, { width: 250, height: 200 }, room, 390);
  assert.deepEqual(at, { left: 10, top: 584, maxHeight: null, down: false, right: false });
  // too wide for the left edge: clamped in; too tall: capped to the room
  at = placeMenu({ x: 2, y: 64, width: 40, height: 38 }, { width: 250, height: 900 }, room, 390);
  assert.equal(at.left, 8);
  assert.equal(at.maxHeight, 736);
});

test("the menu animates transform and opacity only, and the Select… sheet comes out of Select…", () => {
  const js = readFileSync(new URL("./actionsheet.js", import.meta.url), "utf8");
  const fn = js.slice(js.indexOf("function menuSheet"), js.indexOf("function bottomSheet"));
  for (const m of fn.matchAll(/\.animate\??\.?\(\[([^\]]*)\]/g)) {
    for (const k of m[1].matchAll(/(\w+):/g)) assert.ok(["transform", "opacity"].includes(k[1]), k[1]);
  }
  const inst = readFileSync(new URL("../screens/installed.js", import.meta.url), "utf8");
  assert.match(inst, /from: view\.wish/);
});
