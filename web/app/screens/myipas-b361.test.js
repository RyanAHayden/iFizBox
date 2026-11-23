// B361: an IPA's page in My IPAs is the app page's Details for a file: the store header (no stars), Version and
// Information with tiles, Add Tweaks pushing the F352 page; tweaks added there go into the file's Sign Options.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { header, ipaDetailRows, syncOnTweakChange } from "./myipas.js";
import { fakePage, withDocument, tick } from "../fakes.test-helper.js";

const ENTRY = { file: "Delta 1.5.ipa", name: "Delta", version: "1.5", bundleId: "com.x.delta", size: 10 * 1024 * 1024, minimumOS: "14.0",
  extensions: ["a.appex"] };

test("B361: the IPA's header is the app page's: name, bundle ID where the developer goes, version and size, no stars", () => withDocument(() => {
  const h = header(ENTRY, { isSite: false });
  assert.ok(h.classList.contains("alt-app"));
  assert.equal(h.querySelector(".store-head-name").textContent, "Delta");
  assert.equal(h.querySelector(".store-head-author").textContent, "com.x.delta");
  assert.equal(h.querySelector(".store-head-line").textContent, "Version 1.5 · 10.0 MB");
  assert.equal(h.querySelector(".store-head-rating"), null, "a local IPA has no ratings");
  const file = header({ file: "Some App 1.0.ipa", size: 0 }, { isSite: false });
  assert.ok(file.querySelector(".store-head-name").classList.contains("myipa-head-file"), "B92: a file name wraps");
}));

test("B361: the IPA's Version and Information rows come from its entry", () => {
  const p = ipaDetailRows(ENTRY, { sideload: true });
  assert.equal(p.addTweaks, true);
  assert.deepEqual(p.info.map((r) => [r.label, r.detail]), [["Works On", "iOS 14.0 or later"], ["Size", "10.0 MB"], ["Extensions", "1"],
    ["Bundle ID", "com.x.delta"], ["File", "Delta 1.5.ipa"]]);
  assert.equal(ipaDetailRows(ENTRY, { sideload: false }).addTweaks, false, "the website and the jailbreak app add no tweaks");
});

test("B361: tweaks changed on the Add Tweaks page go into Sign Options on the next navigation, once per change", async () => {
  const page = fakePage();
  const node = { get isConnected() { return page.connected !== false; } };
  let kept = [];
  const synced = [];
  const listeners = new Set();
  const win = { addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) };
  const s = syncOnTweakChange(node, ENTRY, { saved: async () => kept, sync: async (e) => synced.push(e.file), win });
  await s.check();
  assert.deepEqual(synced, [], "nothing changed");
  kept = [{ name: "com.t.yt_2.deb" }];
  await s.check();
  assert.deepEqual(synced, ["Delta 1.5.ipa"], "ADD on the Add Tweaks page, then back");
  await s.check();
  assert.equal(synced.length, 1, "the same list again: no second options call");
  kept = [];
  await s.check();
  assert.equal(synced.length, 2, "Remove counts too");
  page.connected = false;
  for (const f of listeners) f();
  await tick();
  assert.equal(listeners.size, 0, "the page gone: it stops listening");
});

test("B361: the IPA's Add Tweaks is the app page's group, not the old sheet", () => {
  const src = readFileSync(new URL("./myipas.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /openAddTweaks/);
  assert.match(src, /addTweaksGroup\(\{ bundleId: entry\.bundleId/);
  const tw = readFileSync(new URL("./tweaks.js", import.meta.url), "utf8");
  assert.match(tw, /b\.addEventListener\("click", \(\) => push\(bundleId\)\)/, "the row always pushes the page");
});
