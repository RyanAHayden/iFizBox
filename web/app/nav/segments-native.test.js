// F345d: the pinned scope bar under the native controls hook goes to the shell's UISegmentedControl (ui.segments):
// open with the shown items, selection and rect; updates; hidden while a popup, a slide or another page covers it;
// closed when its page leaves or the hook goes off; picks call onPick; an old shell keeps the CSS bar. Plus the
// Swift handler's shape. SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fakeDocument, tick } from "./fakedom.test-helper.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = fakeDocument();
globalThis.document = doc;
const { segments, syncSegments, segmentsSnapshot } = await import("./ui.js");

// A fake shell: records ui.segments calls; open's stream callback is kept so a test can tap.
function fakeShell({ refuse = false } = {}) {
  const calls = [];
  const streams = {};
  const native = {
    call(method, params, onEvent) {
      calls.push({ method, ...params });
      if (refuse) return Promise.reject(new Error("unknown method ui.segments"));
      if (params.op === "open") {
        streams[params.key] = onEvent;
        onEvent({ ready: true });
        return new Promise(() => {}); // settles on close (not needed here)
      }
      return Promise.resolve(null);
    },
  };
  return { native, calls, streams };
}

const RECT = { left: 8, top: 100, width: 300, height: 32, right: 308, bottom: 132 };
const win = { visualViewport: { offsetLeft: 0, offsetTop: 0 } };

// A Search-like page: .search-root holding the scope row (pinned) and a .search-results scroller.
function page(native, { pick = () => {} } = {}) {
  globalThis.ifizboxNative = native;
  const root = doc.createElement("div");
  root.classList.add("search-root");
  const seg = segments(["a", "b", "c"], { a: "All", b: "Apps", c: "Tweaks" }, "a", pick);
  seg.getBoundingClientRect = () => RECT;
  const results = doc.createElement("div");
  results.classList.add("search-results");
  root.append(seg, results);
  doc.body.append(root);
  let cover = null; // what the hit test finds instead of the bar
  doc.elementFromPoint = () => cover ?? seg.buttons[1];
  return { root, seg, results, setCover: (n) => { cover = n; } };
}

function reset() {
  doc.body.children.forEach((c) => { c.parentNode = null; });
  doc.body.children.length = 0;
  doc.documentElement.setAttribute("data-controls", "native");
  delete doc.getAnimations;
  syncSegments(doc, fakeShell().native, win); // closes the last test's bars, which left with the page
}

test("open: the shown items, selection and rect; the CSS bar goes see-through on ready", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { seg } = page(native);
  syncSegments(doc, native, win);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.op, "open");
  assert.deepEqual(c.items, ["All", "Apps", "Tweaks"]);
  assert.equal(c.selected, 0);
  assert.deepEqual(c.rect, { x: 8, y: 100, width: 300, height: 32 });
  assert.equal(c.hidden, false);
  assert.equal(seg.style.opacity, "0");
  syncSegments(doc, native, win);
  assert.equal(calls.length, 1, "nothing changed, nothing sent");
});

test("select() and show() update the native bar; a native pick maps to the shown segment and calls onPick", async () => {
  reset();
  const picked = [];
  const { native, calls, streams } = fakeShell();
  const { seg } = page(native, { pick: (v) => picked.push(v) });
  syncSegments(doc, native, win);
  seg.show(["a", "c"]);
  syncSegments(doc, native, win);
  const up = calls.at(-1);
  assert.equal(up.op, "update");
  assert.deepEqual(up.items, ["All", "Tweaks"]);
  streams[up.key]({ pick: 1 });
  assert.deepEqual(picked, ["c"], "index 1 of the shown items is Tweaks");
  assert.ok(seg.buttons[2]._cls.has("selected"));
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).selected, 1);
  streams[up.key]({ pick: 1 });
  assert.deepEqual(picked, ["c"], "the selected segment again does nothing");
  seg.select("a");
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).selected, 0);
  assert.deepEqual(picked, ["c"], "select() calls no onPick");
});

test("hidden while a popup is up, another page covers the bar, or a slide runs; the CSS bar shows meanwhile", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { seg, setCover } = page(native);
  syncSegments(doc, native, win);
  assert.equal(seg.style.opacity, "0");

  const alert = doc.createElement("div");
  alert.setAttribute("role", "alertdialog");
  doc.body.append(alert);
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).hidden, true);
  assert.equal(seg.style.opacity, "", "the CSS bar shows at once");
  alert.remove();
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).hidden, false);
  await tick();
  assert.equal(seg.style.opacity, "0", "see-through again once the shell answered");

  const pushed = doc.createElement("div");
  setCover(pushed);
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).hidden, true, "a pushed page over the bar");
  const sent = calls.length;
  const moved = seg.getBoundingClientRect;
  seg.getBoundingClientRect = () => ({ ...RECT, left: -50, right: 250 });
  syncSegments(doc, native, win);
  assert.equal(calls.length, sent, "hidden: a new place alone sends nothing");
  seg.getBoundingClientRect = moved;
  setCover(null);
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).hidden, false, "back from the push");

  doc.getAnimations = () => [{ playState: "running", finished: Promise.resolve(),
    effect: { getTiming: () => ({ iterations: Infinity }), getKeyframes: () => [{ transform: "rotate(1turn)" }] } }];
  assert.equal(segmentsSnapshot(seg, doc, win).hidden, false, "a spinner never hides it");
  doc.getAnimations = () => [{ playState: "running", finished: Promise.resolve(),
    effect: { getTiming: () => ({ iterations: 1 }), getKeyframes: () => [{ transform: "translate3d(100%,0,0)" }] } }];
  assert.equal(segmentsSnapshot(seg, doc, win).hidden, true, "a push in flight hides it");
  delete doc.getAnimations;
  seg.parentNode.style.transform = "translate3d(-10%,0,0)";
  assert.equal(segmentsSnapshot(seg, doc, win).hidden, true, "the edge swipe moving its page hides it");
  seg.parentNode.style.transform = "";
});

test("closed when its page leaves or the hook goes off; reopened when it comes back", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { root } = page(native);
  syncSegments(doc, native, win);
  root.remove();
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).op, "close");
  assert.equal(calls.at(-1).key, calls[0].key);

  const { seg } = page(native);
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).op, "open");
  doc.documentElement.setAttribute("data-controls", "css");
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).op, "close");
  assert.equal(seg.style.opacity, "");
  doc.documentElement.setAttribute("data-controls", "native");
  syncSegments(doc, native, win);
  assert.equal(calls.at(-1).op, "open");
});

test("only a pinned bar: none inside the scroller, none without the hook or on the site", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { results } = page(native);
  doc.body.children[0].children[0].remove(); // the pinned one goes
  const inList = segments(["a"], {}, "a", () => {});
  inList.getBoundingClientRect = () => RECT;
  results.append(inList);
  syncSegments(doc, native, win);
  assert.equal(calls.filter((c) => c.op === "open").length, 0);

  reset();
  doc.documentElement.setAttribute("data-controls", "css");
  page(native);
  syncSegments(doc, native, win);
  assert.equal(calls.filter((c) => c.op === "open").length, 0);

  reset();
  globalThis.ifizboxNative = undefined;
  const site = segments(["a"], {}, "a", () => {});
  assert.equal(site.dataset.nativeSegments, undefined, "the site: no native bar at all");
});

test("an old shell refuses ui.segments: the CSS bar stays, and it is not asked again", async () => {
  reset();
  const { native, calls } = fakeShell({ refuse: true });
  const { seg } = page(native);
  syncSegments(doc, native, win);
  await tick();
  assert.equal(seg.style.opacity, "");
  syncSegments(doc, native, win);
  assert.equal(calls.length, 1);
});

test("Swift: ui.segments is registered and handles open/update/close with a UISegmentedControl", () => {
  const swift = readFileSync(join(HERE, "../../../native/Sources/NativeSegments.swift"), "utf8");
  const bridge = readFileSync(join(HERE, "../../../native/Sources/Bridge.swift"), "utf8");
  assert.match(bridge, /NativeSegments\.register\(self\)/);
  assert.match(swift, /b\.on\("ui\.segments"\)/);
  for (const op of ["open", "update", "close"]) assert.match(swift, new RegExp(`case "${op}"`));
  assert.match(swift, /UISegmentedControl/);
  assert.match(swift, /\["pick":/);
  assert.match(swift, /\["ready": true\]/);
});
