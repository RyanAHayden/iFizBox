// F392: the Version page's rows (screens/browse.js versionCell): a button with the chevron where a tap installs, the date,
// size and iOS on one line, INSTALLED (greyed) on an installed version that can't be reinstalled, long notes folded to
// three lines under Show More; and which version of an app is marked (altstore.js appVersionInstalled).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nav, versionCell } from "./browse.js";
import { appVersionInstalled } from "./altstore.js";
import { withDocument } from "../fakes.test-helper.js";

const LONG = Array.from({ length: 9 }, (_, i) => `Change ${i + 1}`).join("\n");

test("the page is Version", () => {
  assert.equal(nav({ tab: "sources", path: ["src1", "package:com.x", "versions:com.x"] }).title, "Version");
});

test("a version that installs is a button with the chevron; a greyed one is not", () => withDocument(() => {
  let taps = 0;
  const li = versionCell({ label: "Version 2.0", tags: ["Latest"], sub: "Nov 9, 2026 · 40.6 MB · iOS 17.4+", onClick: () => { taps++; } });
  const go = li.querySelector(".version-go");
  assert.ok(go.classList.contains("chevron"));
  go.click();
  assert.equal(taps, 1);
  assert.equal(li.querySelector(".version-sub").textContent, "Nov 9, 2026 · 40.6 MB · iOS 17.4+");
  assert.equal(li.querySelector(".cell-detail"), null, "the date is on the line under the version");
  const off = versionCell({ label: "Version 1.0", unavailable: true });
  assert.equal(off.querySelector(".version-go"), null);
  assert.equal(off.querySelector(".version-mark"), null);
}));

test("INSTALLED only where the installed version can't be reinstalled; a tappable one wears the tag", () => withDocument(() => {
  const stuck = versionCell({ label: "1.0", installed: true, unavailable: true });
  assert.equal(stuck.querySelector(".version-mark").textContent, "INSTALLED");
  assert.equal(stuck.querySelector(".version-tag"), null);
  const again = versionCell({ label: "1.0", installed: true, onClick: () => {} });
  assert.equal(again.querySelector(".version-mark"), null);
  assert.equal(again.querySelector(".version-tag").textContent, "Installed");
}));

test("long notes fold under Show More / Show Less, which is not the row's button; short ones don't", () => withDocument(() => {
  let taps = 0;
  const li = versionCell({ label: "2.0", notes: LONG, onClick: () => { taps++; } });
  const notes = li.querySelector(".version-notes");
  const more = li.querySelector(".version-more .cell-inner");
  assert.ok(notes.classList.contains("folded"));
  assert.equal(more.textContent, "Show More");
  more.click();
  assert.ok(!notes.classList.contains("folded"));
  assert.equal(more.textContent, "Show Less");
  assert.equal(taps, 0);
  assert.equal(versionCell({ label: "2.0", notes: "One line." }).querySelector(".version-more"), null);
}));

test("appVersionInstalled: the record's version, else what this app signed, else null", async () => {
  const app = { bundleIdentifier: "com.x.app" };
  const store = (list) => async () => ({ all: async () => list });
  assert.equal(await appVersionInstalled(app, { store: store([{ id: "com.x.app", version: "1.2" }]), signedOf: async () => null }), "1.2");
  assert.equal(await appVersionInstalled(app, { store: store([]), signedOf: async () => ({ bundleId: "com.me.app", version: "1.1" }) }), "1.1");
  assert.equal(await appVersionInstalled(app, { store: store([]), signedOf: async () => { throw new Error("no shell"); } }), null);
  assert.equal(await appVersionInstalled(null), null);
});
