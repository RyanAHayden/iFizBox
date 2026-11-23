// F384: one source page: the Information group (Trust, Website with its hold menu, Updated, Last Release, Canister's
// HTTPS and Signed Releases) and an APT repo's header card (screens/sourcepage.js).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument } from "../nav/fakedom.test-helper.js";
import { infoGroup, shortUrl } from "./sourcepage.js";

let saved;
beforeEach(() => { saved = globalThis.document; globalThis.document = fakeDocument(); });
afterEach(() => { globalThis.document = saved; });

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 23);
const apt = { key: "deb:https://apt.example.org/:./", uri: "https://apt.example.org/", updated: NOW - DAY,
  reachedAt: NOW - DAY, releaseDate: NOW - 3 * DAY };
const labels = (box) => box.querySelectorAll(".cell-label").map((n) => n.textContent);
const details = (box) => box.querySelectorAll(".cell-detail").map((n) => n.textContent);

test("one Information group: Trust, Updated, Last Release, each with its row icon", async () => {
  const box = infoGroup(apt, { now: NOW });
  assert.equal(await box.ready, null);
  assert.match(box.textContent, /Information/);
  assert.deepEqual(labels(box), ["Trust", "Updated", "Last Release"]);
  assert.deepEqual(details(box).slice(1), ["Yesterday", "3 days ago"]);
  assert.equal(box.querySelectorAll(".cell-icon.row-icon").length, 3);
  assert.ok(box.querySelector(".source-info-trust .trust-word, .source-info-trust .trust-pill"), "Trust shows its pill");
  assert.doesNotMatch(box.textContent, /Canister/, "no Canister footer without its facts");
});

test("a source whose last refresh failed says Not Responding in place of Updated", () => {
  const box = infoGroup({ ...apt, error: "timed out" }, { now: NOW });
  assert.deepEqual(labels(box), ["Trust", "Status", "Last Release"]);
  assert.equal(box.querySelectorAll(".find-warn").length, 1);
});

test("Canister's facts add HTTPS and Signed Releases and name Canister in the footer", async () => {
  const box = infoGroup(apt, { now: NOW, canister: Promise.resolve({ https: false, gpg: true }) });
  assert.deepEqual(await box.ready, { https: false, gpg: true });
  assert.deepEqual(labels(box), ["Trust", "Updated", "Last Release", "HTTPS", "Signed Releases"]);
  assert.deepEqual(details(box).slice(3), ["No", "Yes"]);
  assert.equal(box.querySelectorAll(".find-warn").length, 1, "plain http is flagged");
  assert.match(box.textContent, /from Canister \(canister\.me\)/);
});

test("no Canister rows for a repo it doesn't list, a fact it doesn't know, or offline", async () => {
  for (const canister of [Promise.resolve(null), Promise.resolve({ tier: 2 }), Promise.reject(new Error("offline"))]) {
    const box = infoGroup(apt, { now: NOW, canister });
    assert.equal(await box.ready, null);
    assert.deepEqual(labels(box), ["Trust", "Updated", "Last Release"]);
  }
  const half = infoGroup(apt, { now: NOW, canister: Promise.resolve({ https: true, gpg: null }) });
  await half.ready;
  assert.deepEqual(labels(half).slice(3), ["HTTPS"], "an unknown fact is left out");
});

test("Website: after Trust, the short address; a hold opens the menu with Copy URL", () => {
  const holds = [], shown = [], copied = [];
  const box = infoGroup({ key: "alt:https://x.example/s.json", uri: "https://x.example/s.json" }, {
    now: NOW, website: "https://www.example.org/",
    hold: (root, sel, onHold) => holds.push({ root, sel, onHold }),
    menu: (li, items, opts) => shown.push({ li, items, opts }),
    copy: (t) => copied.push(t) });
  assert.deepEqual(labels(box), ["Trust", "Website"]);
  assert.equal(details(box)[1], "example.org");
  assert.equal(holds.length, 1);
  assert.equal(holds[0].root, box);
  assert.equal(holds[0].sel, ".source-info-website");
  const li = box.querySelector(".source-info-website");
  holds[0].onHold(li, { clientX: 40 });
  assert.equal(shown[0].li, li);
  assert.deepEqual(shown[0].items.map((i) => i.label), ["Copy URL"]);
  assert.equal(shown[0].opts.x, 40);
  shown[0].items[0].onClick();
  assert.deepEqual(copied, ["https://www.example.org/"]);
});

test("no Website, no hold", () => {
  let held = 0;
  infoGroup(apt, { now: NOW, hold: () => held++ });
  assert.equal(held, 0);
});

test("shortUrl drops the scheme, www and the trailing slash", () => {
  assert.equal(shortUrl("https://www.example.org/"), "example.org");
  assert.equal(shortUrl("http://apt.example.org/repo/"), "apt.example.org/repo");
  assert.equal(shortUrl(null), "");
});
