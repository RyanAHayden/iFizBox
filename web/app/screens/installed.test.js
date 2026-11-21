import { test } from "node:test";
import assert from "node:assert/strict";
import { pageKind, recordsApps, appSubtitle, appListRows, DPKG, APPS } from "./installed.js";
import { HOLD_MS } from "../nav/menu.js";

const r = (...path) => ({ tab: "installed", path });

test("installed tab: apps list without a jailbreak, dpkg in the jailbreak app (F30)", () => {
  assert.equal(recordsApps("site"), true);
  assert.equal(recordsApps("sideload"), true);
  assert.equal(recordsApps("jailbreak"), false);
  assert.equal(pageKind(r(), "site"), "apps");
  assert.equal(pageKind(r(), "sideload"), "apps");
  assert.equal(pageKind(r(), "jailbreak"), "dpkg");
  assert.equal(pageKind(r(DPKG), "site"), "dpkg"); // the upload stays on the site for jailbroken phones
  assert.equal(pageKind(r(DPKG), "sideload"), "browse");
  assert.equal(pageKind(r(DPKG, "package:x"), "site"), "browse");
  assert.equal(pageKind(r("package:x"), "jailbreak"), "browse");
});

test("installed tab: an app row says the upgrade, the source and the date", () => {
  const date = Date.UTC(2026, 10, 17, 12);
  assert.equal(appSubtitle({ sourceName: "AltStore", date, upgrade: "1.6" }, "en-US"), "Upgrade to 1.6 · AltStore · Nov 17, 2026");
  assert.equal(appSubtitle({ source: "https://a.example/apps.json", date: 0, upgrade: null }, "en-US"), "https://a.example/apps.json");
});

test("installed tab: My IPAs pages without a jailbreak (F77)", async () => {
  assert.equal(pageKind(r("myipas"), "sideload"), "myipas");
  assert.equal(pageKind(r("myipas", "ipa:A.ipa"), "site"), "myipas");
  assert.equal(pageKind(r("myipas"), "jailbreak"), "myipas"); // F209: not Not Found in the jailbreak app
  assert.equal(pageKind(r("myipas", "ipa:A.ipa"), "jailbreak"), "myipas");
  assert.equal(pageKind(r("myipas", "apps"), "jailbreak"), "myipas");
  assert.equal(pageKind(r(APPS), "jailbreak"), "apps"); // the jailbreak app's Apps page is unchanged
  const { myIpasRow } = await import("./installed.js");
  assert.equal(myIpasRow(r(), false).href, "#/installed/myipas");
  assert.equal(myIpasRow(r(), false).label, "Install IPAs"); // F79: the page is Install IPAs now
});

test("F87: the jailbreak app's Apps page: the phone's versions, I4's notes, no upgrade for an app that's gone", () => {
  assert.equal(pageKind(r(APPS), "jailbreak"), "apps");
  assert.equal(pageKind(r(APPS, "package:x"), "jailbreak"), "browse");
  assert.equal(pageKind(r(APPS), "sideload"), "browse"); // the list is the root there
  assert.equal(appSubtitle({ note: "Installed: 1.6 (iFizBox remembered 1.5)", sourceName: "AltStore", date: 0, upgrade: "1.7" }),
    "Installed: 1.6 (iFizBox remembered 1.5) · Upgrade to 1.7 · AltStore");
  const rows = appListRows([
    { id: "delta", name: "Delta", version: "1.6", actual: "1.6", remembered: "1.5", date: 2 },
    { id: "gone", name: "Gone", version: "2.0", actual: null, remembered: "2.0", date: 1 },
    { id: "plain", name: "Plain", version: "1.0", date: 3 }, // site/sideload record, no I4 fields
  ], () => ({ version: "9" }));
  assert.deepEqual(rows.map((x) => [x.id, x.upgrade]), [["plain", "9"], ["delta", "9"], ["gone", null]]);
});

// ---- F104: Installed sort, Hide by Author ----------------------------------------------------------------------
import { installDates } from "./installed.js";
import { createCatalog, installedBytes } from "../core/catalog.js";
import { createSettings } from "../core/settings.js";

// F127 replaced F104's Name/Recent/Size bar with Cydia's User | Expert | Recent (tests at the end of this file).

test("F104: install dates come from the jailbreak app's apt.installDates, else none", async () => {
  const native = { dpkgStatus: () => "", call: async (m) => (m === "apt.installDates" ? { a: 5 } : null) };
  assert.deepEqual(await installDates(native), { a: 5 });
  assert.equal(await installDates({ ...native, call: async () => ({}) }), null); // nothing read
  assert.equal(await installDates({ ...native, call: async () => { throw new Error("unknown method"); } }), null); // older shell
  assert.equal(await installDates({ call: native.call }), null); // the sideload build: no dpkg
  assert.equal(await installDates(undefined), null);
});

test("F104: installed rows carry Installed-Size in bytes", () => {
  assert.equal(installedBytes({ "installed-size": "12" }), 12288);
  assert.equal(installedBytes({ "installed-size": "x" }), null);
  assert.equal(installedBytes({}), null);
  const c = createCatalog();
  c.setInstalled("Package: a\nStatus: install ok installed\nVersion: 1\nInstalled-Size: 3\nName: A\n\n" +
    "Package: b\nStatus: install ok installed\nVersion: 1\nName: B\n");
  assert.deepEqual(c.installed().map((r) => [r.id, r.size]), [["a", 3072], ["b", null]]);
});

test("F104: a hidden author's packages leave lists, sections and Search but stay on the author page", () => {
  const c = createCatalog();
  c.load("deb:x", [
    "Package: one\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nName: One\nAuthor: Jane Doe <j@x>\nDescription: tweak one\n",
    "Package: two\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nName: Two\nMaintainer: jane doe <j@x>\nDescription: tweak two\n",
    "Package: three\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nName: Three\nAuthor: Sam <s@x>\nDescription: tweak three\n",
  ].join("\n"), null, "iphoneos-arm64");
  assert.equal(c.list().length, 3);
  assert.equal(c.setHiddenAuthors(["Jane Doe", "", 5]), 1);
  assert.deepEqual(c.list().map((r) => r.id), ["three"]);
  assert.deepEqual(c.sections().sections, [{ name: "Tweaks", count: 1 }]);
  assert.equal(c.sections().total, 1);
  assert.deepEqual(c.search("tweak").map((r) => r.id), ["three"]);
  assert.deepEqual(c.author("Jane Doe").map((r) => r.id).sort(), ["one", "two"]);
  c.setHidden(["Tweaks"]);
  assert.deepEqual(c.author("Jane Doe"), []); // a hidden section still wins
  c.setHidden([]);
  c.setHiddenAuthors([]);
  assert.equal(c.list().length, 3);
});

test("F104: settings keep hidden authors, one per name whatever its case", () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const s = createSettings({ storage });
  const heard = [];
  s.onChange((k, v) => { if (k === "hiddenAuthors") heard.push(v); });
  s.hiddenAuthors.set("Jane Doe", true);
  s.hiddenAuthors.set("jane doe", true);
  assert.deepEqual(s.hiddenAuthors.list(), ["jane doe"]);
  assert.equal(s.hiddenAuthors.has("JANE DOE"), true);
  s.hiddenAuthors.set("Sam", true);
  s.hiddenAuthors.set("JANE doe", false);
  assert.deepEqual(s.hiddenAuthors.list(), ["Sam"]);
  assert.deepEqual(heard.at(-1), ["Sam"]);
});

test("F104: the fake shell's apt.installDates reads info/<pkg>[:arch].list mtimes, as Apt.swift does", async () => {
  const { createFakeNative, makeFixture } = await import("../../../native/fake/fake-native.mjs");
  const { mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
  const { join } = await import("node:path");
  const fx = makeFixture();
  try {
    const info = join(fx.prefix, "var/lib/dpkg/info");
    mkdirSync(info, { recursive: true });
    for (const [name, t] of [["a.list", 1000], ["b:iphoneos-arm64.list", 2000], ["a.md5sums", 9000]]) {
      writeFileSync(join(info, name), "");
      utimesSync(join(info, name), t, t);
    }
    const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote });
    assert.deepEqual(await installDates(native), { a: 1000, b: 2000 });
  } finally { fx.cleanup(); }
});

test("F104: Hide Packages by <author> on the author page, Hidden in Manage", async () => {
  const { authorToggleRow } = await import("./browse.js");
  const { hiddenRow, hiddenGroups } = await import("./manage.js");
  assert.equal(authorToggleRow("Jane", false).label, "Hide Packages by Jane");
  assert.equal(authorToggleRow("Jane", true).label, "Show Packages by Jane");
  assert.deepEqual(hiddenRow(["Themes"], ["Jane"]), { label: "Hidden", detail: "2", href: "#/sources/manage/hidden" });
  assert.equal(hiddenRow([], []).detail, undefined);
  assert.deepEqual(hiddenGroups(["Themes"], ["Jane"]).map((g) => [g.header, g.items.map((i) => i.kind + ":" + i.name)]),
    [["Sections", ["section:Themes"]], ["Authors", ["author:Jane"]]]);
  assert.deepEqual(hiddenGroups([], []), []);
});

// ---- F125: the Wish List in Installed ----------------------------------------------------------------------------
import { WISH } from "./installed.js";
import { wishCount, createWishlist } from "../core/wishlist.js";

test("F125: #installed/wishlist is the Wish List page in every mode; its package pages are browse.js's", () => {
  for (const mode of ["site", "sideload", "jailbreak"]) {
    assert.equal(pageKind(r(WISH), mode), "wishlist");
    assert.equal(pageKind(r(WISH, "package:x"), mode), "browse");
  }
  assert.equal(pageKind(r(), "jailbreak"), "dpkg"); // the root is unchanged
  assert.equal(pageKind(r(), "site"), "apps");
});

test("F125: wishCount leaves out installed packages and repeats", () => {
  assert.equal(wishCount(["a", "b", "c"], ["b"]), 2);
  assert.equal(wishCount(["a", "a"], []), 1);
  assert.equal(wishCount([], ["x"]), 0);
});

test("F125: the page's Delete takes a package off the list, and the count follows", () => {
  const w = createWishlist({ storage: null });
  const seen = [];
  w.onChange((list) => seen.push(list.length));
  w.set("a", true); w.set("b", true);
  assert.equal(wishButtonLabel(wishCount(w.list(), [])), "Wish List (2)");
  w.set("a", false); // what removeWish does
  assert.deepEqual(w.list(), ["b"]);
  assert.deepEqual(seen, [1, 2, 1], "each change tells Installed to redraw the button and the page");
  assert.equal(wishButtonLabel(wishCount(w.list(), [])), "Wish List (1)");
});

// ---- F147: the Wish List as a nav-bar button, not a row ---------------------------------------------------------
import { nav, isRoot, wishButton, wishButtonLabel, wishRoute } from "./installed.js";
import * as installedModule from "./installed.js";
import { readFileSync } from "node:fs";

test("F147: the button's label carries the count, none at 0", () => {
  assert.equal(wishButtonLabel(0), "Wish List");
  assert.equal(wishButtonLabel(3), "Wish List (3)");
});

test("F147: the button opens #installed/wishlist, which is still the Wish List page", () => {
  const seen = [];
  let drawn = null;
  const spec = wishButton(r(), 2, { go: (to) => seen.push(to), ref: (b) => { drawn = b; } });
  assert.equal(spec.label, "Wish List (2)");
  spec.onClick();
  assert.deepEqual(seen, [{ tab: "installed", path: [WISH] }]);
  spec.ref("button"); // app.js hands the drawn button back so the count can change in place
  assert.equal(drawn, "button");
  assert.deepEqual(wishRoute(r(APPS)), { tab: "installed", path: [WISH] }); // under the root whatever page asks
  for (const mode of ["site", "sideload", "jailbreak"]) assert.equal(pageKind(r(WISH), mode), "wishlist");
});

test("F147: the button sits top left on Installed's root only; Edit stays on the right", () => {
  assert.equal(isRoot(r()), true);
  assert.equal(isRoot(r(WISH)), false);
  assert.equal(isRoot(r(DPKG)), false); // a back button holds the left slot there
  // nav() builds the root's User | Expert | Recent control: a do-nothing element is enough here.
  const el = () => ({ append() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, toggle() {}, remove() {} }, style: {} });
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { createElement: el };
  const seen = [];
  let root;
  try { root = nav(r(), { go: (to) => seen.push(to) }); } finally {
    if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document;
  }
  assert.match(root.left.label, /^Wish List( \(\d+\))?$/);
  root.left.onClick();
  assert.deepEqual(seen, [{ tab: "installed", path: [WISH] }]);
  if (root.right) assert.notEqual(root.right.label, "Wish List"); // Edit (the apps list) or nothing (dpkg), on the right
  assert.equal(nav(r(WISH), {}).left, undefined); // the Wish List page itself: back button only
  assert.equal(nav(r(WISH), {}).right.label, "Edit");
});

test("F147: F125's Wish List row is gone from Installed's page", () => {
  assert.equal(installedModule.wishListRow, undefined);
  const src = readFileSync(new URL("./installed.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /header: "Packages"/, "no Packages section with the Wish List row under the apps");
  assert.doesNotMatch(src, /subtitle: "Packages to install later"/, "no Wish List row beside Apps above dpkg's list");
});

// ---- F127: Installed like Cydia's: User | Expert | Recent, kinds, search -----------------------------------------
import { dpkgModes, APP_MODES, dpkgItems, appSections, canReadDates } from "./installed.js";

const STATUS_F127 = [
  "Package: activator\nName: Activator\nStatus: install ok installed\nVersion: 1.9\nSection: Tweaks\nDepends: mobilesubstrate, preferenceloader\nDescription: Gestures",
  "Package: mobilesubstrate\nName: Substrate\nStatus: install ok installed\nVersion: 0.9\nSection: System\nDescription: hooks",
  "Package: preferenceloader\nName: PreferenceLoader\nStatus: install ok installed\nVersion: 2.2\nSection: Tweaks\nDescription: settings",
  "Package: bash\nStatus: install ok installed\nVersion: 5.2\nEssential: yes\nSection: Terminal Support\nDescription: shell",
  "Package: base\nStatus: install ok installed\nVersion: 1\nPriority: required\nSection: System\nDescription: base",
  "Package: zebra-theme\nName: Zebra Theme\nStatus: install ok installed\nVersion: 1\nSection: Themes\nDescription: a theme",
  "Package: myapp\nName: My App\nStatus: install ok installed\nVersion: 1\nSection: Applications\nAuthor: Jane Doe <j@x>\nDescription: an app",
  "Package: gcc\nStatus: install ok installed\nVersion: 1\nTag: role::developer\nSection: Development\nDescription: compiler",
  "Package: cydia-lproj\nStatus: install ok installed\nVersion: 1\nTag: purpose::x, role::cydia\nSection: System\nDescription: hidden",
  "Package: odd\nStatus: install ok installed\nVersion: 1\nTag: role::leaper\nSection: Tweaks\nDescription: other role",
].join("\n\n") + "\n";

function f127Rows() {
  const c = createCatalog();
  c.setInstalled(STATUS_F127);
  return c.installed();
}

test("F127: User leaves out dependencies and Essential packages; Expert lists every package Cydia would", () => {
  const rows = f127Rows();
  assert.deepEqual(dpkgItems(rows, { mode: "user" }).map((r) => r.id), ["activator", "myapp", "zebra-theme"]);
  assert.deepEqual(dpkgItems(rows, { mode: "expert" }).map((r) => r.id),
    ["activator", "base", "bash", "gcc", "myapp", "preferenceloader", "mobilesubstrate", "zebra-theme"]);
});

test("F127: Recent lists installs and upgrades newest first, in day sections, without undated packages", () => {
  const rows = f127Rows();
  const day = (d, h) => Date.UTC(2026, 10, d, h) / 1000;
  const dates = { activator: day(16, 12), gcc: day(18, 9), myapp: day(18, 11), odd: day(16, 13), "cydia-lproj": day(18, 12) };
  const items = dpkgItems(rows, { mode: "recent", dates, locale: "en-US" });
  // role::cydia never shows; role::leaper only here; undated packages drop out
  assert.deepEqual(items.map((x) => x.header ?? x.id), ["November 18, 2026", "myapp", "gcc", "November 16, 2026", "odd", "activator"]);
  assert.deepEqual(dpkgItems(rows, { mode: "recent", dates: null }), []);
});

test("F127: the kinds (Search's segments) and the search narrow any mode", () => {
  const rows = f127Rows();
  assert.deepEqual(dpkgItems(rows, { mode: "expert", type: "Tweaks" }).map((r) => r.id), ["activator", "preferenceloader"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "Themes" }).map((r) => r.id), ["zebra-theme"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "Apps" }).map((r) => r.id), ["myapp"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "All", query: "gest" }).map((r) => r.id), ["activator"]); // description
  assert.deepEqual(dpkgItems(rows, { mode: "user", query: "JANE" }).map((r) => r.id), ["myapp"]); // author, any case
  assert.deepEqual(dpkgItems(rows, { mode: "expert", query: "pref zzz" }).map((r) => r.id), []); // every word
  assert.deepEqual(dpkgItems(rows, { mode: "expert", query: "  substrate " }).map((r) => r.id), ["mobilesubstrate"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "Tweaks", query: "zzz" }), []);
});

test("F127: Recent is offered where install dates can be read (the jailbreak app)", () => {
  assert.deepEqual(dpkgModes(true), ["user", "expert", "recent"]);
  assert.deepEqual(dpkgModes(false), ["user", "expert"]); // the site's uploaded status file has no dates
  assert.equal(canReadDates({ call() {}, dpkgStatus() {} }), true);
  assert.equal(canReadDates({ call() {} }), false); // the sideload build
  assert.equal(canReadDates(undefined), false);
  assert.deepEqual(APP_MODES, ["user", "recent"]);
});

test("F127: the apps list: User A–Z, Recent newest first by day, both searchable", () => {
  const t = (d) => Date.UTC(2026, 10, d, 12);
  const recs = [{ id: "b", name: "Beta", date: t(17), sourceName: "AltStore" }, { id: "a", name: "alpha", date: t(16) },
    { id: "c", name: "iFizBox", date: 0, self: true }, { id: "d", name: "Delta", date: t(17) }];
  const shape = (secs) => secs.map((s) => [s.header, s.rows.map((r) => r.id)]);
  assert.deepEqual(shape(appSections(recs, { mode: "user" })), [["A", ["a"]], ["B", ["b"]], ["D", ["d"]], ["I", ["c"]]]);
  assert.deepEqual(shape(appSections(recs, { mode: "recent", locale: "en-US" })),
    [["November 17, 2026", ["b", "d"]], ["November 16, 2026", ["a"]], ["iFizBox", ["c"]]]);
  assert.deepEqual(shape(appSections(recs, { mode: "recent", query: "ta", locale: "en-US" })), [["November 17, 2026", ["b", "d"]]]);
  assert.deepEqual(appSections(recs, { query: "nothing" }), []);
});

test("F130: apt.autoInstalled gives a Set of apt's Auto-Installed marks, else null; dpkgItems uses them", async () => {
  const { autoInstalled, dpkgItems } = await import("./installed.js");
  const native = { dpkgStatus: () => "", call: async (m) => (m === "apt.autoInstalled" ? ["libfoo"] : null) };
  assert.deepEqual(await autoInstalled(native), new Set(["libfoo"]));
  assert.deepEqual(await autoInstalled({ ...native, call: async () => [] }), new Set()); // read, nothing marked
  assert.equal(await autoInstalled({ ...native, call: async () => null }), null); // no extended_states
  assert.equal(await autoInstalled({ ...native, call: async () => { throw new Error("unknown method"); } }), null);
  assert.equal(await autoInstalled({ call: native.call }), null); // the sideload build
  assert.equal(await autoInstalled(undefined), null);
  const rows = [{ id: "activator", name: "Activator", tier: 2 }, { id: "libfoo", name: "libfoo", tier: 2 }];
  assert.deepEqual(dpkgItems(rows, { auto: new Set(["libfoo"]) }).map((r) => r.id), ["activator"]);
  assert.deepEqual(dpkgItems(rows, {}).map((r) => r.id), []); // the guess
});

test("F130: the fake shell's apt.autoInstalled reads extended_states as Apt.swift does", async () => {
  const { createFakeNative, makeFixture } = await import("../../../native/fake/fake-native.mjs");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const fx = makeFixture();
  try {
    const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote });
    const before = await autoInstalledOf(native);
    const dir = join(fx.prefix, "var/lib/apt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extended_states"), "Package: libfoo\nArchitecture: iphoneos-arm64\nAuto-Installed: 1\n\n" +
      "Package: tweak\nArchitecture: iphoneos-arm64\nAuto-Installed: 0\n\nPackage: abar\r\nAuto-Installed: 1\r\n");
    assert.equal(before, null);
    assert.deepEqual(await autoInstalledOf(native), new Set(["abar", "libfoo"]));
  } finally { fx.cleanup(); }
});

async function autoInstalledOf(native) {
  const { autoInstalled } = await import("./installed.js");
  return autoInstalled(native);
}

// ---- B36: every app row opens, holds and swipes ------------------------------------------------------------------
import { appListElement, appRowHref, appActions, appSheet, appPageSections, keptIpaOf, appIdOf, appToken, OPEN, RESIGN,
  SAVE_IPA, REMOVE } from "./installed.js";

// A fake DOM good enough for nav/ui.js plain() and the list's decoration: class selectors only.
function b36Dom() {
  const matches = (n, sel) => sel.split(".").filter(Boolean).every((c) => n._cls?.has(c));
  const walk = (n, out = []) => { for (const c of n.children) { out.push(c); walk(c, out); } return out; };
  const make = (tag, frag = false) => {
    const e = {
      tagName: String(tag).toUpperCase(), isFragment: frag, children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
      parentNode: null, _text: "", _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: {
        add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        contains: (c) => e._cls.has(c), toggle: (c, on = !e._cls.has(c)) => { if (on) e._cls.add(c); else e._cls.delete(c); return on; },
      },
      get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
      set textContent(v) { e._text = String(v); e.children = []; },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: (k) => e.attrs[k] ?? null,
      append(...c) {
        for (const x of c) {
          if (typeof x === "string") { e._text += x; continue; }
          if (x.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
          x.parentNode = e;
          e.children.push(x);
        }
      },
      remove() { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((y) => y !== e); },
      contains: (x) => { for (let n = x; n; n = n.parentNode) if (n === e) return true; return false; },
      closest(sel) { for (const s of sel.split(",").map((x) => x.trim())) for (let n = e; n; n = n.parentNode) if (matches(n, s)) return n; return null; },
      querySelectorAll(sel) {
        if (sel.startsWith(":scope > ")) return e.children.filter((c) => matches(c, sel.slice(9)));
        return walk(e).filter((c) => matches(c, sel));
      },
      querySelector: (sel) => e.querySelectorAll(sel)[0] ?? null,
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      fire(t, ev) { for (const f of e.listeners[t] ?? []) f(ev); },
      click() {},
    };
    return e;
  };
  return { createElement: (t) => make(t), createDocumentFragment: () => make("#fragment", true), body: make("body") };
}

function withDom(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = b36Dom();
  try { return fn(); } finally { if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document; }
}

const B36_ROWS = [
  { id: "com.ryha.ifizbox", name: "iFizBox", version: "0.4", self: true },
  { id: "com.example.opentennis", name: "OpenTennis Beta", version: "1.0", sourceName: "Beta" }, // no source lists it now
];
const B36_EXTRA = [{ id: "com.example.mine", name: "Mine", version: "2.0", signedOnly: true }];
const B36_SIGNED = { apps: [{ bundleId: "com.example.opentennis", name: "OpenTennis Beta", version: "1.0", expires: "2099-01-01T00:00:00Z" },
  { bundleId: "com.example.mine", name: "Mine", version: "2.0", expires: "2099-01-01T00:00:00Z" }] };

test("B36: a row no source lists and an extra row open a page; the source's page while a source has it", () => {
  const root = r();
  assert.match(appRowHref(B36_ROWS[1], null, root), /app(:|%3A)com\.example\.opentennis$/);
  assert.match(appRowHref(B36_ROWS[1], new Map([["com.example.opentennis", {}]]), root), /package(:|%3A)com\.example\.opentennis$/);
  assert.equal(appIdOf(appToken("a.b")), "a.b");
  assert.equal(appIdOf("app:"), null);
  assert.equal(appIdOf("package:a"), null);
  assert.equal(pageKind(r("app:a.b"), "sideload"), "app");
  assert.equal(pageKind(r("app:a.b"), "site"), "app");
  assert.equal(pageKind(r(APPS, "app:a.b"), "jailbreak"), "app");
  assert.equal(pageKind(r("app:a.b"), "jailbreak"), "browse"); // the list is one row down there
  assert.equal(pageKind(r(APPS, "package:a"), "jailbreak"), "browse");
});

test("B36: every row is a link (pressed highlight), extra rows included; Delete on every row but iFizBox's own", () => withDom(() => {
  const ul = appListElement([{ rows: B36_ROWS }], B36_EXTRA, { route: r(), cands: new Map([["com.ryha.ifizbox", {}]]), signed: B36_SIGNED, editing: false });
  const cells = ul.querySelectorAll(":scope > .cell");
  assert.equal(cells.length, 3);
  for (const li of cells) {
    const inner = li.querySelector(".cell-inner");
    // app.js's PRESSABLE is "a.cell-inner": a link row gets .is-pressed under the finger
    assert.equal(inner.tagName, "A", li.textContent);
    assert.ok(inner.href, li.textContent);
    assert.ok(li.classList.contains("installed-app"));
  }
  assert.match(cells[0].querySelector(".cell-inner").href, /package/); // iFizBox: its source's page, as before
  assert.match(cells[1].querySelector(".cell-inner").href, /app(:|%3A)com\.example\.opentennis/);
  assert.match(cells[2].querySelector(".cell-inner").href, /app(:|%3A)com\.example\.mine/);
  assert.equal(cells[0].querySelector(".del-confirm"), null, "no Delete on the app's own row");
  assert.ok(cells[1].querySelector(".del-confirm"));
  assert.ok(cells[2].querySelector(".del-confirm"), "the extra row deletes too");
  assert.equal(cells[1]._app.signed.bundleId, "com.example.opentennis");
  // A left swipe shows the red Delete, on the extra row too; never on iFizBox's own.
  const swipe = (li) => {
    const target = li.querySelector(".cell-label");
    ul.fire("pointerdown", { target, clientX: 300, clientY: 10 });
    ul.fire("pointermove", { target, clientX: 240, clientY: 12 });
  };
  swipe(cells[2]);
  assert.ok(cells[2].classList.contains("armed"));
  swipe(cells[1]);
  assert.ok(cells[1].classList.contains("armed"));
  assert.ok(!cells[2].classList.contains("armed"), "one Delete at a time");
  swipe(cells[0]);
  assert.ok(!cells[0].classList.contains("armed"));
}));

test("B36: a hold opens the sheet with the actions that apply", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sheets = [];
  const acted = [];
  withDom(() => {
    const hold = { mode: "sideload", findIpa: async () => null, sheet: async (o) => { sheets.push(o); return o.buttons.indexOf(RESIGN); },
      act: async (label, row) => acted.push([label, row.id]) };
    const ul = appListElement([{ rows: B36_ROWS }], B36_EXTRA, { route: r(), signed: B36_SIGNED, editing: false, hold });
    const cells = ul.querySelectorAll(":scope > .cell");
    ul.fire("pointerdown", { target: cells[1].querySelector(".cell-label"), clientX: 100, clientY: 10 });
    t.mock.timers.tick(HOLD_MS - 1); // B48: HOLD_MS (550), no longer 500
    assert.equal(sheets.length, 0, "not before HOLD_MS");
    t.mock.timers.tick(1);
  });
  return new Promise((done) => setImmediate(done)).then(() => {
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].title, "OpenTennis Beta");
    assert.deepEqual(sheets[0].buttons, [OPEN, RESIGN, REMOVE]);
    assert.equal(sheets[0].destructive, 2);
    assert.deepEqual(acted, [[RESIGN, "com.example.opentennis"]]);
  });
});

test("B36: the sheet's actions per row and build; Save Signed IPA when My IPAs keeps a signed copy", async () => {
  const signed = { bundleId: "com.example.x.custom", originalBundleId: "com.example.x" };
  assert.deepEqual(appActions({ id: "a", name: "A" }, { mode: "site" }), [REMOVE]);
  assert.deepEqual(appActions({ id: "a", name: "A" }, { mode: "jailbreak" }), [REMOVE]);
  assert.deepEqual(appActions({ id: "a", name: "A", signed: null }, { mode: "sideload" }), [OPEN, REMOVE]);
  assert.deepEqual(appActions({ id: "a", name: "A", signed }, { mode: "sideload", ipa: { file: "X.ipa" } }), [OPEN, RESIGN, SAVE_IPA, REMOVE]);
  assert.deepEqual(appActions({ id: "s", name: "Me", self: true, signed }, { mode: "sideload" }), [RESIGN]); // no Open, no Remove
  const entries = [{ file: "Y.ipa", bundleId: "com.example.x", signed: null }, { file: "X.ipa", bundleId: "com.example.x", signed: { bundleId: "com.example.x.custom" } }];
  assert.equal(keptIpaOf({ id: "com.example.x", signed }, entries).file, "X.ipa");
  assert.equal(keptIpaOf({ id: "com.example.z", signed: null }, entries), null);
  // Cancel does nothing; nothing to offer, no sheet
  let asked = 0;
  assert.equal(await appSheet({ id: "a", name: "A" }, { mode: "site", sheet: async () => { asked++; return -1; }, act: () => assert.fail() }), null);
  assert.equal(asked, 1);
  assert.equal(await appSheet({ id: "s", name: "Me", self: true }, { mode: "site", sheet: async () => assert.fail() }), null);
});

test("B36: the installed-app page shows version, bundle ID, source and signature, then the actions", () => {
  const now = new Date("2026-11-18T00:00:00Z");
  const rec = { id: "com.example.opentennis", name: "OpenTennis Beta", version: "1.0", sourceName: "Beta",
    signed: { bundleId: "com.example.opentennis", expires: "2026-11-25T00:00:00Z" } };
  const secs = appPageSections(rec, { mode: "sideload", now, window: 2 });
  const rows = Object.fromEntries(secs[0].rows.map((x) => [x.label, x.detail]));
  assert.equal(rows.Version, "1.0");
  assert.equal(rows["Bundle ID"], "com.example.opentennis");
  assert.equal(rows.Source, "Beta");
  assert.equal(rows.Signature, "7 days left");
  assert.deepEqual(secs[1].rows.map((x) => x.label), [OPEN, RESIGN]);
  assert.deepEqual(secs[2].rows.map((x) => x.label), [REMOVE]);
  const extra = appPageSections({ id: "com.example.mine", name: "Mine", version: "2", signedOnly: true, signed: { bundleId: "com.example.mine" } }, { mode: "site" });
  assert.match(extra[0].footer, /No source lists it/);
  assert.match(extra.at(-1).footer, /done from the Home Screen/); // B46
});

// ---- B46: Delete uninstalls where it can; Remove from List where it can't ----------------------------------------

import { deleteAction, confirmDelete, forgetApp, withInstalled, statusText, DELETE, HOME_SCREEN } from "./installed.js";
import { uninstallError } from "../backend-native.js";

test("B46: which label and action each mode gets", () => {
  const rec = { id: "com.example.delta", name: "Delta", version: "1.6" };
  // The jailbreak app with the helper seeing the app installed (I4 `actual`): Delete uninstalls, 'Delete Delta' red.
  assert.deepEqual(deleteAction({ ...rec, actual: "1.6" }, { mode: "jailbreak" }),
    { kind: "uninstall", label: DELETE, button: "Delete Delta", note: null });
  // A record of an app that is gone: nothing to uninstall, so Remove from List, saying so.
  const gone = deleteAction({ ...rec, actual: null }, { mode: "jailbreak" });
  assert.equal(gone.kind, "forget");
  assert.equal(gone.label, REMOVE);
  assert.equal(REMOVE, "Remove from List");
  assert.match(gone.note, /Delta is no longer on your iPhone/);
  // The helper's versions unreadable (no `actual`): it can't be uninstalled from here; don't pretend.
  assert.equal(deleteAction(rec, { mode: "jailbreak" }).kind, "forget");
  assert.equal(deleteAction(rec, { mode: "jailbreak" }).note, HOME_SCREEN);
  // The site and the sideload app never uninstall: Remove from List, with the Home Screen line.
  for (const mode of ["site", "sideload"]) {
    const a = deleteAction(rec, { mode });
    assert.deepEqual(a, { kind: "forget", label: REMOVE, button: REMOVE, note: HOME_SCREEN }, mode);
    assert.equal(deleteAction({ ...rec, actual: "1.6" }, { mode }).kind, "forget", mode);
  }
  assert.match(HOME_SCREEN, /^Deleting the app itself is done from the Home Screen\.$/);
  // The sideload app's shell says iOS still has it: the row isn't hidden; Remove from List only explains.
  const still = deleteAction({ ...rec, installed: true }, { mode: "sideload" });
  assert.equal(still.kind, "installed");
  assert.equal(still.label, REMOVE);
  assert.match(still.note, /still on your iPhone/);
  assert.equal(deleteAction({ ...rec, installed: false }, { mode: "sideload" }).kind, "forget");
  // A signed app the list doesn't remember forgets its signature record; iFizBox's own row has none.
  assert.equal(deleteAction({ ...rec, signedOnly: true, actual: "1" }, { mode: "jailbreak" }).kind, "forget");
  assert.match(deleteAction({ ...rec, signedOnly: true }, { mode: "sideload" }).note, /Home Screen/);
  assert.equal(deleteAction({ ...rec, self: true }, { mode: "jailbreak" }), null);
  // The hold sheet and the app page carry the same label.
  assert.deepEqual(appActions({ ...rec, actual: "1.6" }, { mode: "jailbreak" }), [DELETE]);
  assert.deepEqual(appActions(rec, { mode: "site" }), [REMOVE]);
  const page = appPageSections({ ...rec, actual: "1.6" }, { mode: "jailbreak" });
  assert.deepEqual(page.at(-1).rows.map((x) => x.label), [DELETE]);
  assert.match(page.at(-1).footer, /Deletes Delta/);
  assert.equal(appPageSections(rec, { mode: "sideload" }).at(-1).footer, HOME_SCREEN);
});

test("B46: Delete is confirmed by an iOS 6 action sheet; Cancel does nothing", async () => {
  const sheets = [];
  const ran = [];
  const run = async (a, r) => ran.push([a.kind, r.id]);
  const rec = { id: "com.example.delta", name: "Delta", version: "1.6", actual: "1.6" };
  assert.equal(await confirmDelete(rec, { mode: "jailbreak", run, sheet: async (o) => { sheets.push(o); return -1; } }), false);
  assert.deepEqual(sheets[0], { title: "", buttons: ["Delete Delta"], destructive: 0 });
  assert.deepEqual(ran, []);
  assert.equal(await confirmDelete(rec, { mode: "jailbreak", run, sheet: async () => 0 }), true);
  assert.deepEqual(ran, [["uninstall", "com.example.delta"]]);
  // B265: Remove from List (the swipe's button, the hold sheet's) drops the record at once: no sheet.
  assert.equal(await confirmDelete(rec, { mode: "site", run, sheet: () => assert.fail("no confirm sheet") }), true);
  assert.equal(await confirmDelete({ ...rec, actual: null }, { mode: "jailbreak", run, sheet: () => assert.fail("no confirm sheet") }), true);
  assert.deepEqual(ran.slice(1), [["forget", "com.example.delta"], ["forget", "com.example.delta"]]);
  assert.equal(sheets.length, 1);
  // Still installed (sideload): an alert, nothing dropped.
  const alerts = [];
  assert.equal(await confirmDelete({ ...rec, installed: true }, { mode: "sideload", run, sheet: () => assert.fail(),
    alert: async (o) => alerts.push(o) }), false);
  assert.equal(alerts[0].title, "Still Installed");
  assert.equal(ran.length, 3);
  // iFizBox's own row: nothing.
  assert.equal(await confirmDelete({ ...rec, self: true }, { mode: "jailbreak", run, sheet: () => assert.fail() }), false);
});

test("B46: the sideload shell's word on what is installed wins; the helper's progress and errors read", async () => {
  const rows = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "me", name: "Me", self: true }];
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return { installed: { a: true, b: false, c: null } }; } };
  const out = await withInstalled(rows, { mode: "sideload", native });
  assert.deepEqual(calls, [["signing.isInstalled", { bundleIds: ["a", "b", "c"] }]]);
  assert.deepEqual(out.map((r) => r.installed), [true, false, undefined, undefined]);
  assert.equal(await withInstalled(rows, { mode: "jailbreak", native }), rows);
  assert.equal(await withInstalled(rows, { mode: "site", native }), rows);
  assert.equal(await withInstalled(rows, { mode: "sideload", native: { call: async () => { throw new Error("old shell"); } } }), rows);
  assert.equal(statusText("pmstatus:com.example.delta:10:Removing"), "Removing");
  assert.equal(statusText("Uninstalled com.example.delta"), null);
  assert.equal(uninstallError({ code: 64, stderr: "ifizbox-helper: not an app installed in the app containers (system and jailbreak apps aren't removed here)\n" }),
    "Not an app installed in the app containers (system and jailbreak apps aren't removed here).");
  assert.equal(uninstallError({ code: 1, stderr: "" }), "The app couldn't be deleted (1).");
  assert.match(uninstallError({ code: 64, stderr: "ifizbox-helper: unknown verb (update, ...)" }), /Update the helper/);
});

test("B46: the native backend's uninstallApp runs the helper's uninstall-app and fails loudly", async () => {
  const { createNativeBackend } = await import("../backend-native.js");
  const words = [];
  let reply = { code: 0, stdout: "Uninstalled com.example.delta\n", stderr: "" };
  const call = async (method, params, onEvent) => {
    if (method === "helper.run") {
      words.push(params.words);
      onEvent?.({ fd: "status", line: "pmstatus:com.example.delta:10:Removing" });
      return reply;
    }
    return null;
  };
  const b = createNativeBackend({ native: { call }, sourceOptions: { mode: "jailbreak" } });
  const seen = [];
  await b.uninstallApp("com.example.delta", (ev) => seen.push(ev.line));
  assert.deepEqual(words, [["uninstall-app", "com.example.delta"]]);
  assert.deepEqual(seen, ["pmstatus:com.example.delta:10:Removing"]);
  reply = { code: 1, stdout: "", stderr: "ifizbox-helper: test installd refused it\n" };
  await assert.rejects(b.uninstallApp("com.example.delta"), /Test installd refused it/);
  assert.equal(typeof createNativeBackend({ native: { call }, sourceOptions: { mode: "sideload" } }).uninstallApp, "undefined");
});

test("Remove from List on a remembered app iFizBox signed forgets the signature too (removed once, not twice)", async () => {
  const calls = [];
  const native = { call: async (m, a) => calls.push([m, a.bundleId]) };
  const removed = [];
  await forgetApp({ id: "com.example.app", signed: { bundleId: "com.example.app.x" } }, native, async (id) => removed.push(id));
  assert.deepEqual(calls, [["signing.forget", "com.example.app.x"]]);
  assert.deepEqual(removed, ["com.example.app"]);
  calls.length = 0;
  await forgetApp({ id: "com.example.plain", signed: null }, native, async (id) => removed.push(id));
  assert.deepEqual(calls, []);
});

// ---- B52: the root's Apps count follows a Delete on the Apps page ------------------------------------------------
import { refreshAppCount, appsRowSubtitle, topTable } from "./installed.js";

test("B291: the jailbreak app's Install IPAs row is a plain row of the list, not a grouped card, its tab kept", () => withDom(() => {
  const ul = topTable([{ label: "Install IPAs", subtitle: "3 IPAs", href: "#/installed/myipas", cls: "install-ipas-row" }], { tab: "home", path: [] });
  assert.equal(ul.tagName, "UL");
  assert.ok(ul.classList.contains("plain") && ul.classList.contains("installed-top"));
  assert.ok(!ul.classList.contains("grouped"), "no rounded card");
  const li = ul.querySelector(".install-ipas-row");
  assert.equal(li.dataset.tab, "home", "paintIpaRows redraws it on its own tab");
  assert.ok(li.querySelector(".cell-subtitle") && li.querySelector(".chevron"), "grey line and chevron as a package row");
}));

test("B291: packages.css draws the top rows at the wide package rows' height, edge to edge", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../packages.css", import.meta.url), "utf8");
  const { WIDE_ROW_HEIGHT } = await import("./browse.js");
  assert.match(css, new RegExp(`\\.table\\.installed-top > \\.cell > \\.cell-inner \\{ height: ${WIDE_ROW_HEIGHT}px;`));
  assert.doesNotMatch(css, /\.installed-top \{ margin-right/, "no inset card beside the A–Z index");
});

test("B52: a Delete under the Apps page updates the root's Apps count; the cell goes at 0", async () => {
  const body = withDom(() => { // the root's Apps cell as draw() makes it (B291: topTable)
    const b = document.createElement("div");
    b.append(topTable([{ label: "Install IPAs", subtitle: "3 IPAs", href: "#/installed/myipas", cls: "install-ipas-row" }, // F269
      { label: "Apps", subtitle: appsRowSubtitle(2), href: "#/installed/apps", cls: "installed-apps-row" }], { tab: "installed", path: [] }));
    return b;
  });
  const sub = () => body.querySelector(".installed-top").querySelector(".installed-apps-row").querySelector(".cell-subtitle").textContent;
  assert.equal(sub(), "2 apps installed from an app page");
  const view = { body, rows: [], appCount: 2, seq: 1 };
  let redraws = 0;
  const redraw = () => { redraws++; };
  await refreshAppCount({ view, mode: "jailbreak", count: async () => 1, redraw });
  assert.equal(view.appCount, 1);
  assert.equal(sub(), "1 app installed from an app page", "in place, the list keeps its scroll");
  assert.equal(redraws, 0);
  await refreshAppCount({ view, mode: "jailbreak", count: async () => 1, redraw });
  assert.equal(redraws, 0, "same count: nothing");
  await refreshAppCount({ view, mode: "jailbreak", count: async () => 0, redraw });
  assert.equal(view.appCount, 0);
  assert.equal(redraws, 1, "the cell goes: the page draws again");
  await refreshAppCount({ view, mode: "jailbreak", count: async () => 3, redraw });
  assert.equal(redraws, 2, "the cell comes back: the page draws again");
});

test("B52: no count refresh off the jailbreak app, before the root is drawn, or when load() runs meanwhile", async () => {
  let counted = 0;
  const count = async () => { counted++; return 5; };
  const fail = () => assert.fail("no redraw");
  await refreshAppCount({ view: { body: {}, rows: [], appCount: 1, seq: 0 }, mode: "sideload", count, redraw: fail });
  await refreshAppCount({ view: { body: null, appCount: 1, seq: 0 }, mode: "jailbreak", count, redraw: fail });
  await refreshAppCount({ view: { body: {}, appCount: 0, seq: 0 }, mode: "jailbreak", count, redraw: fail }); // rows not read yet
  assert.equal(counted, 0);
  const view = { body: {}, rows: [], appCount: 1, seq: 0 };
  await refreshAppCount({ view, mode: "jailbreak", count: async () => { view.seq++; return 5; }, redraw: fail });
  assert.equal(view.appCount, 1, "load()'s own count wins");
});

// ---- F269: the Install IPAs row at the top of Installed -------------------------------------------------------------
import { installIpasRow, loadIpaCounts } from "./installed.js";
import { libraryCounts as ipaCounts, ipaCountText } from "../core/myipas.js";

test("F269: the Install IPAs row: label, href, the not-installed count (none at 0), hidden while managing", () => {
  const row = installIpasRow(r(), { total: 7, notInstalled: 2 });
  assert.equal(row.label, "Install IPAs");
  assert.equal(row.href, "#/installed/myipas");
  assert.equal(row.subtitle, "7 IPAs · 2 not installed");
  assert.equal(row.badge, "2");
  assert.equal(row.cls, "install-ipas-row");
  assert.equal(row.icon.cls, "row-icon");
  assert.equal(row.hidden, false);
  assert.equal(installIpasRow(r(), { total: 3, notInstalled: 0 }).badge, undefined, "no badge at 0");
  assert.equal(installIpasRow(r(), { total: 3, notInstalled: 0 }).subtitle, "3 IPAs");
  assert.equal(installIpasRow(r(), null).badge, undefined, "nothing counted yet: no badge");
  assert.equal(installIpasRow(r(), { total: 7, notInstalled: 2 }, { managing: true }).hidden, true);
});

test("F269: the row's counts and subtitle", () => {
  assert.equal(ipaCountText({ total: 1, notInstalled: 1 }), "1 IPA · 1 not installed");
  assert.equal(ipaCountText({ total: 0, notInstalled: 0 }), "No IPAs yet");
  assert.equal(typeof ipaCountText(null), "string");
  const sections = [{ key: "notInstalled", rows: [{}, {}] }, { key: "installed", rows: [{}] }];
  assert.deepEqual(ipaCounts([{}, {}, {}], sections), { total: 3, notInstalled: 2 });
  assert.deepEqual(ipaCounts([{}], [{ key: "installed", rows: [{}] }]), { total: 1, notInstalled: 0 });
  assert.deepEqual(ipaCounts([], []), { total: 0, notInstalled: 0 });
});

test("F269: loadIpaCounts counts as the Install IPAs page does (phone's answer, broken IPAs not installed)", async () => {
  const list = [
    { file: "A.ipa", name: "A", bundleId: "a" }, { file: "B.ipa", name: "B", bundleId: "b" },
    { file: "C.ipa", name: "C", bundleId: "c" }, { file: "X.ipa", error: "Not an IPA" },
  ];
  const native = globalThis.ifizboxNative;
  globalThis.ifizboxNative = { call: async (m, p) => (m === "apps.isInstalled" ? { installed: { a: true, b: false, c: false } } : assert.fail(m)) };
  let painted = 0;
  try {
    const counts = await loadIpaCounts({ mode: "sideload", call: async () => ({ ipas: list }), paint: () => painted++ });
    assert.deepEqual(counts, { total: 4, notInstalled: 3 });
    assert.equal(painted, 1);
    assert.equal(installIpasRow(r(), counts).subtitle, "4 IPAs · 3 not installed");
    const failed = await loadIpaCounts({ mode: "sideload", call: async () => { throw new Error("no library"); }, paint: () => painted++ });
    assert.equal(failed, null, "a library that can't be read: no counts, no badge");
  } finally {
    globalThis.ifizboxNative = native;
  }
});
