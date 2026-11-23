import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { nativeControls } from "./native-controls.js";
import { createSettings, ios26Offered, setPhoneIos, ios26Here, themeState } from "./core/settings.js";
import { createSwitch, redrawSwitches } from "./nav/switch.js";
import { fakeDocument, withDocument } from "./nav/fakedom.test-helper.js";
import { cssRules, layoutIn } from "./ios6-css.test.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// C70: the iOS 26 style is offered only on a phone running iOS 26 or later; there, data-style="ios26" is the hook.
const UA = {
  appWebView27: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  appWebView15: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  chrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

test("C70: ios26Offered is true from iOS 26 up", () => {
  for (const v of ["26.0", "27.1", 26, "30"]) assert.equal(ios26Offered(v), true, String(v));
  for (const v of ["15.8.8", "18.1", "25.9", "", null, undefined]) assert.equal(ios26Offered(v), false, String(v));
});

test("C70: Style does not offer iOS 26 below iOS 26, and a stored ios26 draws iOS 6", () => {
  const mem = new Map([["ifizbox.style", "ios26"]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const s = createSettings({ storage, mode: "sideload" });
  setPhoneIos("18.1");
  assert.equal(ios26Here(), false);
  assert.equal(s.get("style"), "ios6");
  assert.deepEqual(s.optionsOf("style").map((o) => o.value), ["ios6", "ios7", "ios13"]);
  assert.equal(themeState({ style: "ios26" }, false).style, "ios6");
  assert.equal(mem.get("ifizbox.style"), "ios26", "still stored: it comes back on an iOS 26 phone");
  const heard = [];
  s.onChange((k) => heard.push(k));
  setPhoneIos("26.0");
  assert.deepEqual(heard, ["style"], "the shell's answer re-reads the style");
  assert.equal(s.get("style"), "ios26");
  assert.deepEqual(s.optionsOf("style").map((o) => o.value), ["ios6", "ios7", "ios13", "ios26"]);
  assert.equal(themeState({ style: "ios26" }, false).style, "ios26");
  setPhoneIos("15.8.8");
});

// theme-boot.js before first paint guesses with CSS anchor positioning (WebKit 26's), on an iPhone or iPad.
function boot({ style, userAgent, supports, native = true }) {
  const attrs = {};
  const store = { "ifizbox.style": style };
  const ctx = {
    ...(native ? { ifizboxNative: {} } : {}), // an era is the apps' only
    location: { hash: "" },
    localStorage: { getItem: (k) => store[k] ?? null },
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent },
    CSS: { supports },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, querySelectorAll: () => [] },
  };
  ctx.window = ctx;
  runInNewContext(read("theme-boot.js"), ctx);
  return attrs;
}

test("C70: theme-boot.js draws iOS 26 only where WebKit 26's anchor positioning is, else iOS 6", () => {
  const has = () => true, none = () => false;
  assert.equal(boot({ style: "ios26", userAgent: UA.appWebView27, supports: has })["data-style"], "ios26");
  assert.equal(boot({ style: "ios26", userAgent: UA.appWebView27, supports: has })["data-tabbar"], "float");
  assert.equal(boot({ style: "ios26", userAgent: UA.appWebView15, supports: none })["data-style"], "ios6");
  assert.equal(boot({ style: "ios26", userAgent: UA.chrome, supports: has })["data-style"], "ios6");
  assert.equal(boot({ style: "ios26", userAgent: UA.appWebView27, supports: has, native: false })["data-style"], "ios6", "the website");
  assert.equal(boot({ style: "ios13", userAgent: UA.appWebView15, supports: none })["data-style"], "ios13");
  assert.equal(boot({ style: "ios26", userAgent: UA.appWebView27, supports: has })["data-controls"], undefined, "no separate hook");
});

test("C70: nativeControls follows data-style", () => {
  const doc = fakeDocument();
  doc.documentElement.setAttribute("data-style", "ios26");
  assert.equal(nativeControls(doc), true);
  doc.documentElement.setAttribute("data-style", "ios13");
  assert.equal(nativeControls(doc), false);
});

test("F345a: createSwitch draws WebKit's <input type=checkbox switch> under iOS 26, the button art without", () => withDocument((doc) => {
  const heard = [];
  const art = createSwitch({ label: "Art", checked: true, onToggle: (on) => heard.push(["art", on]) });
  assert.equal(art.tagName, "BUTTON");
  assert.ok(art.classList.contains("switch") && !art.classList.contains("is-native"));

  doc.documentElement.setAttribute("data-style", "ios26");
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
  doc.documentElement.setAttribute("data-style", "ios26");
  redrawSwitches(doc);
  const now = doc.querySelector(".switch");
  assert.equal(now.tagName, "INPUT");
  assert.equal(now.checked, true);
  assert.equal(now.dataset.key, "keepBundleId");
  now.checked = false;
  now.dispatchEvent({ type: "change" });
  assert.deepEqual(heard, [false], "the same onToggle");
  doc.documentElement.setAttribute("data-style", "ios6");
  redrawSwitches(doc);
  const back = doc.querySelector(".switch");
  assert.equal(back.tagName, "BUTTON");
  assert.equal(back.getAttribute("aria-checked"), "false");
  redrawSwitches(doc);
  assert.equal(doc.querySelector(".switch"), back, "already the right kind: left alone");
}));

// The CSS swaps: each native rule sits under html[data-style="ios26"][data-tabbar="float"], hands the control to
// WebKit (appearance: auto) and sets no layout; the sizes the look-alikes use match WebKit's.
const ios26 = read("ios26.css");
const NATIVE = 'html[data-style="ios26"][data-tabbar="float"]';
const nativeRules = cssRules(ios26).filter(({ sel }) => sel.includes(NATIVE));

test("F345a: ios26.css hands the search field, switch, cell fields, <select> and <progress> to WebKit, look only", () => {
  const ruleFor = (subject) => nativeRules.find(({ sel }) => sel.split(",").some((s) => s.trim().endsWith(subject)));
  for (const subject of [".switch.is-native", ".search-field input", 'input:not([type="checkbox"]):not([type="search"])', " select", " progress"]) {
    const r = ruleFor(subject);
    assert.ok(r, subject);
    assert.ok(r.props.includes("appearance"), `${subject}: appearance auto`);
  }
  for (const { sel } of nativeRules) for (const s of sel.split(",")) assert.ok(s.trim().startsWith(NATIVE), s);
  const src = nativeRules.map(({ sel }) => sel).join("\n");
  assert.deepEqual(layoutIn(ios26).filter((l) => l.includes(NATIVE)), [], "no layout in the native rules");
  assert.doesNotMatch(src, /\.search-field::after/, "WebKit draws no clear button: the drawn one stays");
  // 17pt in the search field: UIKit's size, and 16pt or more keeps Safari from zooming on focus; no focus ring
  assert.match(ios26, /\.search-field input \{[^}]*font-size: 17px;[^}]*outline: none/);
  // WebKit's switch measured 70.84 x 31 on the 15 Pro: the hooks match it for both kinds
  assert.match(ios26, /--sw-w: 71px; --sw-h: 31px;/);
});

test("F345a: the search field's room for the drawn magnifier goes under iOS 26 (packages.css)", () => {
  const pk = read("packages.css");
  assert.match(pk, /html\[data-style="ios26"\] \.search-field \{ padding: 0; \}/);
  assert.match(pk, /html\[data-style="ios26"\] \.search-field input \{ padding: revert; padding-right: 30px; \}/);
  assert.match(pk, /html\[data-style="ios26"\] \.search-field::after \{ margin: 0 6px 0 -25px; \}/, "the clear inside the capsule");
});

test("F345a: the run page's bar is a <progress> under iOS 26 (nav/progress.js)", () => {
  const src = read("nav/progress.js");
  assert.match(src, /data-style"\) === "ios26"/);
  assert.match(src, /el\("progress", "progress-bar"\)/);
  assert.match(src, /if \(native\) track\.value = p;/);
});

test("F345a: docs/eras.md documents the iOS 26 offer and appearance as look", () => {
  const doc = readFileSync(new URL("../../docs/eras.md", import.meta.url), "utf8");
  assert.match(doc, /ios26Here/);
  assert.match(doc, /appearance/);
});
