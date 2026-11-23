// F376: when an update is out for an app (its installed record is older than versions[0]), the app page's Details
// opens with the newest version's What's New card (screens/altstore.js updateNewsSlot); not installed, up to date,
// newer, or no notes: no card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { updateNewsShown, updateNewsGroup, updateNewsSlot } from "./altstore.js";
import { memoryAppStore } from "../core/installed.js";
import { withDocument } from "../fakes.test-helper.js";

const APP = { bundleIdentifier: "com.x.a", name: "A",
  versions: [{ version: "2.1", date: "2026-11-01", localizedDescription: "Faster sync." }, { version: "2.0" }] };

test("updateNewsShown: an older installed version shows the card; same, newer or none doesn't", () => {
  assert.equal(updateNewsShown(APP, "2.0"), true);
  assert.equal(updateNewsShown(APP, "1.9.9"), true);
  assert.equal(updateNewsShown(APP, "2.1"), false);
  assert.equal(updateNewsShown(APP, "2.2"), false);
  assert.equal(updateNewsShown(APP, null), false);
  assert.equal(updateNewsShown(APP, ""), false);
});

test("updateNewsShown: no notes on the newest version, or no versions, shows nothing", () => {
  const bare = { ...APP, versions: [{ version: "2.1" }] };
  assert.equal(updateNewsShown(bare, "2.0"), false);
  assert.equal(updateNewsShown({ ...APP, versions: [] }, "2.0"), false);
  assert.equal(updateNewsShown({ ...APP, versions: [{ version: "2.1", localizedDescription: "  \n" }] }, "2.0"), false);
});

test("updateNewsGroup: the What's New card with the version, notes and Version History; null for another app's record", async () => {
  await withDocument(async () => {
    const card = updateNewsGroup(APP, { id: "com.x.a", version: "2.0" }, { href: "#v" });
    assert.ok(card);
    const text = card.textContent;
    assert.match(text, /What’s New in 2\.1/);
    assert.match(text, /Faster sync\./);
    assert.match(text, /Version History/);
    assert.equal(updateNewsGroup(APP, { id: "com.x.b", version: "2.0" }), null);
    assert.equal(updateNewsGroup(APP, null), null);
    assert.equal(updateNewsGroup(APP, { id: "com.x.a", version: "2.1" }), null);
  });
});

test("updateNewsSlot: filled from the real installed record and redrawn when the list changes", async () => {
  await withDocument(async () => {
    const mem = memoryAppStore([{ id: "com.x.a", version: "2.0" }]);
    let listener = null;
    const slot = updateNewsSlot(APP, { href: "#v" }, { store: async () => mem, onChange: (f) => { listener = f; return () => {}; } });
    await slot.drawn;
    assert.equal(slot.children.length, 1);
    mem.all = async () => [{ id: "com.x.a", version: "2.1" }]; // updated to the newest
    listener();
    await slot.drawn;
    assert.equal(slot.children.length, 0);
  });
});

test("updateNewsSlot: not installed leaves the slot empty", async () => {
  await withDocument(async () => {
    const slot = updateNewsSlot(APP, null, { store: async () => memoryAppStore([]), onChange: null });
    await slot.drawn;
    assert.equal(slot.children.length, 0);
  });
});
