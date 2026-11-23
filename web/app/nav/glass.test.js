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
const { syncGlass, slideGlass, glassSnapshot, glassWanted, resetGlass, GLASS_KEY } = await import("./glass.js");

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
  // The page under it as a slide starts: its nav item a quarter screen left, its Back and Edit moved with it.
  const below = () => {
    const b = Object.assign(el("button", "bar-button back", box(5 - 196.5, 63, 90, 38)), { _text: "Sources" });
    const e = Object.assign(el("button", "bar-button", box(310 - 196.5, 63, 70, 38)), { _text: "Edit" });
    const it = el("div", "nav-item is-moving", box(-196.5, 59, 393, 44), [el("div", "nav-left", box(-196.5, 59, 100, 44), [b]), el("div", "nav-right", box(100, 59, 80, 44), [e])]);
    stack.append(it);
    return { item: it, back: b, edit: e };
  };
  return { bar, home, sources, search, back, install, item, below, setCover: (n) => { cover = n; } };
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
  assert.equal(c.tabbar.hidden, false);
  assert.equal(c.tabbar.pill, undefined, "F369: a real UITabBar, no rects to lay glass at");
  assert.deepEqual(c.tabbar.items.map((i) => [i.id, i.title, i.search, i.selected, i.badge]),
    [["home", "Home", false, true, null], ["sources", "Sources", false, false, null], ["search", "Search", true, false, null]]);
  for (const i of c.tabbar.items) {
    assert.match(i.icon, /^tab-/, `${i.id}: an outline glyph`);
    assert.match(i.selectedIcon, /^tab-/, `${i.id}: a filled glyph`);
    assert.notEqual(i.icon, i.selectedIcon, `${i.id}: outline and filled differ`);
  }
  assert.equal(new Set(c.tabbar.items.map((i) => i.icon)).size, 3, "one glyph per tab");
  assert.deepEqual(c.buttons.map((b) => [b.kind, b.title]), [["back", "Home"], ["plain", "Install"]]);
  assert.equal(c.buttonsHidden, false);
  assert.deepEqual(c.colors, { text: "rgb(28, 28, 30)", active: "rgb(0, 122, 255)" });
  assert.equal(c.dark, false);
  assert.equal(doc.documentElement.getAttribute("data-glass"), "native");
  for (const n of [bar, back, install]) assert.equal(n.dataset.glassShown, "", "covered by the glass: see-through");
  assert.ok([...bar.querySelectorAll("a.tab")].every((a) => a.inert === true), "the hidden tabs take no touches");
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
  assert.equal(up.tabbar.items[1].badge, "3");
  assert.deepEqual(up.tabbar.items.map((i) => i.selected), [false, true, false]);
  sources.querySelector(".badge").classList.add("spinning");
  sources.querySelector(".badge")._text = "";
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).tabbar.items[1].badge, "", "the refreshing spinner: a dot");
});

test("a card sheet scaling the page back (the tab bar too) hides the UITabBar until it is still", () => {
  reset();
  const { native, calls } = fakeShell();
  const { bar } = app(native);
  syncGlass(doc, native, win);
  bar.style.transform = "scale(0.94)";
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).tabbar.hidden, true);
  bar.style.transform = "";
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).tabbar.hidden, false);
});

test("a tab tap clicks the look-alike and resends the page's choice, even when it didn't switch", () => {
  reset();
  const { native, calls, tap } = fakeShell();
  app(native);
  syncGlass(doc, native, win);
  const n = calls.length;
  tap("tab:sources"); // the page refuses: Home stays chosen, nothing changed on the page
  syncGlass(doc, native, win);
  assert.equal(calls.length, n + 1, "sent again, so the UITabBar goes back to Home");
  assert.deepEqual(calls.at(-1).tabbar.items.map((i) => i.selected), [true, false, false]);
});

test("the tab glyphs: our own outline drawings for the UITabBar, the filled ones for the chosen tab", async () => {
  const { ICON_SETS } = await import("../icons/rowicons.js");
  for (const tab of ["home", "sources", "changes", "installed", "search"]) {
    const svg = ICON_SETS.ios26.tabsOutline[tab];
    assert.match(svg, /fill='none'/, `${tab}: outline`);
    assert.match(svg, /stroke-width='2\.2'/, `${tab}: iOS 26's tab weight`);
    assert.equal(svg.match(/stroke-linejoin=/g)?.length, 1, `${tab}: round joins once, on the whole glyph (no duplicate attribute)`);
    assert.match(svg, /^<svg [^>]*stroke-linecap='round'/, `${tab}: round caps on the whole glyph`);
    assert.ok(ICON_SETS.ios26.tabsSelected[tab], `${tab}: filled`);
  }
});

test("a slide keeps the glass up: both pages' look-alikes see-through, nothing hidden or sent", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { item, back, install, bar, below } = app(native);
  syncGlass(doc, native, win);
  const under = below();
  item.classList.add("is-moving");
  syncGlass(doc, native, win);
  assert.equal(calls.length, 1, "the edge swipe under the finger: the glass stays as it is");
  for (const n of [back, install, under.back, under.edit, bar]) assert.equal(n.dataset.glassShown, "", "see-through at once");
  item.classList.remove("is-moving"); // a cancelled swipe
  under.item.remove();
  syncGlass(doc, native, win);
  assert.equal(calls.length, 1);
  assert.equal(back.dataset.glassShown, "");
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
  assert.ok([...bar.querySelectorAll("a.tab")].every((a) => a.inert === false), "the CSS tabs take touches again");
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

test("the shell: ui.glass registered, a real UITabBar and UIKit glass buttons over the web view, iOS 26 only", () => {
  const swift = readFileSync(join(HERE, "../../../native/Sources/NativeGlass.swift"), "utf8");
  const bridge = readFileSync(join(HERE, "../../../native/Sources/Bridge.swift"), "utf8");
  assert.match(bridge, /NativeGlass\.register\(self\)/);
  assert.match(swift, /b\.on\("ui\.glass"\)/);
  assert.match(swift, /UITabBarController\(\)/);
  assert.match(swift, /UISearchTab\(viewControllerProvider:/, "Search as the search tab");
  assert.match(swift, /UITab\(title:/);
  assert.match(swift, /\.badgeValue = badge/);
  assert.match(swift, /tabBarMinimizeBehavior = \.onScrollDown/, "shrinks on scroll");
  assert.match(swift, /setContentScrollView\(best, for: \.bottom\)/, "following the page's own scroller");
  assert.match(swift, /vc\.view\.insertSubview\(web, at: 0\)/, "the web view inside the chosen tab's view");
  assert.match(swift, /shouldSelectTab tab: UITab\) -> Bool \{\n\s+if let id = .*emit\(id\)/, "taps go to the page");
  assert.doesNotMatch(swift, /UIImage\(systemName:/, "no SF Symbols (AGENTS.md)");
  assert.doesNotMatch(swift, /UIGlassEffect\(style:/, "F369: no glass laid over the look-alike any more");
  assert.match(swift, /\.prominentGlass\(\)/);
  assert.match(swift, /: \.glass\(\)/);
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

test("a slide's transform left at rest doesn't keep the buttons hidden; one mid-swipe does", () => {
  reset();
  const { native, calls } = fakeShell();
  const { item } = app(native);
  item.style.transform = "translateX(0px)";
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).buttonsHidden, false);
  item.style.transform = "translateX(120px)";
  syncGlass(doc, native, win);
  assert.equal(calls.at(-1).buttonsHidden, true);
});

test("another error (no window): the CSS bars, and the glass opens again a second later by itself", async () => {
  reset();
  let refuse = true;
  const calls = [];
  const native = { call(m, p, on) {
    calls.push(p.op);
    if (refuse) return Promise.reject(new Error("no web view to show the glass in"));
    if (p.op === "open") { on({ ready: true }); return new Promise(() => {}); }
    return Promise.resolve(null);
  } };
  app(native);
  const glass = await import("./glass.js");
  glass.watchGlass(doc, { ...win, MutationObserver: undefined, addEventListener() {} }, native);
  syncGlass(doc, native, win);
  await tick();
  refuse = false;
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = undefined;
  globalThis.getComputedStyle = win.getComputedStyle; // the scheduled sync runs with the real globals
  for (let end = Date.now() + 5000; Date.now() < end && calls.filter((c) => c === "open").length < 2;) await new Promise((r) => setTimeout(r, 50));
  globalThis.requestAnimationFrame = realRaf;
  delete globalThis.getComputedStyle;
  assert.deepEqual(calls.slice(0, 1), ["open"]);
  assert.ok(calls.filter((c) => c === "open").length >= 2, `reopened: ${calls}`);
});

// B346, B382: the back transition's flicker. The shell keeps one glass view per place in the bar (l0, r0, ...) and
// fades to the coming page's buttons as the slide starts; after the slide nothing is left to send.
test("a back slide: the coming page's buttons go out once as it starts, with its time, at their place at rest", async () => {
  reset();
  const { native, calls, tap } = fakeShell();
  const { item, back, install, below } = app(native);
  syncGlass(doc, native, win);
  assert.deepEqual(calls[0].buttons.map((b) => b.id), ["l0", "r0"]);
  assert.equal(calls[0].slide, undefined);
  const under = below();
  item.classList.add("is-moving");
  syncGlass(doc, native, win);
  slideGlass({ item: under.item, ms: 350, easing: "cubic-bezier(.2,.8,.4,1)" }, doc, native, win);
  assert.equal(calls.length, 2);
  const up = calls[1];
  assert.equal(up.slide, 350);
  assert.deepEqual(up.curve, [0.2, 0.8, 0.4, 1], "the page slide's own curve");
  assert.equal(up.buttonsHidden, false);
  assert.deepEqual(up.buttons.map((b) => [b.id, b.title, b.rect.x]), [["l0", "Sources", 5], ["r0", "Edit", 310]]);
  // the slide moves both, and the page changes a label meanwhile: nothing sent until it ends
  under.back.getBoundingClientRect = () => box(-40, 63, 90, 38);
  under.edit._text = "Done";
  syncGlass(doc, native, win);
  assert.equal(calls.length, 2);
  const clicked = [];
  back.addEventListener("click", () => clicked.push("old"));
  under.back.addEventListener("click", () => clicked.push("new"));
  tap("button:l0");
  assert.deepEqual(clicked, [], "no taps while it slides");
  // at rest
  under.edit._text = "Edit";
  under.back.getBoundingClientRect = () => box(5, 63, 90, 38);
  under.edit.getBoundingClientRect = () => box(310, 63, 70, 38);
  item.classList.remove("is-moving");
  item.classList.remove("is-top");
  under.item.classList.remove("is-moving");
  under.item.classList.add("is-top");
  doc.elementFromPoint = (x, y) => (y > 700 ? doc.body.querySelector("a.tab") : x < 100 ? under.back : under.edit);
  syncGlass(doc, native, win);
  await tick();
  assert.equal(calls.length, 2, "nothing changes after the slide");
  assert.equal(under.back.dataset.glassShown, "");
  for (const n of [back, install]) assert.equal(n.dataset.glassShown, undefined, "the page that left keeps no mark");
  tap("button:l0");
  assert.deepEqual(clicked, ["new"]);
});

test("a popup closing into a slide: the glass comes with it, the coming page's; under a sheet it stays away", async () => {
  for (const sheet of [false, true]) {
    reset();
    const { native, calls } = fakeShell();
    const { item, back, below, setCover } = app(native);
    syncGlass(doc, native, win);
    if (sheet) setCover(doc.createElement("div"));
    const alert = doc.createElement("div");
    alert.setAttribute("role", "alertdialog");
    if (!sheet) doc.body.append(alert);
    syncGlass(doc, native, win);
    await tick();
    assert.equal(calls.at(-1).buttonsHidden, true);
    alert.remove();
    const under = below();
    item.classList.add("is-moving");
    slideGlass({ item: under.item, ms: 350 }, doc, native, win);
    await tick();
    assert.equal(calls.at(-1).buttonsHidden, sheet);
    assert.equal(back.dataset.glassShown, sheet ? undefined : "");
    if (!sheet) assert.deepEqual(calls.at(-1).buttons.map((b) => b.title), ["Sources", "Edit"]);
  }
});

test("a nav item starting to slide covers the coming look-alikes at once, not a frame later; app.js tells each slide", async () => {
  reset();
  const { native, calls } = fakeShell();
  const { item, below } = app(native);
  const { watchGlass } = await import("./glass.js");
  let observed = null;
  class Observer { constructor(cb) { observed = cb; } observe() {} }
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {}; // the watcher's scheduled syncs never run here
  globalThis.getComputedStyle = win.getComputedStyle; // the observer's sync runs with the real globals
  try {
    syncGlass(doc, native, win);
    watchGlass(doc, { ...win, MutationObserver: Observer, addEventListener() {} }, native);
    const under = below();
    item.classList.add("is-moving");
    observed([{ type: "attributes", attributeName: "class", target: item }]);
    assert.equal(under.back.dataset.glassShown, "", "in the observer's own turn");
    const js = readFileSync(join(HERE, "../app.js"), "utf8");
    assert.match(js, /new CustomEvent\("ifizbox:slide", \{ detail: \{ item: \(p1 \? top : below\)\.page\.item, ms:/);
    assert.match(readFileSync(join(HERE, "glass.js"), "utf8"), /addEventListener\?\.\("ifizbox:slide"/);
  } finally {
    globalThis.requestAnimationFrame = raf;
    delete globalThis.getComputedStyle;
    resetGlass();
  }
});

test("the shell: a bar button's glass configuration is set once; titles are its own faces", () => {
  const swift = readFileSync(join(HERE, "../../../native/Sources/NativeGlass.swift"), "utf8");
  assert.equal(swift.match(/\bconfiguration = c\b/g)?.length, 1);
  assert.match(swift, /if configuration == nil \{/);
  assert.doesNotMatch(swift, /attributedTitle/, "a title given to the configuration makes UIKit draw the glass again");
  assert.match(swift, /\[0\.36, 0\.66, 0\.04, 1\]/, "transition.js EASE");
});

test("a bar button's look-alike fades out under its glass button, and shows again at once when the glass hides", async () => {
  reset();
  const { native } = fakeShell();
  const { back, bar, setCover } = app(native);
  const fades = new Map();
  for (const n of [back, bar]) n.animate = (frames, timing) => {
    const a = { frames, timing, cancelled: false, cancel() { this.cancelled = true; } };
    fades.set(n, a);
    return a;
  };
  syncGlass(doc, native, win);
  assert.equal(back.dataset.glassShown, "");
  const fade = fades.get(back);
  assert.deepEqual(fade?.frames, [{ opacity: 1 }, { opacity: 0 }], "the look-alike fades out under the glass");
  assert.ok(fade.timing.duration > 0 && fade.timing.duration <= 200);
  assert.equal(fades.has(bar), false, "the tab bar's look-alike goes at once: the UITabBar is not over its rects");
  setCover(doc.createElement("div"));
  syncGlass(doc, native, win);
  assert.equal(back.dataset.glassShown, undefined);
  assert.equal(fade.cancelled, true, "a fade still running stops: the look-alike shows at once");
});
