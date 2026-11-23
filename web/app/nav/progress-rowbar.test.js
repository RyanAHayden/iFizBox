// B324: a rows page's bar (nav/progress.js rowBar): WebKit's <progress> under the native controls hook (iOS 26's
// UIProgressView), the drawn track and fill everywhere else; ios26.css paints both in the era's look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rowBar } from "./progress.js";

function fakeDoc(controls) {
  const make = (tag) => {
    const e = {
      tagName: tag.toUpperCase(), children: [], style: {}, attrs: {}, className: "",
      classList: { toggle(c, on) { const s = new Set(e.className.split(" ").filter(Boolean)); if (on) s.add(c); else s.delete(c); e.className = [...s].join(" "); } },
      append(...c) { e.children.push(...c); },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      removeAttribute(k) { delete e.attrs[k]; e.value = undefined; },
    };
    return e;
  };
  const doc = { createElement: make, documentElement: { getAttribute: (k) => (k === "data-controls" ? controls : null) } };
  globalThis.document = doc;
  return doc;
}

test("B324: under the native controls hook a row's bar is a <progress>, no value while it sweeps", () => {
  const doc = fakeDoc("native");
  const { bar, set } = rowBar(doc);
  assert.equal(bar.className, "qr-native");
  const [progress, wait] = bar.children;
  assert.equal(progress.tagName, "PROGRESS");
  assert.equal(progress.className, "qr-progress");
  assert.equal(wait.className, "qr-wait");
  assert.equal(progress.max, 1);
  set(0.35, false);
  assert.equal(progress.value, 0.35);
  set(1.7, false);
  assert.equal(progress.value, 1, "never past the end");
  set(0, true);
  assert.equal(progress.value, undefined, "indeterminate: WebKit's own sweep");
});

test("B324: without the hook it is the drawn track and fill, scaled (120 Hz), sweeping while indeterminate", () => {
  const doc = fakeDoc(null);
  const { bar, set } = rowBar(doc);
  assert.equal(bar.tagName, "DIV");
  assert.equal(bar.className, "qr-bar");
  const [fill] = bar.children;
  assert.equal(fill.className, "qr-fill");
  set(0.5, false);
  assert.equal(fill.style.transform, "scaleX(0.5)");
  assert.doesNotMatch(bar.className, /is-indeterminate/);
  set(1, true);
  assert.match(bar.className, /is-indeterminate/);
  assert.equal(fill.style.transform, "scaleX(1)");
});

test("F391: a signed app waiting its turn covers either bar with the stripes, and takes them off again", () => {
  for (const controls of ["native", null]) {
    const { bar, set } = rowBar(fakeDoc(controls));
    assert.equal(bar.children[1].className, "qr-wait");
    set(0.5, false, true);
    assert.match(bar.className, /is-waiting/);
    set(0.5, false);
    assert.doesNotMatch(bar.className, /is-waiting/);
  }
});

test("B324: the rows pages build their bars through rowBar, and ios26.css draws the Running page's parts", () => {
  for (const f of ["../screens/apprun.js", "../screens/queuerun.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /rowBar\(\)/, f);
    assert.doesNotMatch(src, /el\("div", "qr-fill"\)/, `${f}: the bar comes from rowBar`);
  }
  const css = readFileSync(new URL("../ios26.css", import.meta.url), "utf8");
  for (const part of [".progress-seg-item.selected", ".qr-bar", ".qr-stop", ".progress-finish", ".progress-status", "--console-btn", "--progress-track", "--qr-fill"]) {
    assert.ok(css.includes(part), `ios26.css draws ${part}`);
  }
});
