// The one search bar (nav/searchbar.js): what it builds and does, and that every list screen builds its bar with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchBar, clearTap, pinned, scrollerOf } from "./searchbar.js";

import { fakeDocument as sharedDocument } from "./fakedom.test-helper.js";

// The shared fake document; its elements also track focus, and fire() runs the listeners at once and says whether
// one called preventDefault().
function fakeDocument() {
  const doc = sharedDocument();
  const make = doc.createElement;
  doc.createElement = (tag) => {
    const node = make(tag);
    node.focused = false;
    node.focus = () => { node.focused = true; };
    node.blur = () => { node.focused = false; };
    node.fire = (type, extra = {}) => {
      let prevented = false;
      node.dispatchEvent({ type, preventDefault: () => { prevented = true; }, ...extra });
      return prevented;
    };
    return node;
  };
  return doc;
}

test("C10: searchBar builds Search's bar with Cancel and the page's placeholder", () => {
  globalThis.document = fakeDocument();
  const seen = [];
  const bar = searchBar({ placeholder: "Search Sources", ariaLabel: "Search sources: name or URL", value: "big",
    className: "sources-search", onQuery: (q) => seen.push(q) });
  assert.equal(bar.tagName, "FORM");
  assert.equal(bar.className, "search-bar sources-search");
  assert.equal(bar.attrs.role, "search");
  const [field, cancel] = bar.children;
  assert.equal(field.className, "search-field");
  assert.equal(cancel.className, "search-cancel");
  assert.equal(cancel.textContent, "Cancel");
  assert.equal(cancel.type, "button", "Cancel never submits the form");
  const input = field.children[0];
  assert.equal(bar.input, input);
  assert.equal(input.type, "search");
  assert.equal(input.placeholder, "Search Sources");
  assert.equal(input.attrs["aria-label"], "Search sources: name or URL");
  assert.equal(input.value, "big");
  // pointerdown on Cancel keeps the focus (else the blur hides Cancel before the click lands)
  assert.equal(cancel.fire("pointerdown"), true);
  input.value = "bigb";
  input.fire("input");
  assert.deepEqual(seen, ["bigb"], "no delay: each keystroke at once");
  input.focus();
  cancel.fire("click");
  assert.equal(input.value, "", "Cancel empties the field");
  assert.equal(input.focused, false, "and puts the keyboard away");
  assert.deepEqual(seen, ["bigb", ""]);
});

test("C10: a delayed bar waits for the typing to stop; Search and Cancel run at once", async () => {
  globalThis.document = fakeDocument();
  const seen = [], saved = [];
  const bar = searchBar({ placeholder: "Search Changes", delay: 20, onQuery: (q) => seen.push(q), onSubmit: (q) => saved.push(q) });
  const input = bar.input;
  input.value = "a"; input.fire("input");
  input.value = "ab"; input.fire("input");
  assert.deepEqual(seen, []);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, ["ab"], "one query, the last text");
  input.value = "abc"; input.fire("input");
  input.focus();
  assert.equal(bar.fire("submit"), true, "Search never reloads the page");
  assert.deepEqual(seen, ["ab", "abc"]);
  assert.deepEqual(saved, ["abc"]);
  assert.equal(input.focused, false);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, ["ab", "abc"], "the pending keystroke was dropped by Search");
  input.value = "x"; input.fire("input");
  bar.set("recent");
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, ["ab", "abc"], "set() drops a pending query");
  assert.equal(input.value, "recent");
});

test("C10: pinned puts the bar and scope over a scroller of their own", () => {
  globalThis.document = fakeDocument();
  const body = document.createElement("div");
  body.className = "page-body plain";
  const bar = searchBar({ placeholder: "Search Apps" });
  const scope = document.createElement("div");
  const results = pinned(body, bar, null, scope);
  assert.ok(body.classList.contains("search-root"));
  assert.deepEqual(body.children, [bar, scope, results]);
  assert.equal(results.className, "search-results");
  assert.ok(results.hasAttribute("data-scroller"), "the iOS 6 indicator follows it");
  assert.equal(scrollerOf(body), results, "the tab bar's second tap scrolls the results");
  const other = document.createElement("div");
  other.className = "page-body";
  assert.equal(scrollerOf(other), other);
});

test("B430: a tap on the x, on the label or the input under it, empties the field; on the text it does nothing", () => {
  globalThis.document = fakeDocument();
  const seen = [];
  const bar = searchBar({ onQuery: (q) => seen.push(q) });
  const [field] = bar.children, input = bar.input;
  field.getBoundingClientRect = () => ({ left: 5, right: 305 });
  const tap = (target, clientX) => {
    let prevented = false;
    clearTap({ target, clientX, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  for (const target of [field, input]) {
    seen.length = 0;
    input.value = "big";
    input.blur();
    assert.equal(tap(target, 272), false, "left of the x: the caret's");
    assert.equal(input.value, "big");
    assert.deepEqual(seen, []);
    assert.equal(tap(target, 290), true);
    assert.equal(input.value, "");
    assert.deepEqual(seen, [""], "the results reset");
    assert.equal(input.focused, true, "the keyboard stays up");
    assert.equal(tap(target, 290), false, "empty: no x to tap");
  }
  assert.equal(tap(bar.cancel, 320), false, "outside the field");
});

test("B430: app.js clears on a captured click", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(src, /document\.addEventListener\("click", clearTap, true\);/);
});

// Every list screen builds its bar through searchBar and pins it; none draws a field of its own.
const SCREENS = {
  "search.js": ["searchPlaceholder()"],
  "sources.js": ['"Search Sources"'],
  "changes.js": ['"Search Changes"'],
  "installed.js": ['"Search Tweaks"', '"Search Apps"'],
  "myipas.js": ['"Search Apps"'],
};
test("C10: Search, Sources, Changes, Installed and My IPAs all use the shared bar, pinned", () => {
  for (const [file, placeholders] of Object.entries(SCREENS)) {
    const src = readFileSync(new URL(`../screens/${file}`, import.meta.url), "utf8");
    assert.match(src, /import \{[^}]*\bsearchBar\b[^}]*\bpinned\b[^}]*\} from "\.\.\/nav\/searchbar\.js";/, `${file} imports searchBar and pinned`);
    assert.match(src, /\bsearchBar\(\{/, `${file} calls searchBar`);
    assert.match(src, /\bpinned\(/, `${file} pins its bar`);
    assert.doesNotMatch(src, /["']search-field["']/, `${file} builds no search field of its own`);
    assert.doesNotMatch(src, /["']search-cancel["']/, `${file} builds no Cancel of its own`);
    assert.doesNotMatch(src, /^function searchBar\b/m, `${file} has no local searchBar`);
    for (const p of placeholders) assert.ok(src.includes(`placeholder: ${p}`) || src.includes(`placeholder: types ? "Search Tweaks" : "Search Apps"`), `${file}: ${p}`);
  }
});

test("C10: the Search tab says Tweaks in the jailbreak app, Apps elsewhere", async () => {
  delete globalThis.document; // the screens' modules style the page on import when there's a document
  const { searchPlaceholder } = await import("../screens/search.js");
  assert.equal(searchPlaceholder("jailbreak"), "Search Tweaks");
  assert.equal(searchPlaceholder("sideload"), "Search Apps");
  assert.equal(searchPlaceholder("site"), "Search Apps");
});
