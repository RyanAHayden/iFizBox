// B11: a cydia::commercial package on a source with a payment_endpoint never goes to apt (Havoc answers apt with 418;
// paid debs come only through paid.install). The nav bar button shows the price until the vendor says purchased,
// and its sheet offers the Purchase group's step (extras.js paidNav, browse.js paidActions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { paidNav, paidStateOf } from "./extras.js";
import { paidActions } from "./browse.js";

const fn = (name) => Object.assign(() => name, { tag: name });
const signIn = fn("signIn"), buy = fn("buy"), install = fn("install");
const cbs = { vendorName: "Havoc", signIn, buy, install };
const labels = (r) => r.actions.map((a) => a.label);

test("signed out, priced: the price on the button, Sign In in the sheet, nothing to install", () => {
  const n = paidNav({ price: "$3.49", purchased: false, available: true }, false, cbs);
  assert.equal(n.label, "$3.49");
  assert.equal(n.purchased, false);
  assert.equal(n.install, null);
  assert.deepEqual(labels(n), ["Sign In to Havoc"]);
  assert.equal(n.actions[0].run, signIn);
  // The vendor's banner button names Sign In when it has one.
  assert.deepEqual(labels(paidNav({ price: "$3.49", purchased: false, available: true }, false, { ...cbs, signInLabel: "Log In" })), ["Log In"]);
});

test("signed in, not bought: Buy for the price", () => {
  const n = paidNav({ price: "$3.49", purchased: false, available: true }, true, cbs);
  assert.equal(n.label, "$3.49");
  assert.deepEqual(labels(n), ["Buy for $3.49"]);
  assert.equal(n.actions[0].run, buy);
});

test("bought: Install on the button, Download & Install in the sheet", () => {
  const n = paidNav({ price: "$3.49", purchased: true, available: true }, true, cbs);
  assert.equal(n.label, "Install");
  assert.equal(n.purchased, true);
  assert.equal(n.install, install);
  assert.deepEqual(labels(n), ["Download & Install"]);
});

test("purchased: true without a token (Chariz's free packages) still needs Sign In; free packages say Install", () => {
  const n = paidNav({ price: "FREE", purchased: true, available: true }, false, cbs);
  assert.equal(n.label, "Install");
  assert.equal(n.install, null);
  assert.deepEqual(labels(n), ["Sign In to Havoc"]);
});

// F434: Havoc's answer for Lunar Legacy, which it no longer sells.
const gone = { price: "Unavailable", purchased: false, available: false };

test("F434: no longer sold, signed out: Sign In, and the note says a buyer can still download it", () => {
  for (const vendorName of ["Havoc", "Chariz"]) {
    const n = paidNav(gone, false, { ...cbs, vendorName });
    assert.equal(n.label, "Unavailable");
    assert.equal(n.install, null);
    assert.deepEqual(labels(n), [`Sign In to ${vendorName}`]);
    assert.equal(n.actions[0].run, signIn);
    assert.equal(n.note, `${vendorName} no longer sells this. If you bought it, sign in to download it.`);
  }
  const sheet = paidActions(paidNav(gone, false, { ...cbs, signInLabel: "Log In" }),
    { id: "org.haxi0.lunar", version: "1.0", installed: null, queue: noQueue, wish: wishOf() });
  assert.deepEqual(labels(sheet), ["Log In", "Add to Wish List"]);
  assert.match(sheet.title, /^Havoc no longer sells this\./);
});

test("F434: no longer sold, signed in and purchased: Download & Install", () => {
  const n = paidNav({ ...gone, purchased: true }, true, cbs);
  assert.equal(n.label, "Install");
  assert.equal(n.purchased, true);
  assert.equal(n.install, install);
  assert.deepEqual(labels(n), ["Download & Install"]);
  assert.equal(n.actions[0].run, install);
  const up = paidActions(n, { id: "p", version: "1.2", installed: "1.1", queue: () => {}, wish: wishOf() });
  assert.deepEqual(labels(up), ["Upgrade", "Remove"]);
});

test("F434: no longer sold, signed in and not purchased: nothing to do but the note", () => {
  const n = paidNav(gone, true, cbs);
  assert.equal(n.install, null);
  assert.deepEqual(n.actions, []);
  assert.equal(n.note, "Havoc no longer sells this.");
});

test("F434: Free but unavailable (icontweak) never says it was sold", () => {
  const free = { ...gone, price: "Free" };
  const out = paidNav(free, false, cbs);
  assert.equal(out.label, "Install");
  assert.equal(out.install, null);
  assert.deepEqual(labels(out), ["Sign In to Havoc"]);
  assert.deepEqual(labels(paidNav(free, true, cbs)), []);
  assert.deepEqual(labels(paidNav({ ...free, purchased: true }, true, cbs)), ["Download & Install"]);
  for (const n of [out, paidNav(free, true, cbs), paidNav({ ...free, purchased: true }, true, cbs)]) {
    assert.match(n.note, /^Not available from Havoc\./);
    assert.doesNotMatch(n.note, /sell|sold|bought/i);
  }
});

test("F434: a vendor error is its own message, never no longer sold", () => {
  for (const note of ["Not Found", "Bad Request"]) {
    for (const signedIn of [false, true]) {
      const n = paidNav(null, signedIn, { ...cbs, note });
      assert.equal(n.note, note);
      assert.deepEqual(n.actions, []);
    }
  }
});

test("the vendor couldn't be asked: nothing to queue, and the note says why", () => {
  const e = paidNav(null, false, { note: "offline" });
  assert.deepEqual(e.actions, []);
  assert.equal(e.label, "Install");
  assert.equal(e.note, "offline");
});

test("a box that isn't a vendor's paid package has no paid state", async () => {
  assert.equal(await paidStateOf(null), null);
  assert.equal(await paidStateOf({}), null);
});

const wishOf = (ids = []) => { const s = new Set(ids); return { has: (i) => s.has(i), set: (i, on) => (on ? s.add(i) : s.delete(i)) }; };
const noQueue = () => assert.fail("nothing queued");

test("not installed: the sheet is the Purchase step and Wish List, never a queued Install or Other Versions", () => {
  const paid = paidNav({ price: "$3.49", purchased: false, available: true }, false, cbs);
  const r = paidActions(paid, { id: "com.havoc.elysian", version: "1.2", installed: null, queue: noQueue, wish: wishOf() });
  assert.deepEqual(labels(r), ["Sign In to Havoc", "Add to Wish List"]);
  assert.match(r.title, /Sold by Havoc/);
  const bought = paidNav({ price: "$3.49", purchased: true, available: true }, true, cbs);
  const b = paidActions(bought, { id: "com.havoc.elysian", version: "1.2", installed: null, queue: noQueue, wish: wishOf() });
  assert.deepEqual(labels(b), ["Download & Install", "Add to Wish List"]);
  assert.equal(b.actions[0].run, install);
});

test("installed and bought: Upgrade or Reinstall through Download & Install, Remove through the queue, no Downgrade", () => {
  const bought = paidNav({ price: "$3.49", purchased: true, available: true }, true, cbs);
  const jobs = [];
  const queue = (j) => jobs.push(j);
  const up = paidActions(bought, { id: "p", version: "1.2", installed: "1.1", queue, wish: wishOf() });
  assert.deepEqual(labels(up), ["Upgrade", "Remove"]);
  assert.equal(up.actions[0].run, install);
  const same = paidActions(bought, { id: "p", version: "1.2", installed: "1.2", queue, wish: wishOf(["p"]) });
  assert.deepEqual(labels(same), ["Reinstall", "Remove", "Remove from Wish List"]);
  same.actions[1].run();
  assert.deepEqual(jobs, [{ op: "remove", id: "p" }]);
  // Installed but signed out: only Remove (the vendor won't hand out the deb yet).
  const out = paidNav({ price: "$3.49", purchased: false, available: true }, false, cbs);
  assert.deepEqual(labels(paidActions(out, { id: "p", version: "1.2", installed: "1.1", queue, wish: wishOf() })), ["Remove"]);
});
