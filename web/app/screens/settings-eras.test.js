// C69: the eras (iOS 7, iOS 13, iOS 26) are the two apps' only. These tests run as the jailbreak app: the bridge is
// there before any module makes the settings store (the website, with none, is iOS 6 whatever is stored: settings.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../fakes.test-helper.js";

globalThis.ifizboxNative = { mode: "jailbreak" };
const { applyTheme, settings } = await import("./settings.js");
(await import("../core/settings.js")).setPhoneIos("26.0"); // C70: the iOS 26 style needs an iOS 26 phone
const settingsDoc = () => Object.assign(fakeDocument(), { head: null });
const fakeElement = (tag) => settingsDoc().createElement(tag);
globalThis.document = settingsDoc();
const bridgeWin = () => { const sent = [];
  return { sent, win: { matchMedia: () => ({ matches: true }),
    webkit: { messageHandlers: { ifizbox: { postMessage: (m) => { sent.push(m); return Promise.resolve(null); } } } } } }; };

test("applyTheme in the app: each era's launch set goes to the shell", () => {
  const { sent, win } = bridgeWin();
  const doc = { documentElement: { dataset: {} }, querySelectorAll: () => [] };
  settings.set("lightTheme", "classic");
  settings.set("appearance", "dark");
  // B221: iOS 7 sends its White for the light launch ground, and dark status-bar text on White's bar
  // B231: and its OLED Black for the dark one, whatever the iOS 6 dark pick (Gunmetal here)
  settings.set("style", "ios7");
  settings.set("appearance", "light");
  applyTheme(doc, win);
  // B235: iOS 7's OLED Black opens on its own launch set (oled7: flat bars), the page still data-palette "oled"
  assert.deepEqual(sent.at(-1).params, { style: "light", theme: "light", darkPalette: "oled7", lightPalette: "white", statusBar: "dark" });
  settings.set("appearance", "dark");
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "dark", theme: "dark", darkPalette: "oled7", lightPalette: "white" });
  assert.equal(doc.documentElement.dataset.palette, "oled");
  settings.set("style", "ios13"); // B235: iOS 13's, its #38383a hairline; B237: and its White (white13: #f2f2f7)
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "dark", theme: "dark", darkPalette: "oled13", lightPalette: "white13" });
  settings.set("style", "ios6");
  applyTheme(doc, win); // back in iOS 6, the pick again
  assert.deepEqual(sent.at(-1).params, { style: "dark", theme: "dark", darkPalette: "gunmetal", lightPalette: "classic" });
  settings.set("appearance", "auto");
});

// F201: Theme > Style: iOS 6 checked by default; picking iOS 7 checks it, hides iOS 6's Themes rows and puts
// data-style="ios7" on <html> with its own two themes.
test("F201: Theme > Style picks iOS 7, which hides the Themes rows and sets data-style", async () => {
  const { render, settings, applyTheme } = await import("./settings.js");
  const labels = (root) => {
    const out = [];
    const walk = (n) => { for (const c of n.children ?? []) { if (c.className === "cell-label") out.push(c.textContent); walk(c); } };
    walk(root);
    return out;
  };
  const was = [settings.get("style"), settings.get("appearance")];
  try {
    assert.equal(settings.defaultOf("style"), "ios6");
    settings.set("style", "ios7");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    assert.deepEqual(labels(root).slice(0, 2), ["iOS 6", "iOS 7"]);
    // (the one Light and Dark left are the app icon rows': iOS 6's Themes rows are gone)
    assert.equal(labels(root).filter((l) => l === "Light").length, 1);
    assert.equal(labels(root).filter((l) => l === "Dark").length, 1);
    const html = { dataset: {} };
    const doc = { documentElement: html, querySelectorAll: () => [] };
    settings.set("appearance", "light");
    applyTheme(doc, { matchMedia: () => ({ matches: false }), location: { hash: "" } });
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios7", "light", "white"]);
    settings.set("appearance", "dark");
    applyTheme(doc, { matchMedia: () => ({ matches: false }), location: { hash: "" } });
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios7", "dark", "oled"]);
    settings.set("style", "ios6");
    applyTheme(doc, { matchMedia: () => ({ matches: false }), location: { hash: "" } });
    assert.equal(html.dataset.style, "ios6");
  } finally { settings.set("style", was[0]); settings.set("appearance", was[1]); }
});

// F202: iOS 13 is the third Style: its own White / OLED Black like iOS 7, plus its two nav hooks, card sheets
// (<html data-sheet="card">) and large titles (<html data-nav="large">, nav/navbar.js), both gone again in iOS 6.
test("F202: Theme > Style picks iOS 13: data-style, its two themes, card sheets and large titles", async () => {
  // an import glued onto a comment line drops its names silently (showAlert once did)
  const src = await (await import("node:fs/promises")).readFile(new URL("./settings.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\/\/[^\n]*\bimport \{[^\n]*\} from "/);
  const { render, settings, applyTheme } = await import("./settings.js");
  const was = [settings.get("style"), settings.get("appearance")];
  const attrs = {};
  const html = { dataset: {}, getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
  const doc = { documentElement: html, querySelectorAll: () => [], getElementById: () => null };
  const win = { matchMedia: () => ({ matches: false }), location: { hash: "" } };
  try {
    settings.set("style", "ios13");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    const labels = [];
    const walk = (n) => { for (const c of n.children ?? []) { if (c.className === "cell-label") labels.push(c.textContent); walk(c); } };
    walk(root);
    assert.deepEqual(labels.slice(0, 3), ["iOS 6", "iOS 7", "iOS 13"]);
    assert.equal(labels.filter((l) => l === "Light").length, 1); // iOS 6's Themes rows hide (the app icon's stay), as under iOS 7
    settings.set("appearance", "light");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios13", "light", "white"]);
    assert.equal(attrs["data-sheet"], "card");
    const { applyStyleHooks } = await import("./settings.js");
    await applyStyleHooks("ios13", doc);
    assert.equal(attrs["data-nav"], "large");
    settings.set("appearance", "dark");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios13", "dark", "oled"]);
    settings.set("style", "ios6");
    applyTheme(doc, win);
    await applyStyleHooks("ios6", doc);
    assert.equal(html.dataset.style, "ios6");
    assert.equal(attrs["data-sheet"], undefined);
    assert.equal(attrs["data-nav"], undefined);
  } finally {
    settings.set("style", was[0]); settings.set("appearance", was[1]);
    (await import("../nav/navbar.js")).setLargeTitles(false, doc);
  }
});

// F203: iOS 26 is the fourth Style: its own White / OLED Black, card sheets, large titles and the floating tab bar
// (<html data-tabbar="float">, nav/tabbar.js setFloatingTabbar), all three gone again in iOS 6 and iOS 13 drops
// only the tab bar.
test("F203: Theme > Style picks iOS 26: data-style, its two themes, card sheets, large titles, floating tab bar", async () => {
  const { render, settings, applyTheme, applyStyleHooks } = await import("./settings.js");
  const was = [settings.get("style"), settings.get("appearance")];
  const attrs = {};
  const html = { dataset: {}, getAttribute: (k) => attrs[k] ?? null,
    setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
  const doc = { documentElement: html, querySelectorAll: () => [], getElementById: () => null };
  const win = { matchMedia: () => ({ matches: false }), location: { hash: "" } };
  try {
    settings.set("style", "ios26");
    const root = fakeElement("div");
    render(root, { tab: "home", path: ["theme"] });
    const labels = [];
    const walk = (n) => { for (const c of n.children ?? []) { if (c.className === "cell-label") labels.push(c.textContent); walk(c); } };
    walk(root);
    assert.deepEqual(labels.slice(0, 4), ["iOS 6", "iOS 7", "iOS 13", "iOS 26"]);
    assert.equal(labels.filter((l) => l === "Light").length, 1); // iOS 6's Themes rows hide, as under iOS 7 and iOS 13
    settings.set("appearance", "light");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios26", "light", "white"]);
    assert.equal(attrs["data-sheet"], "card");
    assert.equal(attrs["data-tabbar"], "float");
    await applyStyleHooks("ios26", doc);
    assert.equal(attrs["data-nav"], "large");
    settings.set("appearance", "dark");
    applyTheme(doc, win);
    assert.deepEqual([html.dataset.style, html.dataset.theme, html.dataset.palette], ["ios26", "dark", "oled"]);
    settings.set("style", "ios13");
    applyTheme(doc, win);
    await applyStyleHooks("ios13", doc);
    assert.deepEqual([attrs["data-sheet"], attrs["data-nav"], attrs["data-tabbar"]], ["card", "large", undefined]);
    settings.set("style", "ios6");
    applyTheme(doc, win);
    await applyStyleHooks("ios6", doc);
    assert.deepEqual([attrs["data-sheet"], attrs["data-nav"], attrs["data-tabbar"]], [undefined, undefined, undefined]);
  } finally {
    settings.set("style", was[0]); settings.set("appearance", was[1]);
    (await import("../nav/navbar.js")).setLargeTitles(false, doc);
  }
});

