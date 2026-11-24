import test from "node:test";
import assert from "node:assert/strict";
import { addRestoreShortcut, rememberVPN, bringBackVPN } from "./restoreshortcut.js";

test("each asks the shell for its own call", async () => {
  const calls = [];
  const native = { call: async (name) => { calls.push(name); return name; } };
  for (const f of [addRestoreShortcut, rememberVPN, bringBackVPN]) await f(native);
  assert.deepEqual(calls, ["restore.add", "restore.store", "restore.back"]);
});
