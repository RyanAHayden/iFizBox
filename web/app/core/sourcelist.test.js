import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportText, exportLine, parseImport, reviewImport, entryKeys, orderSources, loadOrder, saveOrder, altLink, ORDER_KEY,
  clipboardText, recommendedRows, recommendedSeed, recommendedInput, listedSource,
} from "./sourcelist.js";
import { loadTweakSources, loadAppSources } from "./sources.js";

const DEFAULT_SOURCES = await loadTweakSources(); // web/app/tweak-sources.json
const DEFAULT_ALT_SOURCES = await loadAppSources(); // web/app/app-sources.json
import { seedRecord, normalizeAltUrl, looksLikeAltUrl } from "./altstore.js";
import * as recommended from "./recommended.js";

const { RECOMMENDED_SOURCES } = recommended;
import { qrMatrix, qrSvg } from "./qr.js";

const ALT = DEFAULT_ALT_SOURCES.map(seedRecord);
const ALL = [...DEFAULT_SOURCES, ...ALT];

test("export writes one line per source: a URL, or a deb line for a dist repo", () => {
  const text = exportText(ALL, { date: new Date("2026-11-17T12:00:00Z") });
  const lines = text.trim().split("\n");
  assert.equal(lines[0], `# iFizBox sources (${ALL.length}), 2026-11-17`);
  assert.ok(lines.includes("deb https://apt.procurs.us/ 1800 main"));
  assert.ok(lines.includes("https://repo.chariz.com/"));
  assert.ok(lines.includes("https://fizl0.github.io/apps/source.json"));
  assert.equal(exportLine({ key: "alt:https://alt.crystall1ne.dev/", uri: "https://alt.crystall1ne.dev/" }), "https://alt.crystall1ne.dev/");
});

test("export and import round trip: every exported source comes back as already listed", () => {
  const { format, entries } = parseImport(exportText(ALL));
  assert.equal(format, "lines");
  assert.equal(entries.length, ALL.length);
  const reviewed = reviewImport(entries, ALL);
  assert.deepEqual(reviewed.filter((e) => e.status !== "listed").map((e) => e.uri), []);
  // Each source's key is among the keys its entry could be stored under.
  for (const s of ALL) assert.ok(entries.some((e) => entryKeys(e).includes(s.key)), s.key);
});

test("import into an empty list: every source is new, dist repos too (F48)", () => {
  const reviewed = reviewImport(parseImport(exportText(ALL)).entries, []);
  const by = (st) => reviewed.filter((e) => e.status === st).map((e) => e.uri);
  assert.deepEqual(by("unsupported"), []);
  assert.equal(by("new").length, ALL.length);
  const procursus = reviewed.find((e) => e.uri === "https://apt.procurs.us/");
  assert.deepEqual(procursus.input, { uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] });
  for (const e of reviewed.filter((x) => x.status === "new")) assert.ok(e.input);
});

test("plain pasted text: URLs anywhere in a line, links, comments, repeats dropped", () => {
  const { entries } = parseImport([
    "My sources:",
    "  https://repo.example.com/  and https://example.org/apps.json,",
    "# https://commented.example.com/",
    "altstore://source?url=https%3A%2F%2Fapps.altstore.io%2F",
    "https://repo.example.com/",
    "repo.bare.com",
  ].join("\n"));
  assert.deepEqual(entries.map((e) => [e.kind, e.uri]), [
    ["any", "https://repo.example.com/"],
    ["altstore", "https://example.org/apps.json"],
    ["altstore", "https://apps.altstore.io/"],
  ]);
  assert.equal(entries[1].input, altLink("https://example.org/apps.json"));
});

test("an AltStore entry's input goes to AltStore and keeps its URL", () => {
  const input = altLink("https://apps.altstore.io/");
  assert.ok(looksLikeAltUrl(input));
  assert.equal(normalizeAltUrl(input), "https://apps.altstore.io/");
});

test("Cydia's sources.list.d/cydia.list", () => {
  const { format, entries } = parseImport([
    "deb http://apt.saurik.com/ ios/1800.00 main",
    "deb https://repo.chariz.com/ ./",
    "deb-src https://src.example.com/ ./",
    "deb [arch=iphoneos-arm64] https://havoc.app ./",
  ].join("\n"));
  assert.equal(format, "list");
  assert.deepEqual(entries.map((e) => [e.uri, e.dist, e.components, e.input]), [
    ["http://apt.saurik.com/", "ios/1800.00", ["main"], { uri: "http://apt.saurik.com/", dist: "ios/1800.00", components: ["main"] }],
    ["https://repo.chariz.com/", "./", [], "https://repo.chariz.com/"],
    ["https://havoc.app/", "./", [], "https://havoc.app/"],
  ]);
  const r = reviewImport(entries, DEFAULT_SOURCES);
  // Telesphoreo isn't a default (rootful only): new; Chariz and Havoc are listed.
  assert.deepEqual(r.map((e) => e.status), ["new", "listed", "listed"]);
});

test("Sileo's sileo.sources (deb822)", () => {
  const { format, entries } = parseImport([
    "Types: deb",
    "URIs: https://repo.chariz.com/",
    "Suites: ./",
    "Components:",
    "",
    "Types: deb",
    "URIs: https://apt.procurs.us/",
    "Suites: 1800",
    "Components: main",
    "",
    "Types: deb",
    "URIs: https://disabled.example.com/",
    "Suites: ./",
    "Enabled: no",
  ].join("\n"));
  assert.equal(format, "deb822");
  assert.deepEqual(entries.map((e) => [e.uri, e.dist]), [["https://repo.chariz.com/", "./"], ["https://apt.procurs.us/", "1800"]]);
  assert.deepEqual(reviewImport(entries, []).map((e) => e.status), ["new", "new"]);
});

test("AltStore, SideStore and Feather JSON lists", () => {
  const urls = (text) => parseImport(text).entries.map((e) => [e.kind, e.uri]);
  assert.deepEqual(urls('["https://a.example.com/apps.json", "https://b.example.com/"]'),
    [["altstore", "https://a.example.com/apps.json"], ["any", "https://b.example.com/"]]);
  // objects with url / sourceURL / identifier, as sideloaders keep their sources
  assert.deepEqual(urls(JSON.stringify({ sources: [
    { name: "A", sourceURL: "https://a.example.com/" },
    { identifier: "b", url: "https://b.example.com/x" },
    { name: "no url" },
  ] })), [["altstore", "https://a.example.com/"], ["altstore", "https://b.example.com/x"]]);
  // an AltStore source file names its own URL
  assert.deepEqual(urls(JSON.stringify({ name: "S", sourceURL: "https://s.example.com/s", apps: [] })), [["altstore", "https://s.example.com/s"]]);
  assert.deepEqual(urls(JSON.stringify({ name: "S", apps: [] })), []);
  assert.deepEqual(parseImport("{not json").entries, []);
});

test("an AltStore source listed without its trailing slash still counts as listed", () => {
  const list = [seedRecord("https://repository.apptesters.org/")];
  const [e] = reviewImport(parseImport('["https://repository.apptesters.org"]').entries, list);
  assert.equal(e.status, "listed");
});

test("orderSources: saved keys first in their order, newer sources after", () => {
  const list = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  assert.deepEqual(orderSources(list, ["c", "gone", "a"]).map((s) => s.key), ["c", "a", "b", "d"]);
  assert.equal(orderSources(list, null), list);
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(loadOrder(storage), null);
  saveOrder(["c", "a"], storage);
  assert.deepEqual(loadOrder(storage), ["c", "a"]);
  saveOrder(null, storage);
  assert.equal(mem.has(ORDER_KEY), false);
});

test("the recommended list: each entry has a reason and an addable URL, and no games (F52)", () => {
  for (const r of RECOMMENDED_SOURCES) {
    assert.ok(r.why && r.why.length > 10, r.name);
    assert.ok(normalizeAltUrl(r.url), r.url);
    assert.equal(r.kind, "source", r.name);
  }
  assert.equal(recommended.RECOMMENDED_GAMES, undefined);
});

test("Copy to Clipboard: one URL (or deb line) per line, no header, each source once (F52)", () => {
  const text = clipboardText([...ALL, ALL[0], { key: "x" }]);
  const lines = text.split("\n");
  assert.equal(lines.length, ALL.length);
  assert.ok(lines.every((l) => /^(https?:\/\/|deb )/.test(l)), text);
  assert.ok(lines.includes("https://repo.chariz.com/"));
  assert.ok(lines.includes("deb https://apt.procurs.us/ 1800 main"));
  assert.deepEqual(clipboardText([]), "");
  // It reads back as an import of the same sources.
  assert.equal(reviewImport(parseImport(text).entries, ALL).filter((e) => e.status !== "listed").length, 0);
});

const REC = [
  { kind: "source", name: "FIZL0", url: "https://fizl0.github.io/apps/source.json", why: "x" },
  { kind: "source", name: "Plain", url: "https://example.com/apps.json", why: "x" },
  { kind: "source", name: "Chariz", url: "https://repo.chariz.com/", jailbreak: true, why: "x" },
];

test("recommended rows: icon falls back to the source's own, then the GitHub avatar, then none (the letter)", () => {
  const rows = recommendedRows(REC, []);
  const by = (n) => rows.find((r) => r.label === n);
  assert.deepEqual(by("FIZL0").icons, ["https://github.com/fizl0.png?size=120"]); // no iconURL yet: avatar
  assert.equal(by("FIZL0").subtitle, "github.com/fizl0/apps");
  assert.deepEqual(by("Plain").icons, []); // not on GitHub, nothing read: the letter
  assert.equal(by("Plain").subtitle, "https://example.com/apps.json");
  assert.deepEqual(by("Chariz").icons, ["https://repo.chariz.com/CydiaIcon.png"]);
  for (const r of rows) { assert.equal(r.added, false); assert.equal(r.count, null); }
  // Once its JSON is read (a preview), the source's own icon wins and the app count shows.
  const previews = new Map([["alt:https://fizl0.github.io/apps/source.json", { iconURL: "https://fizl0.github.io/icon.png", count: 3 }],
    ["alt:https://example.com/apps.json", { iconURL: null, count: 0 }]]);
  const loaded = recommendedRows(REC, [], { previews });
  assert.deepEqual(loaded[0].icons, ["https://fizl0.github.io/icon.png"]);
  assert.equal(loaded[0].count, 3);
  assert.deepEqual(loaded[1].icons, []);
  assert.equal(loaded[1].count, 0);
});

test("recommended rows: Added once the source is listed, drawn from the listed record", () => {
  const sources = [
    { key: "alt:https://fizl0.github.io/apps/source.json", kind: "altstore", uri: "https://fizl0.github.io/apps/source.json",
      name: "FIZL0", iconURL: "https://fizl0.github.io/own.png", count: 7 },
    { key: "deb:https://repo.chariz.com/:./", uri: "https://repo.chariz.com/", dist: "./", count: 412 },
  ];
  const rows = recommendedRows(REC, sources);
  assert.deepEqual(rows.map((r) => r.added), [true, false, true]);
  assert.deepEqual(rows[0].icons, ["https://fizl0.github.io/own.png"]);
  assert.equal(rows[0].count, 7);
  assert.equal(rows[2].count, 412);
  assert.equal(rows[2].key, "deb:https://repo.chariz.com/:./");
  // A trailing-slash twin counts as listed.
  assert.ok(listedSource({ url: "https://example.com/apps.json/" }, [{ key: "alt:https://example.com/apps.json", uri: "https://example.com/apps.json" }]));
  // Not Jailbroken: tweak repos are left out.
  assert.deepEqual(recommendedRows(REC, [], { jailbroken: false }).map((r) => r.label), ["FIZL0", "Plain"]);
});

test("recommended input and seed: AltStore entries go straight to AltStore, APT ones as a URL", () => {
  assert.equal(recommendedInput(REC[0]), altLink("https://fizl0.github.io/apps/source.json"));
  assert.equal(recommendedInput(REC[2]), "https://repo.chariz.com/");
  assert.equal(recommendedSeed(REC[2]).key, "deb:https://repo.chariz.com/:./");
  for (const r of RECOMMENDED_SOURCES) assert.ok(recommendedSeed(r).key.includes(":"), r.name);
});

test("QR: sizes grow with the text, and a list too long for version 40 throws", () => {
  assert.equal(qrMatrix("hi").size, 21);
  assert.equal(qrMatrix("x".repeat(100), { ecc: "L" }).version, 5); // v5-L holds 106 bytes
  assert.throws(() => qrMatrix("x".repeat(3000)), /Too long/);
  assert.match(qrSvg("hi"), /^<svg[^>]+viewBox="0 0 29 29"/);
});

// zbarimg (zbar-tools) reads the codes back where it is installed; elsewhere this is skipped.
let zbar = true;
try { execFileSync("zbarimg", ["--version"], { stdio: "ignore" }); } catch { zbar = false; }
test("QR: zbarimg decodes the export of the default list", { skip: !zbar && "zbarimg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ifizbox-qr-"));
  try {
    for (const [text, ecc] of [[exportText(ALL), "M"], ["héllo · https://example.com/", "L"], ["https://repo.chariz.com/", "M"]]) {
      const m = qrMatrix(text, { ecc });
      const sc = 3, q = 4, n = (m.size + 2 * q) * sc;
      const rows = [];
      for (let y = 0; y < n; y++) {
        let r = "";
        for (let x = 0; x < n; x++) r += m.get(Math.floor(x / sc) - q, Math.floor(y / sc) - q) ? "1" : "0";
        rows.push(r);
      }
      const file = join(dir, "q.pbm");
      writeFileSync(file, `P1\n${n} ${n}\n${rows.join("\n")}\n`);
      const got = execFileSync("zbarimg", ["-q", "--raw", file], { encoding: "utf8" });
      assert.equal(got.replace(/\n+$/, ""), text.replace(/\n+$/, ""));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- F54: a tweak repo's preview -------------------------------------------------------------------------------

test("packagePreview: this arch, visible, newest version, sections and names A to Z", async () => {
  const { packagePreview } = await import("./sourcelist.js");
  const { parsePackages } = await import("./apt.js");
  const text = [
    "Package: com.a.zeta\nName: Zeta\nVersion: 1.0\nArchitecture: iphoneos-arm64\nSection: Tweaks\nDescription: old\n",
    "Package: com.a.zeta\nName: Zeta\nVersion: 1.2\nArchitecture: iphoneos-arm64\nSection: Tweaks\nDescription: new one\n long text\nIcon: icons/z.png\n",
    "Package: com.a.alpha\nName: alpha\nVersion: 2\nArchitecture: all\nSection: Tweaks\nTag: cydia::commercial\n",
    "Package: com.a.rootful\nName: Rootful\nVersion: 1\nArchitecture: iphoneos-arm\nSection: Tweaks\n",
    "Package: com.a.lib\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Development\nTag: role::cydia\n",
    "Package: com.a.theme\nName: Glass\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Themes_(SpringBoard)\n",
    "Package: com.a.none\nName: Loose\nVersion: 1\nArchitecture: iphoneos-arm64\n",
  ].join("\n");
  const p = packagePreview(parsePackages(text, "https://repo.example/"), "iphoneos-arm64");
  assert.equal(p.total, 4);
  assert.deepEqual(p.sections.map((s) => s.name), ["(No Section)", "Themes (SpringBoard)", "Tweaks"]);
  const tweaks = p.sections.at(-1).packages;
  assert.deepEqual(tweaks.map((r) => r.name), ["alpha", "Zeta"]);
  assert.equal(tweaks[0].paid, true);
  assert.equal(tweaks[1].short, "new one");
  assert.equal(tweaks[1].icon, "https://repo.example/icons/z.png");
  assert.equal(packagePreview(parsePackages(text, null), "iphoneos-arm").total, 2); // rootful: Rootful and alpha (all), none of the arm64 ones
  assert.deepEqual(packagePreview([], "iphoneos-arm64"), { total: 0, sections: [] });
});
