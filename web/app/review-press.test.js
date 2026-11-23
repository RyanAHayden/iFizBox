// B345: the review buttons go down while held (app.js's .is-pressed, as the bar buttons) and wear each era's look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REVIEW = [".review-button", ".review-report", ".review-delete-own", ".review-tap-remove"];

test("every review button is pressable", () => {
  const list = /const PRESSABLE = "([^"]+)"/.exec(read("app.js"))[1].split(",").map((s) => s.trim());
  for (const cls of REVIEW) assert.ok(list.includes(cls), `${cls} missing from PRESSABLE`);
});

test("iOS 6 draws the held look for .is-pressed, light and dark", () => {
  const css = read("reviews.css");
  assert.match(css, /\n\.review-button:is\(:active, \.is-pressed\)/);
  assert.match(css, /html\[data-theme="dark"\] \.review-button:is\(:active, \.is-pressed\)/);
  for (const cls of [".review-report", ".review-tap-remove", ".review-delete-own"]) assert.ok(css.includes(`${cls}:is(`), cls);
});

test("every era restyles the review button and its held look", () => {
  for (const era of ["ios7", "ios13", "ios26"]) {
    const css = read(`${era}.css`);
    assert.ok(css.includes(`html[data-style="${era}"][data-theme] .review-button {`), era);
    assert.ok(css.includes(`html[data-style="${era}"][data-theme] .review-button:is(:active, .is-pressed)`), era);
    assert.ok(css.includes(`html[data-style="${era}"] :is(.review-report, .review-tap-remove, .review-delete-own):is(:active, .is-pressed)`), era);
  }
});
