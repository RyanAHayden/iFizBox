// F210: the app page's one-tap Installed toggle in the nav bar (screens/altstore.js markToggle, nav/navbar.js
// addNavIcon): a tap marks the app installed at the source's latest version, a second tap forgets it, and the icon
// follows the record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { markToggle, toggleMarked, markToggleApplies, handMarking, MARK_INSTALLED_LABEL, MARK_NOT_INSTALLED_LABEL } from "./altstore.js";
import { addNavIcon } from "../nav/navbar.js";
import { pageHandle } from "../nav/go.js";
import { memoryAppStore, recordInstall, removeInstall } from "../core/installed.js";
import { BUNDLE_ID, GITHUB_REPO, NAME } from "../brand.js";

import { fakeDocument, withDocument } from "../fakes.test-helper.js";

const fakeElement = (tag) => fakeDocument().createElement(tag);

const APP = { bundleIdentifier: "com.x.a", name: "A", sourceUrl: "https://s/apps.json", sourceName: "S", iconURL: "https://s/a.png",
  versions: [{ version: "2.1", downloadURL: "https://s/a2.ipa" }, { version: "2.0", downloadURL: "https://s/a1.ipa" }] };
const PKG = { key: "alt:https://s/apps.json", row: { id: "com.x.a" }, stanza: { kind: "ipa", ipa: APP } };

test("toggleMarked: the first tap records the source's latest version, the second forgets it", async () => {
  const mem = memoryAppStore([{ id: "com.x.b", version: "1" }]);
  assert.equal(await toggleMarked(APP, PKG, null, { store: async () => mem }), true);
  const rec = (await mem.all()).find((r) => r.id === "com.x.a");
  assert.equal(rec.version, "2.1");
  assert.equal(rec.key, PKG.key);
  assert.equal(rec.sourceName, "S");
  assert.equal(rec.icon, APP.iconURL);
  assert.equal(await toggleMarked(APP, PKG, null, { store: async () => mem }), false);
  assert.deepEqual((await mem.all()).map((r) => r.id), ["com.x.b"]);
});

test("markToggle: outline and 'Mark as Installed' until marked, filled and 'Mark as Not Installed' after; HUD and haptic each tap", async () => {
  await withDocument(async () => {
    const mem = memoryAppStore();
    const said = [];
    let buzzes = 0;
    const b = markToggle(APP, PKG, null, { store: async () => mem, buzz: () => { buzzes += 1; }, feedback: (t) => said.push(t) });
    await b.refreshed;
    assert.equal(b.tagName, "BUTTON");
    for (const c of ["bar-button", "bar-icon", "mark-toggle"]) assert.ok(b.classList.contains(c), c);
    assert.equal(b.classList.contains("is-marked"), false);
    assert.equal(b.getAttribute("aria-label"), MARK_INSTALLED_LABEL);

    await b.click();
    assert.equal((await mem.all())[0].version, "2.1", "marked at the latest version, no picker");
    assert.ok(b.classList.contains("is-marked"));
    assert.equal(b.getAttribute("aria-label"), MARK_NOT_INSTALLED_LABEL);

    await b.click();
    assert.deepEqual(await mem.all(), []);
    assert.equal(b.classList.contains("is-marked"), false);
    assert.equal(b.getAttribute("aria-label"), MARK_INSTALLED_LABEL);
    assert.deepEqual(said, ["Marked as Installed", "Marked as Not Installed"]);
    assert.equal(buzzes, 2);

    // The record changed elsewhere (an install, the Tracking section's rows): refresh follows it.
    await recordInstall(mem, { id: "com.x.a", version: "1.0" });
    await b.refresh();
    assert.ok(b.classList.contains("is-marked"));
    await removeInstall(mem, "com.x.a");
    await b.refresh();
    assert.equal(b.classList.contains("is-marked"), false);

    // Installed by iFizBox at an older version: filled, and a tap forgets it (not re-marked at the latest).
    await recordInstall(mem, { id: "com.x.a", version: "2.0" });
    const c = markToggle(APP, PKG, null, { store: async () => mem, buzz() {}, feedback() {} });
    await c.refreshed;
    assert.ok(c.classList.contains("is-marked"));
    await c.click();
    assert.deepEqual(await mem.all(), []);
  });
});

test("markToggle: no store, nothing changes and no HUD claims it did", async () => {
  await withDocument(async () => {
    const said = [];
    const b = markToggle(APP, PKG, null, { store: async () => { throw new Error("no IndexedDB"); }, buzz() {}, feedback: (t) => said.push(t) });
    await b.refreshed;
    await b.click();
    assert.deepEqual(said, []);
    assert.equal(b.classList.contains("is-marked"), false);
  });
});

test("markToggleApplies: hidden for iFizBox's own app and an app with no version to mark", () => {
  assert.equal(markToggleApplies(APP), true);
  assert.equal(markToggleApplies({ ...APP, bundleIdentifier: BUNDLE_ID }), false);
  assert.equal(markToggleApplies({ ...APP, bundleIdentifier: `${BUNDLE_ID}.lite` }), false);
  assert.equal(markToggleApplies({ ...APP, versions: [{ version: "1", downloadURL: `https://github.com/${GITHUB_REPO}/releases/latest/download/${NAME}.ipa` }] }), false);
  assert.equal(markToggleApplies({ ...APP, bundleIdentifier: "" }), false);
  assert.equal(markToggleApplies({ ...APP, versions: [] }), false);
  assert.equal(markToggleApplies(null), false);
});

test("addNavIcon: after Install in the DOM (setRightLabel still finds Install first), ordered left of it; a redraw replaces it", async () => {
  const right = fakeElement("div");
  right.querySelector = () => null;
  right.querySelectorAll = () => right.children.filter((c) => c.classList.contains("nav-icon-left"));
  const item = fakeElement("div");
  item.querySelector = (s) => (s === ".nav-right" ? right : null);
  const share = fakeElement("button");
  share.className = "bar-button bar-icon share-button";
  const install = fakeElement("button");
  install.className = "bar-button";
  right.append(share, install);
  const body = {};
  pageHandle(item, body); // the page's nav item, as app.js hands it in (navbar.js finds it with handleOf)
  const doc = Object.assign(fakeDocument(), { querySelectorAll: () => { throw new Error("navbar.js looks its nav item up by handle, not by selector"); } });
  await withDocument(() => {
    const icon = fakeElement("button");
    assert.equal(addNavIcon(body, icon, "mark"), true);
    assert.deepEqual(right.children, [share, install, icon]);
    assert.ok(icon.classList.contains("nav-icon-left"));
    assert.ok(install.classList.contains("nav-after-icon"));
    assert.equal(share.classList.contains("nav-after-icon"), false);
    assert.ok(item.classList.contains("has-nav-icon"));
    const again = fakeElement("button");
    addNavIcon(body, again, "mark");
    assert.deepEqual(right.children, [share, install, again], "the page drawn again: one toggle");
    assert.equal(addNavIcon({ closest: () => null }, fakeElement("button")), false, "no nav item yet");
  }, doc);
});

// F242: the jailbreak app can tell what's installed, so it has no hand marking: no nav toggle, no Mark rows. The
// sideload app and the website keep both.
test("handMarking / markToggleApplies: the site and the sideload build mark by hand, the jailbreak build doesn't", () => {
  assert.equal(handMarking("site"), true);
  assert.equal(handMarking("sideload"), true);
  assert.equal(handMarking("jailbreak"), false);
  assert.equal(markToggleApplies(APP, { mode: "site" }), true);
  assert.equal(markToggleApplies(APP, { mode: "sideload" }), true);
  assert.equal(markToggleApplies(APP, { mode: "jailbreak" }), false);
  assert.equal(markToggleApplies({ ...APP, bundleIdentifier: BUNDLE_ID }, { mode: "sideload" }), false, "iFizBox itself stays hidden");
});

test("handMarking follows the build the page runs in (detectMode: no native bridge is the site)", () => {
  const saved = globalThis.ifizboxNative;
  try {
    delete globalThis.ifizboxNative;
    assert.equal(handMarking(), true);
    assert.equal(markToggleApplies(APP), true);
    globalThis.ifizboxNative = { mode: "sideload" };
    assert.equal(handMarking(), true);
    assert.equal(markToggleApplies(APP), true);
    globalThis.ifizboxNative = { mode: "jailbreak" };
    assert.equal(handMarking(), false);
    assert.equal(markToggleApplies(APP), false);
  } finally {
    if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved;
  }
});

// F242a: the jailbreak build's nav bar has a queue toggle where the mark toggle sits elsewhere: + puts the app in the
// app queue quietly (haptic, undo bar), x takes it back out, and it follows the queue.
import { queueToggle, queueToggleApplies, queueToggleJob, queueToggleMessage, QUEUE_ADD_LABEL, QUEUE_REMOVE_LABEL } from "./altstore.js";
import { createAppQueue } from "../core/appqueue.js";

test("queueToggleApplies: the jailbreak build only (with the helper), never iFizBox itself; the mark toggle is the other builds'", () => {
  assert.equal(queueToggleApplies(APP, { mode: "jailbreak", available: true }), true);
  assert.equal(queueToggleApplies(APP, { mode: "jailbreak", available: false }), false, "no native bridge: nothing installs it");
  assert.equal(queueToggleApplies(APP, { mode: "sideload", available: true }), false);
  assert.equal(queueToggleApplies(APP, { mode: "site", available: true }), false);
  assert.equal(queueToggleApplies({ ...APP, bundleIdentifier: BUNDLE_ID }, { mode: "jailbreak", available: true }), false);
  assert.equal(queueToggleApplies({ ...APP, bundleIdentifier: `${BUNDLE_ID}.lite` }, { mode: "jailbreak", available: true }), false);
  assert.equal(queueToggleApplies({ ...APP, bundleIdentifier: "" }, { mode: "jailbreak", available: true }), false);
  assert.equal(queueToggleApplies(null, { mode: "jailbreak", available: true }), false);
  // one toggle per build: the jailbreak build has this one and no mark toggle, the others the mark toggle only
  for (const mode of ["jailbreak", "sideload", "site"]) {
    const n = Number(queueToggleApplies(APP, { mode, available: true })) + Number(markToggleApplies(APP, { mode }));
    assert.equal(n, 1, mode);
  }
});

test("queueToggleJob: the newest version, Install when not installed, Upgrade or Reinstall from the record", async () => {
  const mem = memoryAppStore();
  const store = async () => mem;
  let j = await queueToggleJob(PKG, null, { store });
  assert.equal(j.app, "install");
  assert.equal(j.id, "com.x.a");
  assert.equal(j.version, "2.1");
  assert.equal(j.url, "https://s/a2.ipa");
  assert.equal(j.installed, null);
  await recordInstall(mem, { id: "com.x.a", version: "2.0" });
  j = await queueToggleJob(PKG, null, { store });
  assert.equal(j.installed, "2.0");
  assert.equal(createAppQueue().add(j).mode, "upgrade");
  await recordInstall(mem, { id: "com.x.a", version: "2.1" });
  assert.equal(createAppQueue().add(await queueToggleJob(PKG, null, { store })).mode, "reinstall");
  assert.equal(await queueToggleJob({ stanza: { ipa: { ...APP, versions: [] } } }, null, { store }), null);
});

test("queueToggleMessage words it as a row's swipe does", () => {
  assert.equal(queueToggleMessage({ mode: "install" }, "A", true), "Install A queued");
  assert.equal(queueToggleMessage({ mode: "upgrade" }, "A", false), "Upgrade A cancelled");
  assert.equal(queueToggleMessage({ mode: "remove" }, "A", false), "Remove A cancelled");
  assert.equal(queueToggleMessage(null, "A", true), "Install A queued");
});

test("queueToggle: + queues quietly with a haptic and undo bar, x takes it out, Undo puts back, and it follows the queue", async () => {
  await withDocument(async () => {
    const queue = createAppQueue();
    const events = [];
    queue.subscribe((e) => events.push(e));
    const bars = [];
    let buzzes = 0;
    const b = queueToggle(PKG, null, { queue, store: async () => memoryAppStore(), buzz: () => { buzzes += 1; }, undo: (o) => bars.push(o) });
    assert.equal(b.tagName, "BUTTON");
    for (const c of ["bar-button", "bar-icon", "queue-toggle"]) assert.ok(b.classList.contains(c), c);
    assert.equal(b.classList.contains("is-queued"), false);
    assert.equal(b.getAttribute("aria-label"), QUEUE_ADD_LABEL);

    await b.click();
    assert.equal(queue.get("com.x.a").version, "2.1");
    assert.equal(queue.get("com.x.a").mode, "install");
    assert.equal(events.at(-1).quiet, true, "quiet: no Confirm sheet opens");
    assert.ok(b.classList.contains("is-queued"));
    assert.equal(b.getAttribute("aria-label"), QUEUE_REMOVE_LABEL);
    assert.equal(bars.at(-1).message, "Install A queued");
    assert.equal(buzzes, 1);

    bars.at(-1).onUndo();
    assert.equal(queue.get("com.x.a"), null, "Undo of a + takes it back out");
    b.refresh();
    assert.equal(b.classList.contains("is-queued"), false);

    // queued elsewhere (a row's swipe, Modify): refresh follows; x takes it out and Undo puts the same job back
    queue.add({ id: "com.x.a", name: "A", version: "2.0", url: "https://s/a1.ipa", installed: "2.1" });
    b.refresh();
    assert.ok(b.classList.contains("is-queued"));
    await b.click();
    assert.equal(queue.get("com.x.a"), null);
    assert.equal(b.classList.contains("is-queued"), false);
    assert.equal(bars.at(-1).message, "Downgrade A cancelled");
    assert.equal(buzzes, 2);
    bars.at(-1).onUndo();
    assert.equal(queue.get("com.x.a").version, "2.0");
    assert.equal(events.at(-1).quiet, true);
    queue.clearAll();
    b.refresh();
    assert.equal(b.getAttribute("aria-label"), QUEUE_ADD_LABEL);
  });
});

test("queueToggle: nothing to install, nothing queued and no undo bar claims it was", async () => {
  await withDocument(async () => {
    const queue = createAppQueue();
    const bars = [];
    const b = queueToggle({ stanza: { ipa: { ...APP, versions: [] } } }, null, { queue, store: async () => memoryAppStore(), buzz() {}, undo: (o) => bars.push(o) });
    await b.click();
    assert.equal(queue.size, 0);
    assert.deepEqual(bars, []);
  });
});

// B338: an app iFizBox signed and remembers: the toggle reads filled, and its off tap forgets both, as Installed's
// Remove from List does (signing.forget for the signature, removeInstall for the record), so the nav button reads
// Install at once and the Installed section goes (a signature left behind brought the record back: Modify stayed).
import { trackingSection } from "./altstore.js";

const signedPage = () => {
  const mem = memoryAppStore([{ id: "com.x.a", version: "2.0", key: PKG.key }]);
  const removed = [];
  const store = async () => ({ ...mem, remove: async (id) => { removed.push(id); return mem.remove(id); } });
  let sig = { bundleId: "com.x.a", name: "A", version: "2.0", expires: null };
  const calls = [];
  const native = { call: async (name, args) => { calls.push([name, args]); if (name === "signing.forget") sig = null; return {}; } };
  const signedOf = async (id) => (sig && id === "com.x.a" ? sig : null);
  return { mem, removed, store, calls, native, signedOf };
};

// The page's nav item with its Install / Modify button, handed in as app.js does.
const navFor = (body) => {
  const item = fakeElement("div");
  const right = fakeElement("div");
  right.className = "nav-right";
  const button = fakeElement("button");
  button.className = "bar-button";
  button.textContent = "Install";
  right.append(button);
  item.append(right);
  pageHandle(item, body);
  return button;
};

test("markToggle (B338): a signed + remembered app's off tap calls signing.forget and removeInstall; Install right after", async () => {
  await withDocument(async (doc) => {
    const page = signedPage();
    const body = fakeElement("div");
    doc.body.append(body);
    const navButton = navFor(body);
    const tracking = trackingSection(APP, PKG, null, body, { store: page.store, signedOf: page.signedOf });
    body.append(tracking);
    await tracking.drawn;
    assert.equal(navButton.textContent, "Modify");
    assert.ok(tracking.querySelector(".group"), "the Installed section shows");

    const b = markToggle(APP, PKG, null, { store: page.store, signedOf: page.signedOf, native: page.native,
      after: () => tracking.redraw(), buzz() {}, feedback() {} });
    await b.refreshed;
    assert.ok(b.classList.contains("is-marked"));

    await b.click();
    assert.deepEqual(page.calls, [["signing.forget", { bundleId: "com.x.a" }]]);
    assert.deepEqual(page.removed, ["com.x.a"]);
    assert.deepEqual(await page.mem.all(), []);
    assert.equal(b.classList.contains("is-marked"), false, "outline");
    assert.equal(b.getAttribute("aria-label"), MARK_INSTALLED_LABEL);
    assert.equal(navButton.textContent, "Install", "the nav button reads Install right after the tap");
    assert.equal(tracking.querySelector("h2")?.textContent ?? null, "Installed");
    assert.equal(tracking.querySelector(".group-footer").textContent.startsWith("Installed it another way?"), true,
      "the section is back to Mark as Installed: the installed app's rows are gone");
  });
});

test("markToggle (B338): a signed app with no installed record reads filled, and its off tap forgets the signature", async () => {
  await withDocument(async () => {
    const page = signedPage();
    await page.mem.remove("com.x.a");
    const b = markToggle(APP, PKG, null, { store: page.store, signedOf: page.signedOf, native: page.native, buzz() {}, feedback() {} });
    await b.refreshed;
    assert.ok(b.classList.contains("is-marked"), "a signature counts as marked");
    await b.click();
    assert.deepEqual(page.calls, [["signing.forget", { bundleId: "com.x.a" }]]);
    assert.deepEqual(await page.mem.all(), [], "not marked at the latest version instead");
    assert.equal(b.classList.contains("is-marked"), false);
  });
});
