// F417: On Cellular's choice, its texts, and the route it makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CELLULAR_KEY, CELLULAR_OPTIONS, cellularOptions, onCellularChoice, setOnCellular, cellularFooter, cellularQuestion, shortcutRan, setShortcutRan, shortcutWhy, needsAdding } from "./cellular.js";
import { decideRoute } from "./installroute.js";

test("the choice: Ask Each Time until picked, kept, and an unknown or broken value is Ask Each Time", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(onCellularChoice(storage), "ask");
  setOnCellular("server", storage);
  assert.equal(onCellularChoice(storage), "server");
  mem.set(CELLULAR_KEY, "shortcutz");
  assert.equal(onCellularChoice(storage), "ask");
  assert.equal(onCellularChoice({ getItem() { throw new Error("off"); } }), "ask");
});

test("the page's texts and the popup", () => {
  assert.deepEqual(CELLULAR_OPTIONS.map((o) => o.label), ["Ask Each Time", "Use Shortcut", "Use Signing Server"]);
  assert.deepEqual(cellularOptions(true).map((o) => o.subtitle).slice(0, 2), ["Airplane Mode, Shortcut or server.", "Cellular data goes off for a moment."]);
  assert.deepEqual(cellularOptions(false).map((o) => [o.value, o.subtitle]).slice(0, 1), [["ask", "Airplane Mode or server."]]);
  assert.equal(cellularOptions(false).length, 2);
  assert.match(cellularFooter("server"), /On Wi-Fi/);
  assert.equal(cellularFooter("shortcut"), "Shortcuts opens for a moment and turns cellular data back on by itself.");
  const first = (o) => { const q = cellularQuestion(o); assert.equal(q.buttons.length, q.answers.length); assert.equal(q.answers[q.cancel], "cancel"); return [q.title, q.buttons[0], q.add]; };
  assert.equal(first({})[1], "Use Signing Server", "no Shortcut here");
  assert.deepEqual(first({ shortcut: { added: false } }), ["You're on Cellular", "Set Up Shortcut", true]);
  assert.deepEqual(first({ shortcut: { added: true } }), ["You're on Cellular", "Use Shortcut", false]);
  assert.deepEqual(first({ shortcut: { added: true }, failed: "not_run" }), ["Shortcut Didn't Run", "Add Shortcut Again", true]);
  assert.deepEqual(first({ shortcut: { added: true }, failed: "ran_out" }), ["Shortcut Didn't Run", "Use Shortcut", false], "adding it again wouldn't help");
  assert.match(cellularQuestion({ shortcut: {}, failed: "not_run" }).message, /“Cellular Installs” wasn't found .*join Wi-Fi, or choose:$/);
  for (const c of ["not_run", "no_end", "no_return", "not_opened", "busy", "vpn_off", "ran_out", "other"]) assert.match(shortcutWhy(c), /\.$/);
  assert.equal(needsAdding("busy"), false);
});

test("a run that passed is kept", () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(shortcutRan(storage), null);
  setShortcutRan(true, storage);
  assert.equal(shortcutRan(storage), true);
  setShortcutRan(false, storage);
  assert.equal(shortcutRan(storage), false);
});

test("Use Signing Server decides the route only on cellular", () => {
  const st = (cellular) => ({ paired: "rp", vpn: { available: true, tested: true, cellular } });
  assert.deepEqual(decideRoute("iphone", st(true), "server"), { route: "server", cellular: true });
  assert.deepEqual(decideRoute("iphone", st(false), "server"), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", st(true), "ask"), { route: "idevice" });
});
