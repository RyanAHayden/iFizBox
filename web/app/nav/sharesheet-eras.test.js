// F387: the Share sheet per era. iOS 6 keeps its activity sheet (the grid); iOS 7, 13 and 26 set style.css's
// --share-layout hook to "action", and nav/sharesheet.js hands the items to the action sheet, each item's icon in
// front of its label, the item's action run inside the tap.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeDocument, tick } from "./fakedom.test-helper.js";
import { showShareSheet, shareLayout } from "./sharesheet.js";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

let saved, savedStyle;
const layout = (v) => { globalThis.getComputedStyle = () => ({ getPropertyValue: (k) => (k === "--share-layout" ? v : "") }); };
beforeEach(() => { saved = globalThis.document; savedStyle = globalThis.getComputedStyle; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; globalThis.getComputedStyle = savedStyle; });

const items = (log) => [
  { label: "Copy Link", glyph: "copy", onSelect: () => log.push("copy") },
  { label: "AltStore", letter: "A", color: "#2a8f8c", onSelect: () => log.push("altstore") },
];

test("style.css's hook says grid (iOS 6); iOS 7, 13 and 26 set it to action", () => {
  assert.match(noComments(read("style.css")), /--share-layout:\s*grid;/);
  for (const era of ["ios7", "ios13", "ios26"]) {
    assert.match(noComments(read(`${era}.css`)), /--share-layout:\s*action;/, `${era}.css keeps iOS 6's grid`);
  }
  assert.doesNotMatch(noComments(read("ios6.css")), /--share-layout/, "iOS 6 sets no layout of its own");
});

test("shareLayout reads the hook: action only when it says so", () => {
  layout(" action");
  assert.equal(shareLayout(), "action");
  layout("grid");
  assert.equal(shareLayout(), "grid");
  layout("");
  assert.equal(shareLayout(), "grid");
});

test("grid: iOS 6's activity sheet, as before", async () => {
  layout("grid");
  const answer = showShareSheet({ items: items([]) });
  assert.ok(document.body.querySelector(".share-sheet"));
  assert.equal(document.body.querySelector(".action-sheet"), null);
  document.body.querySelector(".share-cancel").click();
  assert.equal(await answer, -1);
});

test("action: the action sheet, an icon in front of each label, Cancel without one", async () => {
  layout("action");
  const log = [];
  const answer = showShareSheet({ items: items(log) });
  assert.equal(document.body.querySelector(".share-sheet"), null);
  const buttons = document.body.querySelectorAll(".action-button");
  assert.equal(buttons.length, 3);
  const [copy, app, cancel] = buttons;
  assert.ok(copy._cls.has("has-icon") && app._cls.has("has-icon"));
  assert.ok(!cancel._cls.has("has-icon"));
  assert.ok(copy.querySelector(".action-icon.share-icon.system .share-glyph.glyph-copy"));
  assert.ok(app.querySelector(".action-icon.share-icon.app .share-letter"));
  assert.equal(copy.querySelector(".action-label").textContent, "Copy Link");
  assert.equal(cancel.textContent, "Cancel");
  app.click();
  assert.deepEqual(log, ["altstore"], "the action runs inside the tap, before the answer is awaited");
  assert.equal(await answer, 1);
  await tick();
  assert.equal(document.body.querySelector(".action-scrim"), null);
});

test("action: Cancel runs no item's action and answers -1", async () => {
  layout("action");
  const log = [];
  const answer = showShareSheet({ items: items(log) });
  document.body.querySelectorAll(".action-button").at(-1).click();
  assert.equal(await answer, -1);
  assert.deepEqual(log, []);
});
