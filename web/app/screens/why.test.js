// F303: the Why <NAME> page (screens/why.js): its points (tweak injection first), short lines, real screenshots that
// exist at the sizes the page reserves, where Home and the Not-an-iPhone page link it, and the README / sideload doc
// naming tweak injection from APT sources near their top.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAME } from "../brand.js";
import { fakeDocument, withDocument } from "../fakes.test-helper.js";
import { WHY_POINTS, WHY_ROUTE, whyHref, nav, whySections, endGroup, showsWhyTile, shotSrc, ensureWhyStyle, WHY_TILE,
  WHY_OPENED_KEY, whyOpened, markWhyOpened, whyAboutSection } from "./why.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// A JPEG's pixel size from its SOF marker.
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

test("the page leads with the two builds, then APT tweaks injected into sideloaded apps, then the rest in order", () => {
  assert.deepEqual(WHY_POINTS.map((p) => p.id),
    ["builds", "tweaks", "look", "signing", "freeid", "routes", "sources", "safety", "resign", "reviews"]);
  assert.equal(WHY_POINTS[0].title, "One App, Jailbroken or Not");
  assert.equal(WHY_POINTS[1].title, "Tweaks in Sideloaded Apps");
  const tweaks = WHY_POINTS[1];
  assert.match(tweaks.lines.join(" "), /APT repos/);
  assert.match(tweaks.lines.join(" "), /ElleKit/);
  assert.match(WHY_POINTS.find((p) => p.id === "routes").lines.join(" "), /own VPN/);
  assert.doesNotMatch(WHY_POINTS.find((p) => p.id === "routes").lines.join(" "), /Tailscale|LocalDevVPN/);
  assert.match(WHY_POINTS.find((p) => p.id === "sources").lines.join(" "), /AltStore.*APT/);
});

test("short lines: every row reads in one breath", () => {
  for (const p of WHY_POINTS) {
    assert.ok(p.lines.length >= 2 && p.lines.length <= 5, p.id);
    for (const l of p.lines) assert.ok(l.length <= 64, `${p.id}: "${l}" is ${l.length} characters`);
  }
});

test("every screenshot is a real file at the size the page reserves for it", () => {
  const shots = WHY_POINTS.filter((p) => p.shot);
  assert.ok(shots.length >= 5);
  assert.equal(WHY_POINTS[0].shot, "builds");
  assert.equal(WHY_POINTS[1].shot, "tweaks");
  for (const p of shots) {
    const buf = readFileSync(new URL(`../${shotSrc(p.shot)}`, import.meta.url));
    assert.deepEqual(jpegSize(buf), p.size, p.shot);
    assert.ok(buf.length < 120 * 1024, `${p.shot} stays small`);
    assert.ok(p.alt, p.shot);
  }
});

test("the name comes from brand.js, never spelled in why.js", () => {
  const js = read("./why.js");
  assert.doesNotMatch(js.replace(/^\/\/.*$/gm, ""), new RegExp(NAME, "i"));
  assert.equal(nav().title, `Why ${NAME}`);
  assert.equal(WHY_TILE.label, `Why ${NAME}?`);
});

test("route, tile visibility and what to do next per build", () => {
  assert.deepEqual(WHY_ROUTE, { tab: "home", path: ["why"] });
  assert.equal(whyHref(), "#/home/why");
  // F306: the website always; the installed apps until opened
  assert.equal(showsWhyTile("site", true), true);
  assert.equal(showsWhyTile("site", false), true);
  assert.equal(showsWhyTile("sideload", false), true);
  assert.equal(showsWhyTile("sideload", true), false);
  assert.equal(showsWhyTile("jailbreak", false), true);
  assert.equal(showsWhyTile("jailbreak", true), false);
  let installed = 0;
  const site = endGroup("site", () => { installed++; });
  site.rows[0].onClick();
  assert.equal(installed, 1);
  assert.equal(site.rows[0].label, `Install ${NAME} Lite`);
  assert.match(endGroup("sideload").rows[0].href, /^#\/.*signing$/);
  assert.equal(endGroup("jailbreak"), null);
  assert.equal(whySections({ mode: "jailbreak" }).length, WHY_POINTS.length);
  assert.equal(whySections({ mode: "site", install: () => {} }).length, WHY_POINTS.length + 1);
  assert.ok(whySections()[0].lead);
  assert.equal(whySections()[0].point.id, "builds"); // the lead styling follows the first group
  assert.ok(!whySections()[1].lead);
});

// A Storage-like map; the page body is the shared fake DOM's.
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test("F306: installed apps show the tile until the page is opened, then Settings > About has the row", async () => {
  // opening the page in an installed app stores ifizbox.whyOpened; on the website it doesn't
  const doc = Object.assign(fakeDocument(), { head: null, getElementById: () => null });
  const fakeEl = (tag) => doc.createElement(tag);
  await withDocument(async () => {
    const { render } = await import("./why.js");
    for (const mode of ["sideload", "jailbreak"]) {
      const store = memStore();
      assert.equal(whyOpened(store), false);
      assert.equal(showsWhyTile(mode, whyOpened(store)), true, `${mode}: first time`);
      render(fakeEl("div"), { mode, storage: store });
      assert.equal(store.m.get(WHY_OPENED_KEY), "1");
      assert.equal(showsWhyTile(mode, whyOpened(store)), false, `${mode}: after opening`);
      const about = whyAboutSection(mode);
      assert.equal(about.header, "About");
      assert.equal(about.rows[0].label, WHY_TILE.label);
      assert.equal(about.rows[0].href, "#/home/why");
    }
    const site = memStore();
    render(fakeEl("div"), { mode: "site", storage: site });
    assert.equal(site.m.size, 0);
    assert.equal(showsWhyTile("site", true), true);
    assert.equal(whyAboutSection("site"), null);
  }, doc);
  assert.equal(WHY_OPENED_KEY, "ifizbox.whyOpened");
  // storage that throws (private mode) keeps the tile
  assert.equal(whyOpened({ getItem() { throw new Error("blocked"); } }), false);
  markWhyOpened({ setItem() { throw new Error("blocked"); } });
  // Settings' root draws it, ahead of the version line; Home re-checks it on Back
  assert.match(read("./settings.js"), /whyAboutSection\(detectMode\(\)\)[\s\S]*grouped\(\[whyAbout\]\)[\s\S]*versionLines\(\)/);
  assert.match(read("./home.js"), /drawThemes\(\); \/\/ F306: Back from Why/);
});

test("its styles go in once and use the theme's tokens, no literal text colours", () => {
  const added = [];
  const doc = { head: { append: (s) => added.push(s) }, getElementById: (id) => added.find((s) => s.id === id) ?? null,
    createElement: () => ({}) };
  assert.equal(ensureWhyStyle(doc), true);
  assert.equal(ensureWhyStyle(doc), false);
  assert.equal(added.length, 1);
  assert.match(added[0].textContent, /color: var\(--text\)/);
});

test("Home links it high and keeps it open while locked; the Not-an-iPhone page offers it", () => {
  const home = read("./home.js");
  assert.match(home, /OPEN_WHILE_LOCKED = new Set\(\[[^\]]*"why"/);
  assert.match(home, /\{ match: "why", nav: \(\) => why\.nav\(\), render: \(body\) => \{ why\.render\(/);
  assert.match(home, /whyRow\.hidden = !why\.showsWhyTile\(settings\.mode, why\.whyOpened\(\)\)/);
  // right under the welcome and hint, above GitHub | Discord
  assert.match(home, /hintBox,\n\s+whyRow,\n\s+tileRow\("pair",/);
  const not = read("./notiphone.js");
  assert.match(not, /rowButton\(`Why \$\{NAME\}\?`, leave\(format\(WHY_ROUTE\)\)\)/);
  assert.match(not, /table\(whyApp, anyway, what\)/);
});

test("README and docs/sideload.md name tweak injection from APT sources near the top", () => {
  for (const f of ["../../../README.md", "../../../docs/sideload.md"]) {
    const top = read(f).split("\n").slice(0, 25).join("\n");
    assert.match(top, /tweak/i, f);
    assert.match(top, /APT/, f);
    assert.doesNotMatch(top, /\b[BFTDRCK]\d{2,3}\b/, `${f}: no task IDs`);
  }
});
