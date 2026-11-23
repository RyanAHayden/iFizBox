// The price button (myipas.css .price-btn, and every button built on it: More Sources' and Find More's .rec-add)
// draws its own era in the iOS 7 and iOS 13 styles, never iOS 6's glossy button. Every look a sheet gives a price
// button variant (a state class such as .added / .adding, or :active / :disabled) needs a rule of its own in
// ios7.css and ios13.css, so a later variant can't keep the gloss there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), "utf8");
const eras = { ios7: read("ios7.css"), ios13: read("ios13.css") };
const tint = { ios7: "--i7-tint", ios13: "--i13-tint" };

// Rules as [selector, body], comments dropped. The sheets nest no at-rules around these buttons.
function rules(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")).filter((p) => p.length >= 2)
    .map((p) => [p[p.length - 2].trim(), p[p.length - 1]]);
}
const look = /(^|;)\s*(color|background[\w-]*|border[\w-]*|box-shadow|text-shadow|opacity|font[\w-]*)\s*:/;

// Classes a price button is built with: "price-btn" plus whatever shares its className string in the screens.
function buttonClasses() {
  const out = new Set(["price-btn"]);
  const js = readdirSync(new URL("screens/", dir)).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  for (const f of js) {
    for (const m of read(`screens/${f}`).matchAll(/["'`]([^"'`]*\bprice-btn\b[^"'`]*)["'`]/g)) {
      for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/.test(c)) out.add(c);
    }
  }
  return out;
}

// The variant a compound selector gives a price button: its other classes and states, :not(...) left out. Null when
// the compound isn't a price button.
function variant(compound, classes) {
  const bare = compound.replace(/:not\([^)]*\)/g, "");
  const toks = bare.match(/::?[\w-]+|\.[\w-]+/g) ?? [];
  if (!toks.some((t) => t.startsWith(".") && classes.has(t.slice(1)))) return null;
  return toks.filter((t) => !(t.startsWith(".") && classes.has(t.slice(1)))).sort();
}

// Every look-setting variant the other sheets give a price button, as "token token" keys.
function variants(classes) {
  const out = new Map();
  const sheets = readdirSync(dir).filter((f) => f.endsWith(".css") && !/^ios(7|13)\.css$/.test(f));
  for (const f of sheets) {
    for (const [sel, body] of rules(read(f))) {
      if (!look.test(body)) continue;
      for (const one of sel.split(/,(?![^(]*\))/)) {
        const last = one.trim().split(/\s+|>|\+|~/).filter(Boolean).pop() ?? "";
        const v = variant(last, classes);
        if (v) out.set(v.join(" "), `${f}: ${one.trim()}`);
      }
    }
  }
  return out;
}

// The variants an era sheet styles, each as its token list, with the rule's selector.
function eraVariants(css, era, classes) {
  const out = [];
  for (const [sel, body] of rules(css)) {
    for (const one of sel.split(/,(?![^(]*\))/)) {
      const s = one.trim();
      if (!s.startsWith(`html[data-style="${era}"][data-theme] `)) continue;
      const v = variant(s.split(/\s+/).pop(), classes);
      if (v) out.push({ toks: v, sel: s, body });
    }
  }
  return out;
}

// State classes the screens toggle on a price button (findmore.js setButton): each is a variant
// too, styled in an era sheet or not.
function jsStates() {
  const out = new Map();
  for (const [f, fn] of [["screens/findmore.js", "setButton"]]) {
    const src = read(f);
    const at = src.indexOf(`function ${fn}(`);
    assert.ok(at >= 0, `${f} has ${fn}`);
    const body = src.slice(at, src.indexOf("\n}", at));
    for (const m of body.matchAll(/classList\.(?:toggle|add)\("([\w-]+)"/g)) out.set(`.${m[1]}`, `${f} ${fn}`);
  }
  return out;
}

const classes = buttonClasses();
const wanted = new Map([...variants(classes), ...jsStates()]);

test("the scan finds the price button's known variants (a broken scan would pass everything)", () => {
  assert.ok(classes.has("rec-add"), "More Sources' ADD is built on .price-btn");
  for (const k of [":active", ":disabled", ".added"]) assert.ok(wanted.has(k), `found ${k}`);
});

for (const [era, css] of Object.entries(eras)) {
  const have = eraVariants(css, era, classes);
  test(`${era}: every price button variant another sheet styles has its own era rule, at [data-theme] weight`, () => {
    for (const [key, where] of wanted) {
      const hit = have.filter((h) => h.toks.join(" ") === key);
      assert.ok(hit.length, `${era}.css has no html[data-style="${era}"][data-theme] .price-btn rule for ${key || "the base button"} (${where})`);
    }
  });

  test(`${era}: the base price button is flat and tinted`, () => {
    const base = have.find((h) => h.toks.length === 0 && h.sel.endsWith(" .price-btn"));
    assert.ok(base, "a base .price-btn rule");
    assert.match(base.body, new RegExp(`color:\\s*var\\(${tint[era]}\\)`));
    assert.match(base.body, /text-shadow:\s*none/);
    assert.match(base.body, /box-shadow:\s*none/);
    assert.doesNotMatch(base.body, /gradient/);
    const dim = have.find((h) => h.toks.includes(":disabled") && !h.toks.includes(":active"));
    assert.match(dim.body, /color:\s*var\(--i(7|13)-get-dim-text\)/, "disabled greys out");
    assert.match(dim.sel, /:not\(\.adding\)/, "adding keeps its tinted label while disabled");
  });
}
