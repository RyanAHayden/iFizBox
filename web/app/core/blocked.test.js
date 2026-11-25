// F226: Block packages and authors. The catalog leaves blocked packages out of Browse, Search, Sections and Changes;
// settings keep the list on the device, and in jailbreak mode a block on an installed package also holds it with dpkg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "../fakes.test-helper.js";
import { createCatalog, runCatalog } from "./catalog.js";
import { createSettings } from "./settings.js";
import { dayGroups } from "./changes.js";

const ARCH = "iphoneos-arm64";
const stanza = (id, name, author, section = "Tweaks") =>
  `Package: ${id}\nVersion: 1\nArchitecture: ${ARCH}\nSection: ${section}\nName: ${name}\nAuthor: ${author} <a@x>\nDescription: tweak ${name}\n`;

function catalog() {
  const c = createCatalog();
  c.load("deb:x", [stanza("one", "One", "Jane Doe"), stanza("two", "Two", "Sam"), stanza("three", "Three", "Sam", "Themes")].join("\n"), null, ARCH);
  return c;
}


// ifizbox-helper's hold/unhold/showhold (apt-mark), as settings.test.js fakes it.
function fakeHelper({ held = [], fail = new Set() } = {}) {
  const calls = [];
  const dpkg = new Set(held);
  const helper = async (words) => {
    calls.push(words.join(" "));
    const [verb, ...pkgs] = words;
    if (fail.has(verb)) return { code: 100, stdout: "" };
    if (verb === "hold") pkgs.forEach((p) => dpkg.add(p));
    else if (verb === "unhold") pkgs.forEach((p) => dpkg.delete(p));
    else if (verb === "showhold") return { code: 0, stdout: [...dpkg].map((p) => p + "\n").join("") };
    return { code: 0, stdout: "" };
  };
  return { helper, calls, dpkg };
}

test("a blocked package leaves lists, Sections, Search, Browse and the author page; its page still opens", () => {
  const c = catalog();
  assert.equal(c.setBlocked(["two", "", 7]), 1);
  assert.deepEqual(c.list().map((r) => r.id), ["one", "three"]);
  assert.deepEqual(c.list("*", "Tweaks").map((r) => r.id), ["one"]);
  assert.deepEqual(c.sections(), { total: 2, sections: [{ name: "Themes", count: 1 }, { name: "Tweaks", count: 1 }] });
  assert.deepEqual(c.search("tweak").map((r) => r.id).sort(), ["one", "three"]);
  assert.deepEqual(c.search("two"), []);
  assert.deepEqual(c.author("Sam").map((r) => r.id), ["three"]);
  assert.ok(!c.categories().some((cat) => cat.count === 3), "Browse counts leave it out");
  assert.ok(!c.popular().some((r) => r.id === "two"));
  assert.equal(c.package("two").stanza.package, "two"); // the page opens, to unblock it
  assert.equal(c.has(["two"]).length, 1); // still a dependency target
  c.setBlocked([]);
  assert.equal(c.list().length, 3);
});

test("the worker runs setBlocked by name", () => {
  const c = catalog();
  assert.equal(runCatalog(c, "setBlocked", [["one"]]), 1);
  assert.deepEqual(runCatalog(c, "list", ["*", "*"]).map((r) => r.id), ["three", "two"]);
});

test("Changes leaves a blocked package out (it draws from the visible list)", () => {
  const c = catalog();
  const now = Date.UTC(2026, 10, 18, 12);
  const records = [{ id: "x", version: "0", first: now - 9e8 }, // the first load, so later records count
    ...["one", "two"].map((id) => ({ id, version: "1", first: now - 1000 }))];
  assert.deepEqual(dayGroups(records, c.list(), { now }).flatMap((g) => g.rows.map((r) => r.id)).sort(), ["one", "two"]);
  c.setBlocked(["two"]);
  assert.deepEqual(dayGroups(records, c.list(), { now }).flatMap((g) => g.rows.map((r) => r.id)), ["one"]);
});

test("blocked authors are F104's hidden authors: one list", () => {
  const storage = memStorage();
  const s = createSettings({ storage });
  s.blocked.setAuthor("Jane Doe", true);
  assert.deepEqual(s.hiddenAuthors.list(), ["Jane Doe"]);
  assert.deepEqual(s.blocked.authors(), ["Jane Doe"]);
  assert.equal(s.blocked.hasAuthor("jane doe"), true);
  const c = catalog();
  c.setHiddenAuthors(s.blocked.authors());
  assert.deepEqual(c.list().map((r) => r.id), ["three", "two"]);
});

test("settings keep blocked packages on the device, with their names; listeners hear the ids", async () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "site" });
  const heard = [];
  s.onChange((k, v) => { if (k === "blockedPackages") heard.push(v); });
  assert.deepEqual(await s.blocked.set("com.b", true, { name: "Bee", installed: true }), { held: false }); // no dpkg on the site
  await s.blocked.set("com.a", true);
  await s.blocked.set("com.a", true, { name: "Ay" }); // a name later fills in, no second notice
  assert.deepEqual(s.blocked.list(), ["com.a", "com.b"]);
  assert.equal(s.blocked.has("com.b"), true);
  assert.equal(s.blocked.name("com.b"), "Bee");
  assert.deepEqual(s.blocked.entries(), [{ id: "com.a", name: "Ay" }, { id: "com.b", name: "Bee" }]);
  assert.deepEqual(heard, [["com.b"], ["com.a", "com.b"]]);
  // a new session reads the same list
  const again = createSettings({ storage, mode: "site" });
  assert.deepEqual(again.blocked.list(), ["com.a", "com.b"]);
  await again.blocked.set("com.b", false);
  assert.deepEqual(createSettings({ storage }).blocked.list(), ["com.a"]);
  assert.deepEqual(s.holds.list(), []); // the site never holds
  // a broken or hand-edited value reads as nothing, never breaks the app
  assert.deepEqual(createSettings({ storage: memStorage({ "ifizbox.blockedPackages": "{bad" }) }).blocked.list(), []);
  assert.deepEqual(createSettings({ storage: memStorage({ "ifizbox.blockedPackages": '["x"]' }) }).blocked.list(), []);
  assert.equal(createSettings({ storage: memStorage({ "ifizbox.blockedPackages": '{"x":5}' }) }).blocked.name("x"), "x");
});

test("sideload mode keeps the list on the device too, even with a helper given", async () => {
  const f = fakeHelper();
  const s = createSettings({ storage: memStorage(), mode: "sideload", helper: f.helper });
  assert.deepEqual(await s.blocked.set("com.a", true, { installed: true }), { held: false });
  assert.deepEqual(f.calls, []);
});

test("jailbreak: blocking an installed package holds it with dpkg; unblocking lifts only that hold", async () => {
  const f = fakeHelper({ held: ["mine"] });
  const storage = memStorage({ "ifizbox.holds": '["mine"]' });
  const s = createSettings({ storage, mode: "jailbreak", helper: f.helper });
  assert.deepEqual(await s.blocked.set("tweak", true, { installed: true }), { held: true });
  assert.deepEqual([...f.dpkg].sort(), ["mine", "tweak"]);
  assert.equal(s.blocked.heldByBlock("tweak"), true);
  assert.deepEqual(s.holds.list(), ["mine", "tweak"]);
  // not installed: nothing to hold
  assert.deepEqual(await s.blocked.set("other", true, { installed: false }), { held: false });
  // already held by Ignore Upgrades: the block leaves it, and so does unblocking
  assert.deepEqual(await s.blocked.set("mine", true, { installed: true }), { held: false });
  await s.blocked.set("mine", false);
  assert.ok(f.dpkg.has("mine"));
  // the block's own hold goes with it, also from a new session (the app relaunched)
  await createSettings({ storage, mode: "jailbreak", helper: f.helper }).blocked.set("tweak", false);
  assert.ok(!f.dpkg.has("tweak"));
  assert.equal(createSettings({ storage, mode: "jailbreak" }).blocked.heldByBlock("tweak"), false);
  assert.deepEqual(f.calls, ["hold tweak", "unhold tweak"]);
  assert.deepEqual(s.blocked.list(), ["other"]);
});

test("jailbreak: a refused hold still blocks, and says it is not held", async () => {
  const f = fakeHelper({ fail: new Set(["hold"]) });
  const s = createSettings({ storage: memStorage(), mode: "jailbreak", helper: f.helper });
  assert.deepEqual(await s.blocked.set("tweak", true, { installed: true }), { held: false });
  assert.equal(s.blocked.has("tweak"), true);
  assert.equal(s.blocked.heldByBlock("tweak"), false);
});

test("jailbreak: a blocked Oreo and dpkg's hold on oreo are one package", async () => {
  const f = fakeHelper();
  const dpkg = async (words) => f.helper(words.map((w) => w.toLowerCase())); // dpkg knows every name in lower case
  const storage = memStorage();
  const s = createSettings({ storage, mode: "jailbreak", helper: dpkg });
  assert.deepEqual(await s.blocked.set("Oreo", true, { name: "Oreo Theme", installed: true }), { held: true });
  assert.deepEqual([...f.dpkg], ["oreo"]);
  await s.holds.sync();
  assert.deepEqual(s.holds.list(), ["oreo"]);
  assert.equal(s.blocked.has("oreo"), true);
  assert.equal(s.blocked.name("OREO"), "Oreo Theme");
  assert.equal(s.blocked.heldByBlock("oreo"), true);
  await s.blocked.set("oreo", true, { installed: true }); // the same block, not a second one
  assert.deepEqual(s.blocked.entries(), [{ id: "Oreo", name: "Oreo Theme" }]);
  await s.blocked.set("oreo", false);
  assert.deepEqual(s.blocked.list(), []);
  assert.equal(s.blocked.heldByBlock("Oreo"), false);
  assert.deepEqual([...f.dpkg], []);
  assert.deepEqual(s.holds.list(), []);
});
