// B356: Install IPAs' rows (and Sources' and the Wish List's, which share the code path: nav/rowswipe.js's full
// option behind fullSwipeEra) delete with a full-row swipe under iOS 7, 13 and 26, as Installed's apps list (B332);
// iOS 6 keeps the swipe that shows the red Delete.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { libraryGroup } from "./myipas.js";
import { fakeDocument } from "../fakes.test-helper.js";

const IPA = { file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", size: 1, signed: null };
const tick = () => new Promise((r) => setTimeout(r, 0));

async function withEra(style, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => { queueMicrotask(f); return 1; };
  const doc = fakeDocument();
  doc.documentElement.setAttribute("data-style", style);
  globalThis.document = doc;
  try { return await fn(); } finally {
    if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document;
    globalThis.requestAnimationFrame = raf;
  }
}

// A finger from x 300 leftwards to `to`, then lifted (when `lift`).
async function drag(g, li, to, lift = true) {
  const target = li.querySelector(".cell-inner");
  const ev = (x) => ({ target, clientX: x, clientY: 10, pointerId: 1, isPrimary: true, button: 0 });
  g.ul.fire("pointerdown", ev(300));
  await tick();
  g.ul.fire("pointermove", ev(285));
  g.ul.fire("pointermove", ev(to));
  await tick();
  if (lift) g.ul.fire("pointerup", ev(to));
}

for (const style of ["ios7", "ios13", "ios26"]) {
  test(`B356: ${style} Install IPAs: a long left swipe slides the row off, then deletes it with no button`, () => withEra(style, async () => {
    const deleted = [];
    const g = libraryGroup([IPA], { site: false, jailbreak: false, on: { delete: async (es) => { deleted.push(...es.map((e) => e.file)); return { deleted: [IPA.file], failed: [] }; } } });
    const li = g.cellOf(IPA.file);
    await drag(g, li, 285 - 250, false);
    assert.ok(!li.classList.contains("armed"), "no red Delete button");
    assert.ok(li.classList.contains("swiping"), "the row moves");
    assert.equal(li._swipeBack.dataset.kind, "remove");
    assert.equal(li._swipeBack.dataset.full, "1");
    g.ul.fire("pointerup", { target: li.querySelector(".cell-inner"), clientX: 35, clientY: 10, pointerId: 1 });
    assert.match(li.querySelector(".cell-inner").style.transform, /translate3d\(-/, "slides off the left edge");
    await new Promise((r) => setTimeout(r, 350)); // the slide's time, then commit
    assert.deepEqual(deleted, [IPA.file]);
  }));
}

test("B356: a short swipe deletes nothing; managing or a shown Delete starts no swipe", () => withEra("ios13", async () => {
  const deleted = [];
  const g = libraryGroup([IPA], { site: false, jailbreak: false, on: { delete: async (es) => { deleted.push(...es); return { deleted: [], failed: [] }; } } });
  const li = g.cellOf(IPA.file);
  await drag(g, li, 285 - 60);
  await new Promise((r) => setTimeout(r, 450)); // past the spring back's fallback timer (no transitionend here)
  assert.deepEqual(deleted, []);
  assert.ok(!li.classList.contains("swiping"), "back at rest");
  g.step({ type: "edit" });
  await drag(g, li, 285 - 250);
  assert.ok(!li.classList.contains("swiping"), "managing: the row stays");
}));

test("B356: iOS 6 keeps the swipe that shows the red Delete", () => withEra("ios6", async () => {
  const g = libraryGroup([IPA], { site: false, jailbreak: false, on: { delete: async () => assert.fail("nothing deletes on the swipe") } });
  const li = g.cellOf(IPA.file);
  await drag(g, li, 240);
  assert.ok(li.classList.contains("armed"), "the red Delete");
  assert.ok(!li.classList.contains("swiping"), "the row doesn't slide");
}));

// Sources and the Wish List: the same swipe, their iOS 6 swipe only outside fullSwipeEra (Chromium probe: journal
// 2026-11-22-b356-full-row-swipe-lists/probe.mjs).
test("B356: Sources and the Wish List put the full-row swipe on their rows, iOS 6's only outside fullSwipeEra", () => {
  const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  for (const [file, attach, sel] of [["./sources.js", "attachDeleteSwipe", ".source-row"], ["./installed.js", "attachWishSwipe", ".wish-row"]]) {
    const s = src(file);
    const body = s.slice(s.indexOf(`function ${attach}(`), s.indexOf(`function ${attach}(`) + 900);
    assert.match(body, new RegExp(`rowSelector: "\\${sel}"`), `${file}: on ${sel}`);
    assert.match(body, /canStart: \([a-z]+\) => fullSwipeEra\(\)/, `${file}: only under iOS 7 and later`);
    assert.match(body, /full: \(\) => true/, `${file}: the full-row swipe`);
    assert.match(body, /kindOf: \(\) => "remove"/, `${file}: red`);
  }
  assert.match(src("./sources.js"), /!e\.target\.closest\("\.del-confirm"\) && !fullSwipeEra\(\)/, "Sources' red Delete swipe: iOS 6 only");
  assert.match(src("./installed.js"), /start = row && !wishView\.editing && !e\.target\.closest\("\.del-confirm"\) && !fullSwipeEra\(\)/, "Wish List's: iOS 6 only");
});
