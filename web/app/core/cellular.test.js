// F417: On Cellular's choice, its texts, and the route it makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CELLULAR_KEY, CELLULAR_OPTIONS, CELLULAR_ANSWERS, onCellularChoice, setOnCellular, cellularFooter, cellularQuestion } from "./cellular.js";
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
  assert.deepEqual(CELLULAR_OPTIONS.map((o) => o.label), ["Ask Each Time", "Use Signing Server"]);
  assert.match(cellularFooter("server"), /On Wi-Fi/);
  const q = cellularQuestion();
  assert.equal(q.buttons.length, CELLULAR_ANSWERS.length);
  assert.equal(CELLULAR_ANSWERS[q.cancel], "cancel");
});

test("Use Signing Server decides the route only on cellular", () => {
  const st = (cellular) => ({ paired: "rp", vpn: { available: true, tested: true, cellular } });
  assert.deepEqual(decideRoute("iphone", st(true), "server"), { route: "server" });
  assert.deepEqual(decideRoute("iphone", st(false), "server"), { route: "idevice" });
  assert.deepEqual(decideRoute("iphone", st(true), "ask"), { route: "idevice" });
});
