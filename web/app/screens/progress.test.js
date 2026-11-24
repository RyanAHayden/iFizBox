// B93: the progress page's log lines (screens/progress.js): one DOM append a frame, repeating byte/percent lines
// updated in place, and nothing added while a selection is in the log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogBuffer, lineShape, selectionIn, PER_FRAME } from "./progress.js";

function rig({ held = () => false, max } = {}) {
  const frames = [];
  const container = { appends: 0, nodes: [], append(frag) { this.appends++; for (const n of frag.kids) { n.parentNode = container; this.nodes.push(n); } } };
  const log = createLogBuffer({
    container,
    make: (e) => ({ textContent: e.text, kind: e.kind, parentNode: null }),
    fragment: () => ({ kids: [], append(n) { this.kids.push(n); } }),
    raf: (f) => { frames.push(f); return frames.length; },
    caf: (id) => { frames[id - 1] = null; },
    held, max,
  });
  const tick = () => { const fs = frames.splice(0); for (const f of fs) f?.(); };
  return { log, container, frames, tick };
}

test("200 lines in one frame make one rAF and one DOM append", () => {
  const { log, container, frames, tick } = rig();
  for (let i = 0; i < 200; i++) log.push({ kind: i % 2 ? "step" : "raw", text: `Setting up package-${"abcdefghij"[i % 10]}${i % 7 ? "x" : "y"}${"z".repeat(i % 13)}` });
  assert.equal(frames.length, 1, "one frame asked for");
  assert.equal(container.appends, 0, "nothing before the frame");
  tick();
  assert.equal(container.appends, 1);
  assert.equal(container.nodes.length, 200);
});

test("lines are held while a selection is in the log and go out in one append once it ends", () => {
  let selecting = true;
  const { log, container, frames, tick } = rig({ held: () => selecting });
  log.push({ kind: "step", text: "Downloading" });
  log.push({ kind: "raw", text: "Get:1 repo foo" });
  assert.equal(frames.length, 0, "no frame while selecting");
  log.flush();
  assert.equal(container.appends, 0, "flush holds too");
  assert.equal(log.pending, 2);
  selecting = false;
  log.release();
  tick();
  assert.equal(container.appends, 1);
  assert.deepEqual(container.nodes.map((n) => n.textContent), ["Downloading", "Get:1 repo foo"]);
});

test("a selection that starts after a frame was asked for still holds the lines", () => {
  let selecting = false;
  const { log, container, tick } = rig({ held: () => selecting });
  log.push({ kind: "raw", text: "one" });
  selecting = true;
  tick();
  assert.equal(container.appends, 0);
  selecting = false;
  log.release();
  tick();
  assert.equal(container.appends, 1);
});

test("a repeating byte line replaces the one before it, queued or on screen", () => {
  const { log, container, tick } = rig();
  const sent = (n) => ({ kind: "raw", text: `Sent bytes 0-${n}; ${n + 1} of 4000000 bytes sent to iOS`, pkg: "a" });
  log.push({ kind: "step", text: "Installing" });
  for (let n = 1000; n < 50000; n += 1000) log.push(sent(n));
  tick();
  assert.equal(container.nodes.length, 2, "the step and one byte line");
  assert.equal(container.nodes[1].textContent, sent(49000).text);
  log.push(sent(60000));
  log.push(sent(70000));
  tick();
  assert.equal(container.appends, 1, "an update on screen is no append");
  assert.equal(container.nodes[1].textContent, sent(70000).text);
  log.push({ kind: "raw", text: "Sent bytes 0-3999999; 4000000 of 4000000 bytes sent to iOS (all of it)", pkg: "a" });
  tick();
  assert.equal(container.nodes.length, 3, "a different line is a new line");
});

test("lineShape: only raw lines with numbers; another package's line is another line", () => {
  assert.equal(lineShape({ kind: "step", text: "Downloading 4%" }), null);
  assert.equal(lineShape({ kind: "raw", text: "Unpacking foo" }), null);
  assert.equal(lineShape({ kind: "raw", text: "Downloading 4%" }), lineShape({ kind: "raw", text: "Downloading 45.5%" }));
  assert.notEqual(lineShape({ kind: "raw", text: "x 1", pkg: "a" }), lineShape({ kind: "raw", text: "x 2", pkg: "b" }));
});

test("the queue keeps at most max lines while held", () => {
  let selecting = true;
  const { log, container, tick } = rig({ held: () => selecting, max: 10 });
  for (let i = 0; i < 50; i++) log.push({ kind: "step", text: `line ${"x".repeat(i)}` });
  assert.equal(log.pending, 10);
  selecting = false;
  log.release();
  tick();
  assert.equal(container.nodes.length, 10);
});

test("a long held queue goes out PER_FRAME lines a frame; an explicit flush sends the rest at once", () => {
  let selecting = true;
  const { log, container, frames, tick } = rig({ held: () => selecting });
  for (let i = 0; i < PER_FRAME * 2 + 50; i++) log.push({ kind: "step", text: `line ${"x".repeat(i)}` });
  selecting = false;
  log.release();
  tick();
  assert.equal(container.nodes.length, PER_FRAME);
  assert.equal(frames.length, 1, "the next frame is asked for");
  log.flush();
  assert.equal(container.nodes.length, PER_FRAME * 2 + 50);
  assert.equal(container.appends, 2);
});

test("selectionIn: a range inside the log, not a collapsed caret or one elsewhere", () => {
  const log = { contains: (n) => n?.inLog === true };
  const doc = (sel) => ({ getSelection: () => sel });
  const inside = { inLog: true };
  const outside = { inLog: false };
  assert.equal(selectionIn(log, doc({ rangeCount: 1, isCollapsed: false, anchorNode: inside, focusNode: inside })), true);
  assert.equal(selectionIn(log, doc({ rangeCount: 1, isCollapsed: true, anchorNode: inside, focusNode: inside })), false);
  assert.equal(selectionIn(log, doc({ rangeCount: 0 })), false);
  const whole = { rangeCount: 1, isCollapsed: false, anchorNode: outside, focusNode: outside, getRangeAt: () => ({ intersectsNode: (n) => n === log }) };
  assert.equal(selectionIn(log, doc(whole)), true, "Select All over the page covers the log");
  const other = { ...whole, getRangeAt: () => ({ intersectsNode: () => false }) };
  assert.equal(selectionIn(log, doc(other)), false);
  assert.equal(selectionIn(log, {}), false);
});
