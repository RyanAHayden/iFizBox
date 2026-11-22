// F367: the iOS 26 style's Liquid Glass bars. Under the native controls hook with the floating tab bar, the app's
// shell draws the tab bar and the nav bar's buttons (ui.glass): open with their rects, labels and selection; nothing
// sent when nothing changed (scrolling); the look-alikes go see-through on the shell's answer and show at once when the
// glass hides (a push sliding, a popup, a sheet over them); taps click the look-alike; closed when the hook goes off;
// a shell without ui.glass or below iOS 26 keeps the CSS bars. Plus the Swift handler's shape and ios26.css's hook.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fakeDocument, tick } from "./fakedom.test-helper.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = fakeDocument();
globalThis.document = doc;
const { syncGlass, glassSnapshot, glassWanted, resetGlass, GLASS_KEY } = await import("./glass.js");

function fakeShell({ refuse = null } = {}) {
  const calls = [];
  let stream = null;
  const native = {
    call(method, params, onEvent) {
      calls.push({ method, ...params });
      if (refuse) return Promise.reject(Object.assign(new Error(refuse.message), { code: refuse.code }));
      if (params.op === "open") { stream = onEvent; onEvent({ ready: true }); return new Promise(() => {}); }
      return Promise.resolve(null);
    },
  };
  return { native, calls, tap: (id) => stream({ tap: id }) };
}

const box = (x, y, w, h) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
const styles = new Map(); // element -> computed style stand-in
const win = {
  devicePixelRatio: 3,
  visualViewport: { offsetLeft: 0, offsetTop: 0 },
  getComputedStyle: (el, pseudo) => (pseudo ? {} : styles.get(el) ?? { color: "rgb(28, 28, 30)", fontSize: "10px", fontWeight: "500", backgroundColor: "rgba(0, 0, 0, 0)", position: "static" }),
};

function el(tag, cls, rect, kids = []) {
  const n = doc.createElement(tag);
  for (const c of cls.split(" ").filter(Boolean)) n.classList.add(c);
  n.getBoundingClientRect = () => rect;
  n.append(...kids);
  return n;
}

// The app's shell layout: a floating tab bar (Home, Sources, Search as the circle) and one nav item with Back and a
// right button. Returns the parts and a switch for what the hit test finds.
function app(native) {
  globalThis.ifizboxNative = native;
  const root = doc.documentElement;
  root.setAttribute("data-controls", "native");
  root.setAttribute("data-tabbar", "float");
  root.setAttribute("data-theme", "light");
  const tab = (name, x, w) => {
    const a = el("a", "tab", box(x, 780, w, 54), [
      el("span", "tab-icon", box(x + w / 2 - 13, 786, 26, 26)), Object.assign(el("span", "tab-label", box(x, 814, w, 12)), { _text: name }),
      Object.assign(el("span", "badge", box(x + w / 2 + 5, 778, 20, 20)), { hidden: true })]);
    a.dataset.tab = name.toLowerCase();
    return a;
  };
  const home = tab("Home", 25, 140), sources = tab("Sources", 165, 140), search = tab("Search", 330, 62);
  home.classList.add("active");
  styles.set(home, { color: "rgb(0, 122, 255)", backgroundColor: "rgba(0, 0, 0, 0.07)", fontSize: "10px", fontWeight: "500" });
  styles.set(search, { position: "absolute", color: "rgb(28, 28, 30)", fontSize: "10px", fontWeight: "500" });
  search.querySelector(".tab-label")._text = "";
  const bar = el("nav", "tabbar", box(21, 776, 290, 62), [home, sources, search]);
  bar.id = "tabbar";
  const back = Object.assign(el("button", "bar-button back", box(5, 63, 80, 38)), { _text: "Home" });
  const install = Object.assign(el("button", "bar-button", box(300, 63, 80, 38)), { _text: "Install" });
  const item = el("div", "nav-item is-top", box(0, 59, 393, 44), [el("div", "nav-left", box(0, 59, 90, 44), [back]), el("div", "nav-right", box(290, 59, 100, 44), [install])]);
  const stack = el("div", "nav-stack is-active", box(0, 59, 393, 44), [item]);
  doc.body.append(el("div", "navbar", box(0, 0, 393, 103), [stack]), bar);
  let cover = null;
  doc.elementFromPoint = (x, y) => cover ?? (y > 700 ? (x > 320 ? search : home) : (x < 100 ? back : install));
  return { bar, home, sources, search, back, install, item, setCover: (n) => { cover = n; } };
}

function reset() {
  for (const c of doc.body.children) c.parentNode = null;
  doc.body.children.length = 0;
  for (const k of Object.keys(doc.documentElement.attrs)) doc.documentElement.removeAttribute(k);
  delete doc.getAnimations;
  styles.clear();
  resetGlass();
}

test("only in the app, under the native controls hook with the floating tab bar", () => {
  reset();
  const { native } = fakeShell();
  app(native);
  assert.equal(glassWanted(doc, native), true);
  assert.equal(glassWanted(doc, null), false, "the site: no bridge");
  doc.documentElement.removeAttribute("data-controls");
  assert.equal(glassWanted(doc, native), false, "iOS 15-25, or another style: no native controls hook");
  doc.documentElement.setAttribute("data-controls", "native");
  doc.documentElement.removeAttribute("data-tabbar");
  assert.equal(glassWanted(doc, native), false);
  assert.equal(glassSnapshot(doc, win, native), null);
});

test("open: the pill, the Search circle, each tab and both buttons; look-alikes see-through on ready", () => {
  reset();
  const { native, calls } = fakeShell();
  const { bar, back, install } = app(native);
  syncGlass(doc, native, win);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.method, "ui.glass");
  assert.equal(c.op, "open");
  assert.equal(c.key, GLASS_KEY);
  assert.deepEqual(c.tabbar.pill, { x: 21, y: 776, width: 290, height: 62 });
  assert.deepEqual(c.tabbar.circle, { x: 330, y: 780, width: 62, height: 54 });
  assert.equal(c.tabbar.hidden, false);
  assert.deepEqual(c.tabbar.items.map((i) => [i.id, i.own, i.selected, i.label?.text ?? null]),
    [["home", false, true, "Home"], ["sources", false, false, "Sources"], ["search", true, false, null]]);
  assert.deepEqual(c.tabbar.items[0].label.rect, { x: 25, y: 814, width: 140, height: 12 });
  assert.deepEqual(c.buttons.map((b) => [b.kind, b.title]), [["back", "Home"], ["plain", "Install"]]);
  assert.equal(c.buttonsHidden, false);
  assert.deepEqual(c.colors, { text: "rgb(28, 28, 30)", active: "rgb(0, 122, 255)", chosen: "rgba(0, 0, 0, 0.07)" });
  assert.equal(c.dark, false);
  assert.equal(doc.documentElement.getAttribute("data-glass"), "native");
  for (const n of [bar, back, install]) assert.equal(n.dataset.glassShown, "", "covered by the glass: see-through");
  syncGlass(doc, native, win);
  assert.equal(calls.length, 1, "nothing changed (a scroll): nothing sent");
});

test("titles and buttons follow the page; a badge and the chosen tab update the glass", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { install, sources, home } = app(native);
  syncGlass(doc, native, win);
  install._text = "Remove";
  sources.querySelector(".badge").hidden = false;
  sources.querySelector(".badge")._text = "3";
  home.classList.remove("active");
  sources.classList.add("active");
  syncGlass(doc, native, win);
  const up = calls.at(-1);
  assert.equal(up.op, "update");
  assert.equal(up.buttons[1].title, "Remove");
  assert.deepEqual(up.tabbar.items[1].badge, { text: "3", rect: { x: 240, y: 778, width: 20, height: 20 }, spin: false });
  assert.deepEqual(up.tabbar.items.map((i) => i.selected), [false, true, false]);
});

test("a push hides the buttons (the CSS ones show at once) but not the tab bar; back at rest they return", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { item, back, install, bar } = app(native);
  syncGlass(doc, native, win);
  item.classList.add("is-moving");
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).buttonsHidden, true);
  assert.equal(calls.at(-1).tabbar.hidden, false);
  assert.equal(back.dataset.glassShown, undefined, "the look-alike shows while the glass can't follow the slide");
  assert.equal(install.dataset.glassShown, undefined);
  assert.equal(bar.dataset.glassShown, "", "the tab bar stays glass");
  item.classList.remove("is-moving");
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).buttonsHidden, false);
  await tick();
  assert.equal(back.dataset.glassShown, "", "see-through again once the shell answered");
});

test("a popup, or a sheet over the tab bar, hides the glass there", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { bar, setCover } = app(native);
  syncGlass(doc, native, win);
  const sheet = doc.createElement("div");
  setCover(sheet);
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).tabbar.hidden, true);
  assert.equal(calls.at(-1).buttonsHidden, true);
  assert.equal(bar.dataset.glassShown, undefined);
  setCover(null);
  const alert = doc.createElement("div");
  alert.setAttribute("role", "alertdialog");
  doc.body.append(alert);
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).tabbar.hidden, true, "a popup");
  alert.remove();
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).tabbar.hidden, false);
});

test("taps on the glass click the look-alike: a tab, Back, a button", () => {
  reset();
  const { native, calls, tap } = fakeShell();
  const { sources, back, install } = app(native);
  const clicked = [];
  for (const [n, name] of [[sources, "sources"], [back, "back"], [install, "install"]]) n.addEventListener("click", () => clicked.push(name));
  syncGlass(doc, native, win);
  tap("tab:sources");
  tap("button:" + calls[0].buttons[0].id);
  tap("button:" + calls[0].buttons[1].id);
  tap("button:nope");
  assert.deepEqual(clicked, ["sources", "back", "install"]);
});

test("closed when the hook goes off (another style); every look-alike shows", () => {
  reset();
  const { native, calls } = fakeShell();
  const { bar } = app(native);
  syncGlass(doc, native, win);
  doc.documentElement.removeAttribute("data-controls");
  syncGlass(doc, native, win);
  assert.deepEqual([calls.at(-1).op, calls.at(-1).key], ["close", GLASS_KEY]);
  assert.equal(doc.documentElement.getAttribute("data-glass"), null);
  assert.equal(bar.dataset.glassShown, undefined);
});

test("below iOS 26 or an older shell: refused once, the CSS bars from then on", async () => {
  for (const refuse of [{ message: "Liquid Glass needs iOS 26", code: "unsupported" }, { message: "unknown method ui.glass" }]) {
    reset();
    const { native, calls } = fakeShell({ refuse });
    const { bar } = app(native);
    syncGlass(doc, native, win);
    await tick();
    assert.equal(doc.documentElement.getAttribute("data-glass"), null);
    assert.equal(bar.dataset.glassShown, undefined);
    bar.querySelector(".tab").classList.remove("active");
    syncGlass(doc, native, win);
    assert.equal(calls.length, 1, "no more calls");
  }
});

test("the shell: ui.glass registered, UIGlassEffect views over the web view, iOS 26 only", () => {
  const swift = readFileSync(join(HERE, "../../../native/Sources/NativeGlass.swift"), "utf8");
  const bridge = readFileSync(join(HERE, "../../../native/Sources/Bridge.swift"), "utf8");
  assert.match(bridge, /NativeGlass\.register\(self\)/);
  assert.match(swift, /b\.on\("ui\.glass"\)/);
  assert.match(swift, /UIGlassEffect\(style:/);
  assert.match(swift, /UIGlassContainerEffect\(\)/);
  assert.match(swift, /\.prominentGlass\(\)/);
  assert.match(swift, /#available\(iOS 26\.0, \*\) else \{ return c\.reply\(nil, "unsupported:/);
  assert.match(swift, /emit\(\[\["tap":/);
  assert.match(swift, /emit\(\[\["ready": true\]\]\)/);
});

test("ios26.css: the look-alikes go see-through only under data-glass, and the nav bar opens to the content", () => {
  const css = readFileSync(join(HERE, "../ios26.css"), "utf8");
  assert.match(css, /html\[data-style="ios26"\]\[data-glass="native"\] \[data-glass-shown\] \{ opacity: 0; \}/);
  assert.match(css, /html\[data-style="ios26"\]\[data-glass="native"\] \.navbar/);
  for (const other of ["ios6.css", "ios7.css", "ios13.css", "style.css"]) {
    assert.doesNotMatch(readFileSync(join(HERE, "..", other), "utf8"), /data-glass/, `${other} never sees the glass hook`);
  }
});
