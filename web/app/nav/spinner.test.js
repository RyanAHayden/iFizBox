// F166: the spinners turn in the app (no steps() timing, no native-only rule stopping them) and are drawn from the
// 4S's UIActivityIndicatorView frames.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ERA_SPINNERS, SPINNERS, spinnerSVG, spinnerURL } from "./spinner.js";

const dir = new URL("../", import.meta.url);
const sheets = readdirSync(dir).filter((f) => f.endsWith(".css"))
  .map((f) => ({ f, css: readFileSync(new URL(f, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));

// Flat list of { sel, body, at } for every rule, @media blocks unwrapped (at = the @media prelude or "").
function rules(css) {
  const out = [];
  let i = 0;
  const walk = (end, at) => {
    while (i < end) {
      const open = css.indexOf("{", i);
      if (open < 0 || open >= end) { i = end; return; }
      const sel = css.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (depth && j < css.length) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
      if (sel.startsWith("@media") || sel.startsWith("@supports")) { i = open + 1; walk(j - 1, sel); i = j; continue; }
      out.push({ sel, body: css.slice(open + 1, j - 1), at });
      i = j;
    }
  };
  walk(css.length, "");
  return out;
}
const all = sheets.flatMap(({ f, css }) => rules(css).map((r) => ({ ...r, f })));
const SPINNER_SEL = /hud-spinner|reload-spinner|loading-spinner|is-reloading|badge\.spinning|source-row\.is-loading/;

test("every spinner animation runs hud-spin at 0.96 s with linear timing, never steps()", () => {
  const users = all.filter((r) => /animation:\s*hud-spin/.test(r.body));
  assert.ok(users.length >= 6, `found ${users.length} hud-spin users`);
  for (const r of users) assert.match(r.body, /animation:\s*hud-spin \.96s linear infinite/, `${r.f}: ${r.sel}`);
  for (const r of all) assert.doesNotMatch(r.body, /hud-spin[^;]*steps\(/, `${r.f}: ${r.sel}`);
});

test("@keyframes hud-spin holds each 30-degree turn for 1/12 of the cycle", () => {
  const css = sheets.map((s) => s.css).join("\n");
  const m = /@keyframes hud-spin \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(m, "no @keyframes hud-spin");
  assert.doesNotMatch(m[1], /:root|--spinner/, "the keyframes block swallowed the rule after it");
  const holds = [...m[1].matchAll(/([\d.]+)%, ([\d.]+)% \{ transform: rotate\((\d+)deg\); \}/g)]
    .map(([, a, b, d]) => [Number(a), Number(b), Number(d)]);
  assert.equal(holds.length, 12);
  holds.forEach(([a, b, d], k) => {
    assert.equal(d, k * 30);
    assert.ok(Math.abs(a - k * 100 / 12) < 0.01, `hold ${k} starts at ${a}%`);
    assert.ok(Math.abs(b - (k + 1) * 100 / 12) < 0.01, `hold ${k} ends at ${b}%`);
  });
});

test("no native-only or reduced-motion rule stops or hides a spinner", () => {
  for (const r of all) {
    const native = /\bnative\b/.test(r.sel);
    const spinner = SPINNER_SEL.test(r.sel);
    if (native) assert.doesNotMatch(r.body, /animation(-name|-play-state)?\s*:\s*(none|paused)|animation-play-state/, `${r.f}: ${r.sel}`);
    if (native && spinner) assert.doesNotMatch(r.body, /animation|transform|display:\s*none/, `${r.f}: ${r.sel}`);
    if (spinner && /reduced-motion/.test(r.at)) assert.doesNotMatch(r.body, /animation:\s*none|animation-name:\s*none|paused/, `${r.f}: ${r.sel}`);
  }
});

test("ios6.css carries nav/spinner.js's images, and every spinner uses one of them", () => {
  const ios6 = sheets.find((s) => s.f === "ios6.css").css;
  const root = rules(ios6).filter((r) => r.sel === ":root" && !r.at).map((r) => r.body).join("\n");
  for (const k of Object.keys(SPINNERS)) assert.ok(root.includes(`--spinner-${k}: ${spinnerURL(k)};`), `--spinner-${k} is missing from :root or stale: regenerate it from spinnerURL("${k}")`);
  const drawn = all.filter((r) => SPINNER_SEL.test(r.sel) && /animation:\s*hud-spin/.test(r.body));
  // the image may sit in the same selector's look-only rule beside the animation's, in the same sheet (docs/eras.md; C46: packages.css splits layout from look),
  // and the shared chrome's layout is style.css's while ios6.css paints it (C45), so those two count as one sheet
  const sheet = (f) => (f === "style.css" ? "ios6.css" : f);
  const paint = (r) => all.filter((x) => sheet(x.f) === sheet(r.f) && x.sel === r.sel && x.at === r.at).map((x) => x.body).join(";");
  for (const r of drawn) assert.match(paint(r), /background:\s*var\(--spinner-(white|gray|large)\)/, `${r.f}: ${r.sel}`);
});

test("the images have UIKit's geometry and alphas (measured from the 4S frames)", () => {
  const w = spinnerSVG("white");
  assert.equal((w.match(/<line /g) || []).length, 12);
  assert.match(w, /viewBox='0 0 20 20'/);
  assert.match(w, /stroke-width='2' stroke-linecap='round'/);
  assert.match(w, /<line x1='10' y1='1' x2='10' y2='4' opacity='0\.271'\/>/); // spoke 0: r 6..9 pt, the floor alpha
  assert.match(w, /rotate\(270 10 10\)' opacity='0\.851'/); // the brightest at 9 o'clock
  assert.match(spinnerSVG("large"), /viewBox='0 0 37 37'.*stroke-width='3'.*y1='2\.5' x2='18\.5' y2='8\.5'/);
  assert.match(spinnerSVG("gray"), /stroke='#000'.*rotate\(270 10 10\)' opacity='0\.384'/);
});

// F381: each later era draws its own UIActivityIndicatorView (journal/2026-11-23-f381-era-spinners).
const tokensIn = (f, sel) => rules(sheets.find((s) => s.f === f).css).filter((r) => r.sel === sel && !r.at).map((r) => r.body).join("\n");

test("F381: ios7.css, ios13.css and ios26.css carry their era's images from nav/spinner.js", () => {
  for (const [f, era] of [["ios7.css", "ios7"], ["ios13.css", "ios13"], ["ios26.css", "ios26"]]) {
    const root = tokensIn(f, `html[data-style="${era}"]`);
    for (const k of ["white", "gray", "large"]) {
      assert.ok(root.includes(`--spinner-${k}: ${spinnerURL(k, era)};`), `${f}: --spinner-${k} is missing or stale: regenerate it from spinnerURL("${k}", "${era}")`);
    }
    if (era === "ios7") { assert.doesNotMatch(root, /--spinner-turns/, "iOS 7 keeps 12 spokes and the 30-degree turn"); continue; }
    assert.match(root, /--spinner-turns: hud-spin-8;/, `${f}: 8 spokes turn 45 degrees at a time`);
    const dark = tokensIn(f, `html[data-style="${era}"][data-theme="dark"]`);
    assert.ok(dark.includes(`--spinner-gray: ${spinnerURL("grayDark", era)};`), `${f}: the dark theme's grey is secondaryLabel's dark value, spinnerURL("grayDark", "${era}")`);
  }
  assert.equal(spinnerSVG("gray", "ios26"), spinnerSVG("gray", "ios13"), "iOS 26 kept iOS 13's indicator");
});

test("F381: iOS 7's spinner has 12 thinner, shorter spokes and a tail that fades all the way round", () => {
  const [i6, i7] = [ERA_SPINNERS.ios6.gray, ERA_SPINNERS.ios7.gray];
  assert.ok(i7.width < i6.width, "thinner");
  assert.ok(i7.r2 - i7.r1 + i7.width < i6.r2 - i6.r1 + i6.width && i7.r2 + i7.width / 2 < i6.r2 + i6.width / 2, "shorter, inside iOS 6's reach");
  const w = spinnerSVG("white", "ios7");
  assert.equal((w.match(/<line /g) || []).length, 12);
  assert.match(w, /stroke-width='1\.75' stroke-linecap='round'/);
  assert.match(w, /rotate\(270 10 10\)' opacity='1'\/>/); // the brightest at 9 o'clock, as iOS 6's
  // walking counter-clockwise from the brightest, every spoke is dimmer than the one before: no flat floor
  const a = [...w.matchAll(/opacity='([\d.]+)'/g)].map((m) => Number(m[1]));
  const behind = Array.from({ length: 12 }, (_, j) => a[(9 - j + 12) % 12]);
  for (let j = 1; j < 12; j++) assert.ok(behind[j] < behind[j - 1], `spoke ${j} behind the brightest is dimmer`);
  assert.ok(Math.abs(behind[11] - 0.27) < 0.001);
  assert.match(spinnerSVG("large", "ios7"), /viewBox='0 0 37 37'.*stroke-width='2\.75'/);
});

test("F381: iOS 13-26's spinner has 8 thicker, rounder spokes as Apple's UI Kit draws them", () => {
  const g = spinnerSVG("gray", "ios13");
  assert.equal((g.match(/<line /g) || []).length, 8);
  assert.match(g, /stroke='#3c3c43' stroke-width='2\.67' stroke-linecap='round' opacity='0\.6'/); // secondaryLabel
  assert.match(g, /<line x1='10' y1='1\.335' x2='10' y2='5\.335' opacity='1'\/>/); // 2.67 x 6.67 from the top edge
  assert.match(g, /rotate\(45 10 10\)' opacity='0\.15'.*rotate\(315 10 10\)' opacity='0\.87'/);
  assert.ok(ERA_SPINNERS.ios13.gray.width > ERA_SPINNERS.ios6.gray.width, "thicker");
  assert.match(spinnerSVG("grayDark", "ios13"), /stroke='#ebebf5'.*opacity='0\.6'/);
  const l = spinnerSVG("large", "ios13");
  assert.equal((l.match(/<rect /g) || []).length, 8);
  assert.match(l, /viewBox='0 0 37 37'.*<rect x='16' y='1' width='5' height='13' rx='2' opacity='1'\/>/); // 35 pt, centred
});

test("F381: @keyframes hud-spin-8 holds each 45-degree turn for 1/8 of the cycle, and every spinner takes the hook", () => {
  const css = sheets.find((s) => s.f === "style.css").css;
  const m = /@keyframes hud-spin-8 \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(m, "no @keyframes hud-spin-8");
  const holds = [...m[1].matchAll(/([\d.]+)%, ([\d.]+)% \{ transform: rotate\((\d+)deg\); \}/g)].map(([, a, b, d]) => [Number(a), Number(b), Number(d)]);
  assert.equal(holds.length, 8);
  holds.forEach(([a, b, d], k) => {
    assert.equal(d, k * 45);
    assert.ok(Math.abs(a - k * 12.5) < 0.01 && Math.abs(b - (k + 1) * 12.5) < 0.01, `hold ${k}: ${a}%-${b}%`);
  });
  const hook = all.filter((r) => /animation-name:\s*var\(--spinner-turns, hud-spin\)/.test(r.body)).flatMap((r) => r.sel.split(/,\s*/));
  const drawn = all.filter((r) => /animation:\s*hud-spin/.test(r.body));
  for (const r of drawn) for (const sel of r.sel.split(/,\s*/)) assert.ok(hook.includes(`:root ${sel}`), `${r.f}: ${sel} has no :root rule taking --spinner-turns`);
});
