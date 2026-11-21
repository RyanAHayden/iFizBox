// F156: on the locked website (before iFizBox is installed), Home's help, User Guides and Credits / Thank You rows
// stay open like Settings; Find Extensions for Applications and Recommended Sources stay locked and ask first.
import { test } from "node:test";
import assert from "node:assert/strict";
// Imported before the fake DOM goes in: loading signing.js with a document links its stylesheet into document.head.
import { homeLinks, lockHomeLinks, askOnLocked, openWhileLocked } from "./home.js";
import { grouped } from "../nav/ui.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

// A tap on target, as the browser delivers it to box's capture listener: did anything stop it from opening?
async function tap(box, target) {
  let stopped = false;
  const ev = { target, preventDefault() { stopped = true; }, stopImmediatePropagation() {} };
  for (const f of box.listeners.click ?? []) await f(ev);
  return stopped;
}

// F157: the website Not Jailbroken (the default here) shows the lite User Guides: no OpenSSH or Root Password rows.
const OPEN = ["Settings", "Upgrading & Jailbreaking Help", "Frequently Asked Questions", "Copying Files to/from Device",
  "Credits / Thank You", "Theme", "Notifications for Signed Apps"]; // F237's guide
const LOCKED = ["Find Extensions for Applications"]; // B295: More Sources is the green tile now, locked with the tiles

test("F156: help, User Guides and Credits stay open on the locked Home; Find Extensions and Recommended Sources ask", async () => {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try {
    const links = homeLinks();
    const home = document.createElement("div");
    home.append(grouped(links));
    const groups = home.querySelectorAll(".group");
    lockHomeLinks(groups, links);
    let asked = 0;
    askOnLocked(home, async () => { asked++; });

    const rows = new Map(home.querySelectorAll(".cell").map((li) => [li.querySelector(".cell-label").textContent, li]));
    assert.deepEqual([...rows.keys()].sort(), [...OPEN, ...LOCKED].sort(), "every link row is checked here");
    for (const label of OPEN) {
      const li = rows.get(label);
      assert.equal(li.closest(".home-locked"), null, `${label}: no .home-locked`);
      assert.equal(await tap(home, li.querySelector(".cell-label")), false, `${label}: opens`);
    }
    assert.equal(asked, 0, "no Install iFizBox First for the open rows");
    for (const label of LOCKED) {
      const li = rows.get(label);
      assert.ok(li.closest(".home-locked"), `${label}: still locked`);
      assert.equal(await tap(home, li.querySelector(".cell-label")), true, `${label}: doesn't open`);
    }
    assert.equal(asked, LOCKED.length, "each locked row asks");
  } finally {
    globalThis.document = saved;
  }
});

test("F156: the open routes are Settings, help, guides/* and credits, deep links included", async () => {
  for (const h of ["#/home/help", "#/home/guides/faq", "#/home/guides/openssh", "#/home/credits", "#/home/settings",
    "#/settings/signing"]) assert.equal(openWhileLocked(h), true, h);
  for (const h of ["#/search", "#/sources/manage", "#/home/browse", "#/home/browse/popular", "#/home/featured",
    "#/home/sources", "#/home", "https://example.com/", undefined]) assert.equal(openWhileLocked(h), false, String(h));
});

test("F156: no route gate asks Install iFizBox First, so deep links to help, guides and credits open", async () => {
  // The only askers are Home's locked rows (askOnLocked), locked tabs (app.js) and Settings' padlocked row: nothing
  // in the router or Home's render() looks at the lock, so #/home/help etc. load straight in.
  const { readFile } = await import("node:fs/promises");
  for (const f of ["../router.js"]) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    assert.ok(!/askToBrowse|browsingLocked/.test(src), f);
  }
  const home = await readFile(new URL("./home.js", import.meta.url), "utf8");
  const render = home.slice(home.indexOf("export function render("));
  assert.ok(!/askToBrowse|browsingLocked/.test(render.slice(0, render.indexOf("\n}\n"))), "home.js render()");
});
