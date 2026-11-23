// The Share button (nav/sharesheet.js setShare in the nav bar, screens/handoff.js shareHeadButton on an app or tweak
// page's header) draws its own era's glyph in iOS 7, iOS 13 and iOS 26, never iOS 6's white embossed action art:
// each era's sheet has a .bar-button.share-button::before rule that drops the iOS 6 glyph and its emboss and paints
// the era's tint through a mask (ios6.css draws the glyph as a background image).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const ERAS = { ios7: "--i7-tint", ios13: "--i13-tint", ios26: "--i26-label" };

function ruleFor(css, sel) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).includes(sel)) return m[2];
  }
  return null;
}

for (const [era, colour] of Object.entries(ERAS)) {
  test(`${era} draws its own Share glyph, not iOS 6's`, () => {
    const body = ruleFor(read(`${era}.css`), `html[data-style="${era}"] .bar-button.share-button::before`);
    assert.ok(body, `${era}.css has no Share button glyph rule`);
    assert.match(body, /background-image:\s*none/, "the iOS 6 glyph (a background image) stays");
    assert.match(body, /filter:\s*none/, "the iOS 6 emboss stays");
    assert.match(body, /(^|[;\s])mask:\s*url\(/, "no unprefixed mask");
    assert.match(body, /-webkit-mask:\s*url\(/, "no -webkit-mask (older iOS WebKit)");
    assert.ok(body.includes(`background-color: var(${colour})`), `the glyph isn't painted in ${colour}`);
  });
}

test("both Share buttons are the bar button the era rules target", () => {
  assert.match(read("nav/sharesheet.js"), /"bar-button bar-icon share-button"/);
  assert.match(read("screens/handoff.js"), /"bar-button bar-icon share-button store-head-share"/);
});
