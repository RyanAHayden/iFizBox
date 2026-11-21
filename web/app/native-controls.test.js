// F345a: the native controls hook (<html data-controls="native">, native-controls.js) and each control it swaps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { controlsFor, drawsIos26Controls, applyControls, nativeControls, FEATURE_26 } from "./native-controls.js";
import { createSwitch, redrawSwitches } from "./nav/switch.js";
import { fakeDocument, withDocument } from "./nav/fakedom.test-helper.js";
import { cssRules, layoutIn } from "./ios6-css.test.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// The user agents the rule meets: the 15 Pro's app web view (iOS 27, OS frozen at 18_7, no Version/), Safari 26 and
// 18 on an iPhone, the iPhone 7's Safari 15 and its app web view, an iPad asking for the desktop page, desktop Chrome.
const UA = {
  appWebView27: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  safari26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  safari18: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  safari15: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1",
  appWebView15: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadDesktop26: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  chrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};
const has26 = (q) => q === FEATURE_26; // a WebKit 26+ CSS.supports
const none = () => false;              // an older one

// The cases, and the answer each must give under the iOS 26 style.
const CASES = [
  ["the app on iOS 27 (feature test, before app.info)", { userAgent: UA.appWebView27, supports: has26 }, true],
  ["the app on iOS 27, app.info answered", { userAgent: UA.appWebView27, supports: has26, nativeIos: "27.1" }, true],
  ["the app on iOS 26.0, app.info answered", { userAgent: UA.appWebView27, supports: none, nativeIos: "26.0" }, true],
  ["the iPhone 7's app (iOS 15), app.info answered", { userAgent: UA.appWebView15, supports: none, nativeIos: "15.8.8" }, false],
  ["the iPhone 7's app before app.info", { userAgent: UA.appWebView15, supports: none }, false],
  ["Safari 26 on an iPhone", { userAgent: UA.safari26, supports: has26 }, true],
  ["Safari 18 on an iPhone", { userAgent: UA.safari18, supports: none }, false],
  ["Safari 15 on the iPhone 7", { userAgent: UA.safari15, supports: none }, false],
  ["Safari 26 on an iPad asking for the desktop page", { userAgent: UA.ipadDesktop26, supports: has26, touch: 5 }, true],
  ["Safari 26 on a Mac (no touch)", { userAgent: UA.ipadDesktop26, supports: has26, touch: 0 }, false],
  ["desktop Chrome, which has anchor positioning", { userAgent: UA.chrome, supports: () => true }, false],
];

test("F345a: the hook is on only under the iOS 26 style and only where WebKit draws iOS 26's controls", () => {
  for (const [what, env, want] of CASES) {
    assert.equal(drawsIos26Controls(env), want, what);
    assert.equal(controlsFor({ style: "ios26", ...env }), want ? "native" : null, what);
    for (const style of ["ios6", "ios7", "ios13", null]) assert.equal(controlsFor({ style, ...env }), null, `${what}, ${style}`);
  }
  assert.equal(drawsIos26Controls({ userAgent: UA.appWebView27, supports: () => { throw new Error("no CSS.supports"); } }), false);
});

// theme-boot.js before first paint must give the same answer (it can't import native-controls.js).
function boot({ style, userAgent, supports, touch = 0 }) {
  const attrs = {};
  const store = { "ifizbox.style": style };
  const ctx = {
    location: { hash: "" },
    localStorage: { getItem: (k) => store[k] ?? null },
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent, maxTouchPoints: touch },
    CSS: { supports },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, querySelectorAll: () => [] },
  };
  ctx.window = ctx;
  runInNewContext(read("theme-boot.js"), ctx);
  return attrs["data-controls"] ?? null;
}

test("F345a: theme-boot.js sets data-controls exactly as native-controls.js would, before first paint", () => {
  for (const [what, env] of CASES) {
    if (env.nativeIos) continue; // app.info comes after first paint: native-controls.js corrects the boot's guess
    for (const style of ["ios6", "ios7", "ios13", "ios26"]) {
      assert.equal(boot({ style, ...env }), controlsFor({ style, ...env }), `${what}, ${style}`);
    }
  }
});

test("F345a: applyControls puts the hook on <html> and takes it off with the style", () => {
  const doc = fakeDocument();
  const root = doc.documentElement;
  root.removeAttribute = (k) => { delete root.attrs[k]; };
  const env = { userAgent: UA.safari26, supports: has26 };
  root.setAttribute("data-style", "ios26");
  assert.equal(applyControls(doc, env), true);
  assert.equal(root.getAttribute("data-controls"), "native");
  assert.equal(nativeControls(doc), true);
  assert.equal(applyControls(doc, env), false, "nothing changed");
  root.setAttribute("data-style", "ios13");
  assert.equal(applyControls(doc, env), true);
  assert.equal(root.getAttribute("data-controls"), null);
  assert.equal(nativeControls(doc), false);
  root.setAttribute("data-style", "ios26");
  assert.equal(applyControls(doc, { userAgent: UA.safari15, supports: none }), false, "the iPhone 7 keeps the look-alikes");
});

test("F345a: createSwitch draws WebKit's <input type=checkbox switch> under the hook, the button art without", () => withDocument((doc) => {
  const heard = [];
  const art = createSwitch({ label: "Art", checked: true, onToggle: (on) => heard.push(["art", on]) });
  assert.equal(art.tagName, "BUTTON");
  assert.ok(art.classList.contains("switch") && !art.classList.contains("is-native"));

  doc.documentElement.setAttribute("data-controls", "native");
  const sw = createSwitch({ label: "Native", checked: true, onToggle: (on) => heard.push(["native", on]) });
  assert.equal(sw.tagName, "INPUT");
  assert.equal(sw.type, "checkbox");
  assert.equal(sw.getAttribute("switch"), "", "WebKit's switch attribute");
  assert.ok(sw.classList.contains("switch") && sw.classList.contains("is-native"));
  assert.equal(sw.getAttribute("aria-label"), "Native");
  assert.equal(sw.checked, true);
  assert.equal(sw.getAttribute("aria-checked"), "true");
  // WebKit flips it and fires change: aria-checked follows, onToggle hears it
  sw.checked = false;
  sw.dispatchEvent({ type: "change" });
  assert.equal(sw.getAttribute("aria-checked"), "false");
  assert.deepEqual(heard, [["native", false]]);
  // a caller putting it back (Cancel on an alert) sets aria-checked: the box follows, onToggle stays quiet
  sw.setAttribute("aria-checked", "true");
  assert.equal(sw.checked, true);
  assert.deepEqual(heard, [["native", false]]);
}));

test("F345a: redrawSwitches swaps the switches on screen to the kind the hook now asks for, state and data kept", () => withDocument((doc) => {
  const heard = [];
  const sw = createSwitch({ label: "Keep Bundle ID", checked: true, onToggle: (on) => heard.push(on) });
  sw.dataset.key = "keepBundleId";
  doc.body.append(sw);
  doc.documentElement.setAttribute("data-controls", "native");
  redrawSwitches(doc);
  const now = doc.querySelector(".switch");
  assert.equal(now.tagName, "INPUT");
  assert.equal(now.checked, true);
  assert.equal(now.dataset.key, "keepBundleId");
  now.checked = false;
  now.dispatchEvent({ type: "change" });
  assert.deepEqual(heard, [false], "the same onToggle");
  doc.documentElement.setAttribute("data-controls", "");
  redrawSwitches(doc);
  const back = doc.querySelector(".switch");
  assert.equal(back.tagName, "BUTTON");
  assert.equal(back.getAttribute("aria-checked"), "false");
  redrawSwitches(doc);
  assert.equal(doc.querySelector(".switch"), back, "already the right kind: left alone");
}));

// The CSS swaps: each native rule sits under html[data-style="ios26"][data-controls="native"], hands the control to
// WebKit (appearance: auto) and sets no layout; the sizes the look-alikes use match WebKit's.
const ios26 = read("ios26.css");
const NATIVE = 'html[data-style="ios26"][data-controls="native"]';
const nativeRules = cssRules(ios26).filter(({ sel }) => sel.includes('[data-controls="native"]'));

test("F345a: ios26.css hands the search field, switch, cell fields, <select> and <progress> to WebKit, look only", () => {
  const ruleFor = (subject) => nativeRules.find(({ sel }) => sel.split(",").some((s) => s.trim().endsWith(subject)));
  for (const subject of [".switch.is-native", ".search-field input", 'input:not([type="checkbox"]):not([type="search"])', " select", " progress"]) {
    const r = ruleFor(subject);
    assert.ok(r, subject);
    assert.ok(r.props.includes("appearance"), `${subject}: appearance auto`);
  }
  for (const { sel } of nativeRules) for (const s of sel.split(",")) assert.ok(s.trim().startsWith(NATIVE), s);
  const src = nativeRules.map(({ sel }) => sel).join("\n");
  assert.deepEqual(layoutIn(ios26).filter((l) => l.includes("data-controls")), [], "no layout in the native rules");
  assert.doesNotMatch(src, /\.search-field::after/, "WebKit draws no clear button: the drawn one stays");
  // 17pt in the search field: UIKit's size, and 16pt or more keeps Safari from zooming on focus; no focus ring
  assert.match(ios26, /\.search-field input \{[^}]*font-size: 17px;[^}]*outline: none/);
  // WebKit's switch measured 70.84 x 31 on the 15 Pro: the hooks match it for both kinds
  assert.match(ios26, /--sw-w: 71px; --sw-h: 31px;/);
});

test("F345a: the search field's room for the drawn magnifier goes under the hook (packages.css)", () => {
  const pk = read("packages.css");
  assert.match(pk, /html\[data-controls="native"\] \.search-field \{ padding: 0; \}/);
  assert.match(pk, /html\[data-controls="native"\] \.search-field input \{ padding: revert; padding-right: 30px; \}/);
  assert.match(pk, /html\[data-controls="native"\] \.search-field::after \{ margin: 0 6px 0 -25px; \}/, "the clear inside the capsule");
});

test("F345a: the run page's bar is a <progress> under the hook (nav/progress.js)", () => {
  const src = read("nav/progress.js");
  assert.match(src, /data-controls"\) === "native"/);
  assert.match(src, /el\("progress", "progress-bar"\)/);
  assert.match(src, /if \(native\) track\.value = p;/);
});

test("F345a: docs/eras.md documents the hook and appearance as look", () => {
  const doc = readFileSync(new URL("../../docs/eras.md", import.meta.url), "utf8");
  assert.match(doc, /data-controls="native"/);
  assert.match(doc, /appearance/);
});
