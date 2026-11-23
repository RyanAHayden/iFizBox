// A modal sheet's bar (nav/sheet.js, packages.css .navbar.sheet-bar) carries no status-bar strip. iOS 6: the sheet is
// clipped to below the page's still, black strip. iOS 7, 13, 26: style.css's .navbar::before is replaced, on a
// sheet's bar only, by a layer carrying the bar's own art up under the status bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A look-only stretch, as ios6-css.test.js reads them (not imported: that would run its tests here too).
const STRETCH = /\/\* ==== look-only \{ ====[\s\S]*?\*\/([\s\S]*?)\/\* ==== \} look-only ==== \*\//g;
const stretchesOf = (src) => [...src.matchAll(STRETCH)].map((m) => m[1]);

const strip = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const packages = readFileSync(new URL("./packages.css", import.meta.url), "utf8");
const SEL = ":root .sheet > .navbar.sheet-bar::before";
const rulesOf = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));

// Specificity as (ids, classes/attributes/pseudo-classes, elements/pseudo-elements), enough for these selectors.
function spec(sel) {
  let s = sel.replace(/::[\w-]+/g, () => " ~E~ ");
  let b = 0, c = 0;
  s = s.replace(/:is\(([^)]*)\)/g, (_, inner) => { c += 1; return " "; }); // one attribute in each :is() here
  s = s.replace(/:not\(([^)]*)\)/g, () => { c += 1; return " "; });
  c += (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  s = s.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, " ");
  b += (s.match(/~E~/g) ?? []).length;
  b += (s.replace(/~E~/g, " ").match(/[a-z][\w-]*/gi) ?? []).length;
  return c * 100 + b;
}

test("B349: iOS 7, 13 and 26: a sheet's bar layer covers the status bar's room and its top half, with the bar's art", () => {
  const all = rulesOf(packages).filter((r) => r.sel === SEL);
  assert.ok(all.some((r) => /height:\s*calc\(var\(--sheet-bar-top\) \+ 22px\)/.test(r.decl)), "height: the room plus 22 pt");
  const look = stretchesOf(packages).flatMap(rulesOf).filter((r) => r.sel === SEL);
  assert.equal(look.length, 1, "its paint sits in a look-only stretch");
  assert.match(look[0].decl, /background:\s*inherit;/);
  assert.match(look[0].decl, /background-position:\s*0 0, top, top, 0 0;/);
  assert.match(look[0].decl, /background-size:\s*0 0, 100% 1px, 100% 200%, 0 0;/);
});

test("B349: the sheet's layer outranks every other .navbar::before rule, so no strip colour reaches it", () => {
  const mine = spec(SEL);
  for (const f of ["./style.css", "./ios6.css", "./ios7.css", "./ios13.css", "./ios26.css", "./palettes.css"]) {
    for (const r of rulesOf(strip(f))) for (const s of r.sel.split(/,(?![^(]*\))/).map((x) => x.trim())) {
      if (!/\.navbar::before$/.test(s)) continue;
      assert.ok(spec(s) < mine, `${f}: ${s} (${spec(s)}) would beat ${SEL} (${mine})`);
    }
  }
});

// F397: in iOS 6 every sheet, the console too, is clipped to below the page's own black strip, and its bar has no layer
// of its own: the strip stays still while the sheet slides under it.
const IOS6 = 'html:not([data-style="ios7"]):not([data-style="ios13"]):not([data-style="ios26"])';
const IOS6_LAYER = `${IOS6} .sheet > .navbar.sheet-bar::before`;

test("F397: iOS 6 clips a sheet to below the status-bar strip; no other era does", () => {
  const clips = rulesOf(packages).filter((r) => /clip-path/.test(r.decl) && /\.sheet$/.test(r.sel));
  assert.deepEqual(clips.map((r) => r.sel), [`${IOS6} .sheet`]);
  assert.match(clips[0].decl, /clip-path:\s*inset\(var\(--sheet-bar-top\) 0 0 0\);/);
  assert.match(strip("./ios6.css"), /--site-strip:\s*#000;/, "the page's strip under it is black in iOS 6");
});

test("F397: an iOS 6 sheet's bar draws no strip or gloss layer, and no stylesheet gives one back", () => {
  const off = rulesOf(packages).filter((r) => r.sel === IOS6_LAYER);
  assert.equal(off.length, 1);
  assert.match(off[0].decl, /display:\s*none;/);
  assert.ok(spec(IOS6_LAYER) > spec(SEL));
  for (const f of ["./queue.css", "./packages.css", "./progress.css", "./reviews.css", "./ios6.css", "./palettes.css"]) {
    for (const r of rulesOf(strip(f))) for (const s of r.sel.split(/,(?![^(]*\))/).map((x) => x.trim())) {
      if (!/\.sheet-bar::before$/.test(s) || s === SEL || s === IOS6_LAYER) continue;
      assert.fail(`${f}: ${s} also reaches a sheet's bar layer`);
    }
  }
});
