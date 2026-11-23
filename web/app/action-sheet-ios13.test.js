// B376: iOS 13's bottom action sheet (and iOS 26's, when no source button opens it) is UIAlertController's: one
// 13pt block of choices split by .5pt hairlines, 8pt from the sides and bottom, Cancel in its own box 8pt under it.
// Each era sets the geometry hooks ios7.css sets; iOS 26 scopes them away from its anchored menu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const HOOKS = ["--action-sheet-pad: 8px 8px", "--action-sheet-pad-bottom: 8px", "--action-gap: 8px", "--action-list-gap: 0px",
  "--action-list-bleed: 0px", "--action-title-margin: 0 0 -8px", "--action-title-pad: 14px 16px", "--action-cancel-gap: 0px"];

for (const [era, file, scope, line] of [
  ["ios13", "ios13.css", "", "--i13-alert-line"],
  ["ios26", "ios26.css", " .action-sheet:not(.action-menu)", "--i26-alert-line"],
]) {
  test(`B376: ${era}'s bottom action sheet is one 13pt group with hairlines, Cancel apart`, () => {
    const src = css(file);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sel = esc(`html[data-style="${era}"]${scope}`);
    const block = [...src.matchAll(new RegExp(`\\n${sel} \\{([^}]*)\\}`, "g"))].find((m) => m[1].includes("--action-sheet-pad"));
    assert.ok(block, `${file}: a rule on ${era}'s sheet sets the hooks`);
    for (const v of HOOKS) assert.ok(block[1].includes(v), `${file} ${v}`);
    assert.match(src, new RegExp(`${sel} \\.action-list \\{ border-radius: 13px; \\}`));
    assert.match(src, new RegExp(`${sel} \\.action-list > \\.action-button \\{ border-width: 0; border-radius: 0; \\}`));
    assert.match(src, new RegExp(`${sel} \\.action-list > \\.action-button \\+ \\.action-button,\\s*${sel} \\.action-title \\+ \\.action-list > \\.action-button:first-child \\{ box-shadow: inset 0 \\.5px 0 var\\(${line}\\); \\}`));
    assert.match(src, new RegExp(`${sel} \\.action-title \\{ background: var\\(--i\\d+-action-cell\\); border-radius: 13px 13px 0 0; \\}`));
  });
}

test("B376: iOS 26's anchored menu keeps its own geometry", () => {
  const src = css("ios26.css");
  // no bare ios26 rule sets the sheet hooks: they would reach the menu too
  assert.doesNotMatch(src, /\nhtml\[data-style="ios26"\] \{[^}]*--action-(sheet-pad|gap|list-gap|title-margin|cancel-gap):/);
});
