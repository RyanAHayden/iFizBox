// F218: the Confirm sheets' Cancel (it clears the queue) is the red bar button, ios6.css's .bar-button.red, with its
// pressed, dark and palette variants; nothing else uses it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { confirmCancel, openAppConfirm, openConfirm, initQueue } from "./queue.js";
import { helperRefusal, refusalIds } from "../core/queuerefusal.js";
import { parseSimulation } from "../core/queue.js";
import { getBackend } from "../backend.js";
import { catalog } from "../catalog.js";
import { installQueue } from "../queue.js";
import { appQueue } from "../app-queue.js";
import { createAppQueue } from "../core/appqueue.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

const here = new URL(".", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, here), "utf8");

function withDom(fn) {
  return async () => {
    const saved = globalThis.document;
    globalThis.document = fakeDom();
    try { await fn(globalThis.document); } finally { globalThis.document = saved; }
  };
}

const find = (e, pred) => (pred(e) ? e : e.children.map((c) => find(c, pred)).find(Boolean) ?? null);

test("confirmCancel is a red bar button reading Cancel", withDom(() => {
  const b = confirmCancel();
  assert.equal(b.tagName, "BUTTON");
  assert.equal(b.textContent, "Cancel");
  assert.ok(b.classList.contains("bar-button") && b.classList.contains("red"), b.className);
  assert.ok(!b.classList.contains("done"));
}));

test("the app Confirm sheet's left button is the red Cancel and Confirm stays blue Done", withDom((doc) => {
  const q = createAppQueue();
  q.add({ id: "com.x.a", name: "A", url: "https://s/a.ipa", size: 2048 });
  openAppConfirm(q);
  const sheet = find(doc.body, (e) => e._cls.has("confirm-sheet"));
  assert.ok(sheet, "Confirm opened");
  const left = find(sheet, (e) => e._cls.has("sheet-left"));
  const right = find(sheet, (e) => e._cls.has("sheet-right"));
  assert.equal(left.children.length, 1);
  assert.equal(left.children[0].textContent, "Cancel");
  assert.ok(left.children[0].classList.contains("red"), left.children[0].className);
  assert.ok(right.children[0].classList.contains("done") && !right.children[0].classList.contains("red"));
  left.children[0].click(); // Cancel clears the queue and closes the sheet
  assert.equal(q.size, 0);
}));

test("the package Confirm sheet (openConfirm) uses the red Cancel too", () => {
  const src = read("queue.js");
  const body = (name) => {
    const i = src.indexOf(`function ${name}(`);
    assert.ok(i >= 0, name);
    return src.slice(i, src.indexOf("\n}\n", i));
  };
  for (const fn of ["openConfirm", "openAppConfirm"]) assert.match(body(fn), /const cancel = confirmCancel\(\);/, fn);
  assert.match(body("openAppConfirm"), /modal\(\{ title: "Confirm", left: cancel,/);
});

// B224: the runs' Cancel (screens/queuerun.js, screens/apprun.js) is Cydia's plain black-bar one, as on the 4S; only
// Confirm's is red.
test("only Confirm's Cancel uses the red bar button", () => {
  const files = readdirSync(here).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  const navDir = new URL("../nav/", here);
  const hits = [];
  for (const f of files) if (/barButton\([^)]*["']red["']/.test(read(f))) hits.push(f);
  for (const f of readdirSync(navDir).filter((x) => x.endsWith(".js") && !x.endsWith(".test.js"))) {
    if (/barButton\([^)]*["']red["']/.test(readFileSync(new URL(f, navDir), "utf8"))) hits.push(`nav/${f}`);
  }
  assert.deepEqual(hits, ["queue.js"]);
  assert.equal(read("queue.js").match(/barButton\([^)]*["']red["']/g).length, 1);
  for (const f of ["queuerun.js", "apprun.js"]) assert.match(read(f), /const cancel = barButton\("Cancel"\);/, f);
});

test("ios6.css: .bar-button.red has a pressed state, dark variants, and a border-box gradient everywhere", () => {
  const css = read("../ios6.css");
  const rules = [
    ".bar-button.red:not(.back):not(.done) {",
    ".bar-button.red:not(.back):not(.done):is(:active, .is-pressed) {",
    'html[data-theme="dark"] .bar-button.red:not(.back):not(.done) {',
    'html[data-theme="dark"] .bar-button.red:not(.back):not(.done):is(:active, .is-pressed) {',
  ];
  for (const r of rules) {
    const i = css.indexOf(r);
    assert.ok(i >= 0, r);
    const block = css.slice(i, css.indexOf("}", i));
    assert.match(block, /background: var\(--(lt|dk)-red(-pressed)?\); background-origin: border-box;/, r);
    assert.match(block, /border-color: var\(--(lt|dk)-red(-pressed)?-edge\)/, r);
  }
  // UINavigationBarRemoveButton's colours (light) and ...Dark's split gloss
  assert.match(css, /--lt-red: linear-gradient\(#d4848b, #b01a27\);/);
  assert.match(css, /--dk-red: linear-gradient\(#d07079, #b82e3a 51\.7%, #b01825 51\.7%\);/);
  const pal = read("../palettes.css");
  // C49: the light palettes paint it through ios6.css's rule above, from the --lt-red* their blocks set
  assert.doesNotMatch(pal.replace(/\/\*[\s\S]*?\*\//g, ""), /\.bar-button\.red/);
  assert.match(pal, /html\[data-theme="light"\]\[data-palette="solarized"\] \{[^}]*--lt-red: /);
});

// ---- B404: Cannot Comply leaves the queue alone -------------------------------------------------------------------

const PLAN = "Inst com.x.good (1.0 Repo [iphoneos-arm64])\n";
const answer = (ok, output) => ({ ok, code: ok ? 0 : 100, plan: parseSimulation(ok ? output : ""), output });
const REFUSED = answer(false, " com.x.bad : Depends: com.x.gone but it is not installable\nE: Unable to correct problems, you have held broken packages.");
const helperError = (why) => new Error(`ifizbox-helper simulate failed (64): ifizbox-helper: ${why}`);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

// The package queue's sheet over com.x.bad and com.x.good (and an app), with `simulate` answering for apt.
// `history` stands in for catalog.history (F131's links).
function confirmCase(name, simulate, fn, { history = async () => null } = {}) {
  test(name, withDom(async (doc) => {
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 0;
    const saved = { history: catalog.history, queueInfo: catalog.queueInfo, aptProblems: catalog.aptProblems };
    Object.assign(catalog, { history, queueInfo: async () => ({ "com.x.bad": { name: "Viola White" } }),
      aptProblems: async () => [{ sentence: "Viola White needs com.x.gone, which none of your sources has.", action: { kind: "add-source", label: "Add Chariz", url: "https://repo.chariz.com/" } }] });
    const backend = getBackend();
    const asked = [];
    backend.simulate = (jobs) => { asked.push(jobs.map((j) => j.id)); return simulate(jobs, asked.length); };
    if (!confirmCase.ready) { confirmCase.ready = true; initQueue({}); }
    const sheet = () => doc.body.children.find((e) => e._cls.has("confirm-sheet"));
    try {
      installQueue.add({ op: "install", id: "com.x.bad" }, { quiet: true });
      installQueue.add({ op: "install", id: "com.x.good" }, { quiet: true });
      appQueue.add({ id: "com.x.app", name: "App", url: "https://s/a.ipa", size: 1 }, { quiet: true });
      openConfirm();
      await settle();
      const left = () => find(sheet(), (e) => e._cls.has("sheet-left")).children[0];
      const rows = () => sheet().querySelectorAll(".confirm-unqueue").map((li) => li.textContent);
      await fn({ sheet, left, rows, asked, title: () => sheet().querySelector("h1").textContent,
        tap: async (label) => { find(sheet(), (e) => e.tagName === "BUTTON" && e.textContent === label).click(); await settle(); },
        ok: () => find(sheet(), (e) => e._cls.has("sheet-right")).children[0] });
    } finally {
      installQueue.clearAll();
      appQueue.clearAll();
      await settle();
      const s = sheet();
      if (s) await find(s, (e) => e._cls.has("sheet-left")).children[0].click();
      await settle();
      Object.assign(catalog, saved);
      globalThis.requestAnimationFrame = raf;
    }
  }));
}

async function closeKeepsBoth({ sheet, left, tap }) {
  assert.equal(left().textContent, "Close");
  assert.ok(!left().classList.contains("red") && !left().classList.contains("done"));
  await tap("Close");
  assert.equal(sheet(), undefined);
  assert.deepEqual(installQueue.list().map((j) => j.id), ["com.x.bad", "com.x.good"]);
  assert.equal(appQueue.size, 1);
}

confirmCase("Close keeps both queues when the helper refuses", async () => { throw helperError("unknown package: com.x.bad"); }, async (c) => {
  assert.equal(c.title(), "Cannot Comply");
  assert.ok(c.ok().hidden);
  const text = c.sheet().querySelector(".sheet-scroll").textContent;
  assert.match(text, /Viola White \(com\.x\.bad\) isn't in apt's package lists/);
  assert.doesNotMatch(text, /ifizbox-helper|einstalling/);
  assert.deepEqual(c.rows(), ["Remove Viola White from Queue"]);
  assert.equal(c.sheet().querySelectorAll(".confirm-problem .cell-label").length, 0, "the sentence is a wrapping block, not a one-line label");
  await closeKeepsBoth(c);
});

confirmCase("Close keeps both queues when apt refuses; its own fixes stay", async () => REFUSED, async (c) => {
  assert.equal(c.title(), "Cannot Comply");
  assert.ok(find(c.sheet(), (e) => e._cls.has("cell-label") && e.textContent === "Add Chariz"), "drawIssues' action");
  assert.deepEqual(c.rows(), ["Remove Viola White from Queue"]);
  await closeKeepsBoth(c);
});

{
  let answerNow;
  confirmCase("Close keeps both queues while apt is asked, and a late answer queues nothing",
    () => new Promise((r) => { answerNow = r; }), async (c) => {
      await closeKeepsBoth(c);
      answerNow(answer(true, `${PLAN}Inst com.x.linked (1.0 Repo [iphoneos-arm64])\n`));
      await settle();
      assert.equal(c.sheet(), undefined, "no sheet comes back");
      assert.equal(installQueue.size, 2);
    });
}

{
  let historyNow, held = false;
  confirmCase("Close while a linked dependency is looked up queues nothing",
    async () => { held = true; return answer(true, "Inst com.x.linked (1.0 Repo [iphoneos-arm64])\n"); }, async (c) => {
      await closeKeepsBoth(c);
      historyNow({ kind: "apt", versions: [{ version: "1.0", keys: ["k"], filename: "https://e.x/a.deb", debUrl: "https://e.x/a.deb", candidate: true }] });
      await settle();
      assert.equal(installQueue.size, 2);
      assert.equal(c.sheet(), undefined);
    }, { history: () => (held ? new Promise((r) => { historyNow = r; }) : Promise.resolve(null)) });
}

confirmCase("Remove takes one package out and asks apt again; Cancel still clears on the agreed plan",
  async (jobs) => (jobs.some((j) => j.id === "com.x.bad") ? REFUSED : answer(true, PLAN)), async (c) => {
    await c.tap("Remove Viola White from Queue");
    assert.deepEqual(installQueue.list().map((j) => j.id), ["com.x.good"]);
    assert.deepEqual(c.asked, [["com.x.bad", "com.x.good"], ["com.x.good"]]);
    assert.equal(appQueue.size, 1);
    assert.equal(c.title(), "Confirm");
    assert.equal(c.ok().hidden, false);
    assert.equal(c.left().textContent, "Cancel");
    assert.ok(c.left().classList.contains("red"));
    await c.tap("Cancel");
    assert.equal(c.sheet(), undefined);
    assert.equal(installQueue.size, 0);
    assert.equal(appQueue.size, 0);
  });

confirmCase("no package named: a row per queued package", async () => answer(false, "E: Could not get lock /var/lib/dpkg/lock"), async (c) => {
  assert.deepEqual(c.rows(), ["Remove Viola White from Queue", "Remove com.x.good from Queue"]);
});

confirmCase("a missing helper says reinstalling puts it back", async () => { throw new Error("ifizbox-helper is not installed at /var/jb/x"); }, async (c) => {
  assert.match(c.sheet().querySelector(".sheet-scroll").textContent, /Reinstalling .* puts it back/);
  assert.equal(c.rows().length, 2);
  await closeKeepsBoth(c);
});

const inst = (id, more) => ({ op: "install", id, version: null, ...more });

test("helperRefusal: which package and why, by the helper's own rule", () => {
  const jobs = [inst("com.b.violaWhite", { name: "Viola White" }), inst("com.x.ok", { version: "v2" }), { op: "remove", id: "com.x.rm" }];
  const bad = helperRefusal(helperError("bad package name (allowed: [a-z0-9][a-z0-9.+-]+)").message, jobs);
  assert.deepEqual(bad.ids, ["com.b.violaWhite"]);
  assert.match(bad.sentences[0], /^Viola White \(com\.b\.violaWhite\) can't be handed to apt: its package ID has capital letters /);
  assert.deepEqual(helperRefusal(helperError("bad version (a digit, then [A-Za-z0-9.+~:-])").message, jobs).ids, ["com.x.ok"]);
  const rm = helperRefusal(helperError("unknown package: com.x.rm").message, jobs);
  assert.deepEqual([rm.ids, rm.sentences], [["com.x.rm"], ["com.x.rm isn't installed, so it can't be removed."]]);
  const other = helperRefusal(helperError("the calling process isn't the installed app").message, jobs);
  assert.deepEqual([other.ids, other.missing], [[], false]);
  assert.match(other.sentences[0], /isn't the installed /);
});

test("refusalIds: the queued packages apt's refusal names", () => {
  const jobs = [inst("com.a"), inst("com.B"), { op: "remove", id: "com.c" }, inst("com.d", { debUrl: "https://e.x/d.deb" })];
  const ids = (output, more = {}) => refusalIds({ output, plan: parseSimulation(output), ...more }, jobs);
  assert.deepEqual(ids("E: Unable to locate package com.b"), ["com.B"], "apt prints names in lowercase");
  assert.deepEqual(ids("E: Version '9' for 'com.a' was not found"), ["com.a"]);
  assert.deepEqual(ids("E: Package 'com.a' has no installation candidate"), ["com.a"]);
  assert.deepEqual(ids(" com.a : Conflicts: com.b but 1 is to be installed"), ["com.a", "com.B"]);
  assert.deepEqual(ids(" com.a : Depends: com.b but it is not going to be installed\n          Depends: com.c but it is not going to be installed"), ["com.a", "com.c"]);
  assert.deepEqual(ids("", { issues: ["Couldn't download D from https://e.x/d.deb, where its source says it is: no"] }), ["com.d"]);
  assert.deepEqual(ids("WARNING: The following essential packages will be removed.\nThis should NOT be done unless you know exactly what you are doing!\n  dpkg tar (due to com.c)\nE: Essential packages were removed"), ["com.c"]);
  assert.deepEqual(ids(" com.a:iphoneos-arm64 : Depends: com.gone but it is not installable"), ["com.a"]);
  assert.deepEqual(ids("E: Could not get lock"), []);
});
