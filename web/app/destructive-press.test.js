// B350: the action sheet's buttons go down while held (app.js's .is-pressed), the red one included, in every era.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

test("action sheet buttons are pressable", () => {
  const list = /const PRESSABLE = "([^"]+)"/.exec(read("app.js"))[1].split(",").map((s) => s.trim());
  assert.ok(list.includes(".action-button"));
});

test("the red button has a held look after its resting one, for :active and .is-pressed", () => {
  const css = read("packages.css");
  const rest = css.indexOf(".action-button.destructive {");
  const held = css.indexOf(".action-button.destructive:active, .action-button.destructive.is-pressed {");
  assert.ok(rest > 0 && held > rest, "held rule must come after the resting one");
  assert.match(css.slice(held, held + 200), /background: var\(--action-destructive-pressed\)/);
  assert.match(css, /--action-destructive-pressed: linear-gradient\(#cf848a/); // UIAlertSheetDefaultDestroyButtonPressed
  assert.match(css, /\.action-button:active, \.action-button\.is-pressed \{/);
  assert.match(css, /\.action-button:not\(\.cancel\):not\(\.destructive\):not\(:active\):not\(\.is-pressed\)/);
});

test("every era sets the red button's held fill and keeps its dark rest rule off a held button", () => {
  for (const era of ["ios7", "ios13", "ios26"]) {
    const css = read(`${era}.css`);
    assert.equal((css.match(/--action-destructive-pressed:/g) || []).length >= 2, true, `${era}: light and dark`);
    assert.ok(css.includes(`html[data-style="${era}"][data-theme="dark"] .action-button.destructive:not(:active):not(.is-pressed) {`), era);
  }
});
