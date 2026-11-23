// A modal sheet's bar (nav/sheet.js, packages.css .navbar.sheet-bar) shows no status-bar strip: style.css's
// .navbar::before (black in iOS 6, ios6.css --site-strip) is replaced, on a sheet's bar only, by a layer carrying the
// bar's own art up under the status bar, in every era and shell.
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

test("B349: a sheet's bar layer covers the status bar's room and its top half, with the bar's art", () => {
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
