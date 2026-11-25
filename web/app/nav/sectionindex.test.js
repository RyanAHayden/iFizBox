// The A–Z index and the virtualised list agree after every jump: the letter, the pinned header and the rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVList, withLetterHeaders } from "./vlist.js";
import { createSectionIndex } from "./sectionindex.js";

const NAV = 105, BAR = 44, VIEW = 874; // the page's padding under the nav bar, Browse's bar above the list
const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

function node() {
  const on = {};
  return {
    children: [], style: {}, dataset: {}, hidden: false, textContent: "", className: "",
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    append(...n) { this.children.push(...n); }, setAttribute() {}, remove() {}, click() {},
    addEventListener(t, f) { (on[t] ??= []).push(f); }, removeEventListener() {},
    fire(t, e = {}) { for (const f of on[t] ?? []) f(e); },
    getBoundingClientRect: () => ({ top: 100, height: 27 * 10 }),
  };
}

function setup(t, names, { padding = NAV, bar = BAR } = {}) {
  const saved = ["document", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].map((k) => [k, globalThis[k]]);
  t.after(() => { for (const [k, v] of saved) globalThis[k] = v; });
  globalThis.document = { createElement: node, body: node() };
  globalThis.document.body.append = () => {};
  globalThis.getComputedStyle = () => ({ paddingTop: `${padding}px` });
  globalThis.requestAnimationFrame = (f) => { f(); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  const scroller = node();
  let at = 0;
  Object.assign(scroller, { clientHeight: VIEW, parentElement: node() });
  Object.defineProperty(scroller, "scrollTop", { get: () => at, set(v) {
    const to = Math.max(0, Math.min(v, scroller.scrollHeight - VIEW));
    if (to !== at) { at = to; scroller.fire("scroll"); }
  } });
  const items = withLetterHeaders(names.map((name) => ({ name })), (r) => (/[A-Z]/.test(r.name[0]) ? r.name[0] : "#"));
  const list = createVList(scroller, { createRow: node, bindRow: (n, r) => { n.textContent = r.name; } });
  list.el.offsetTop = padding + bar;
  list.setItems(items);
  scroller.scrollHeight = padding + bar + parseFloat(list.el.style.height) + 120;
  const index = createSectionIndex(scroller, list);
  const y = (l) => 100 + LETTERS.indexOf(l) * 10 + 5;
  const sticky = list.el.children[0];
  // the row or header drawn at the top of the window: scrollTop + padding in the content, less the list's start
  const firstShown = () => {
    const top = scroller.scrollTop + padding - list.el.offsetTop;
    return list.el.children.slice(1).filter((n) => !n.hidden).map((n) => ({ n, y: parseFloat(n.style.transform.slice(11)) }))
      .filter((x) => x.y <= top).sort((a, b) => b.y - a.y)[0]?.n.textContent;
  };
  return { scroller, list, sticky, index, firstShown,
    press: (l) => index.el.fire("pointerdown", { preventDefault() {}, clientY: y(l) }),
    drag: (l) => index.el.fire("pointermove", { clientY: y(l) }),
    lift: () => index.el.fire("pointerup") };
}

const many = (letters) => [...letters].flatMap((l) => Array.from({ length: 20 }, (_, i) => `${l}pack ${i}`));

test("the first section, # and the letters before it go to the page's top", (t) => {
  const p = setup(t, many("DFMZ"));
  for (const l of ["#", "A", "D"]) {
    p.press("Z");
    assert.ok(p.scroller.scrollTop > 0);
    p.drag(l);
    assert.equal(p.scroller.scrollTop, 0, l);
    p.lift();
  }
  p.press("F"); // not E's neighbour above: the next section there is
  p.drag("E");
  assert.equal(p.firstShown(), "F");
  p.lift();
});

test("# is the top even when the list starts with another letter", (t) => {
  const p = setup(t, many("AZ"));
  p.press("Z");
  p.drag("#");
  assert.equal(p.scroller.scrollTop, 0);
});

for (const [what, opts] of [["under the nav bar and Browse's bar", {}], ["in a scroller of its own", { padding: 0, bar: 0 }]]) {
  test(`letter, pinned header and first row agree after each jump, down and up (${what})`, (t) => {
    const p = setup(t, many("#ABCDEFGHIJKLMNOPQRSTUVWXYZ"), opts);
    p.scroller.scrollTop = 5000; // partway, as after a fling
    p.press("B");
    for (const l of [...LETTERS.slice(1), ...LETTERS.slice(1).reverse()]) {
      p.drag(l);
      assert.equal(p.firstShown(), l, l);
      assert.equal(p.sticky.hidden, false, l);
      assert.equal(p.sticky.textContent, l);
    }
    p.drag("#");
    assert.equal(p.scroller.scrollTop, 0);
    p.lift();
    assert.equal(p.scroller.style.overflowY, "");
  });
}

test("a jump re-reads where the list starts: the bar above it grew since", (t) => {
  const p = setup(t, many("ABCZ"));
  p.list.el.offsetTop += 44; // after the list kept its first reading; nothing resized it
  p.press("C");
  assert.equal(p.firstShown(), "C");
  assert.equal(p.sticky.textContent, "C");
  p.lift();
  const at = p.scroller.scrollTop;
  p.list.el.offsetTop += 44;
  p.scroller.scrollTop = at + 44; // already where C's jump lands: no scroll event follows it
  p.press("C");
  assert.equal(p.scroller.scrollTop, at + 44);
  assert.equal(p.firstShown(), "C");
  assert.equal(p.sticky.style.transform, "translateY(0px)");
});
