// B450: a tap on a scope bar segment (nav/ui.js segments()) leaves the focus where it is, so the search field above
// keeps its keyboard; the click still picks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "./fakedom.test-helper.js";

globalThis.document = fakeDocument();
const { segments } = await import("./ui.js");

// A press as a browser sends it: the focus moves to `b` unless its mousedown was prevented; then the click lands.
function tap(b, doc) {
  let prevented = new Set();
  for (const type of ["pointerdown", "mousedown"]) b.fire(type, { preventDefault: () => prevented.add(type) });
  if (!prevented.has("mousedown")) doc.focused = b;
  b.click();
  return prevented;
}

test("a tap on a segment keeps the search field's focus and still picks", () => {
  const picked = [];
  const seg = segments(["all", "tweaks", "themes"], {}, "all", (v) => picked.push(v));
  const field = {};
  const doc = { focused: field };
  const prevented = tap(seg.buttons[1], doc);
  assert.deepEqual([...prevented], ["pointerdown", "mousedown"]);
  assert.equal(doc.focused, field);
  assert.deepEqual(picked, ["tweaks"]);
  assert.equal(seg.buttons[1].getAttribute("aria-selected"), "true");
  tap(seg.buttons[1], doc);
  assert.equal(doc.focused, field, "the selected segment again keeps it too");
  assert.deepEqual(picked, ["tweaks"]);
});

test("a tap on a segment gives nothing the focus when nothing had it", () => {
  const seg = segments(["all", "tweaks"], {}, "all", () => {});
  const doc = { focused: null };
  tap(seg.buttons[1], doc);
  assert.equal(doc.focused, null);
});

test("keyboard use and roles stay: segments are tabs in a tablist, with nothing listening for keys", () => {
  const seg = segments(["all", "tweaks"], {}, "all", () => {});
  assert.equal(seg.getAttribute("role"), "tablist");
  for (const b of seg.buttons) {
    assert.equal(b.getAttribute("role"), "tab");
    assert.equal(b.listeners.keydown, undefined);
    assert.equal(b.getAttribute("tabindex"), null);
  }
});
