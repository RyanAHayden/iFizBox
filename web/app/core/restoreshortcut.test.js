import test from "node:test";
import assert from "node:assert/strict";
import { addRestoreShortcut, rememberVPN, bringBackVPN, watchRestoreDue, answerRestore } from "./restoreshortcut.js";

test("each asks the shell for its own call", async () => {
  const calls = [];
  const native = { call: async (name) => { calls.push(name); return name; } };
  for (const f of [addRestoreShortcut, rememberVPN, bringBackVPN]) await f(native);
  assert.deepEqual(calls, ["restore.add", "restore.store", "restore.back"]);
});

test("the held back run: told of each change, and answered", async () => {
  const calls = [], due = [];
  const native = { call: async (name, params, onEvent) => { calls.push([name, params]); onEvent?.({ due: true }); onEvent?.({ due: false }); } };
  await watchRestoreDue(native, (d) => due.push(d));
  await answerRestore(native, "notNow");
  assert.deepEqual(due, [true, false]);
  assert.deepEqual(calls, [["restore.due", { stream: true }], ["restore.answer", { answer: "notNow" }]]);
});
