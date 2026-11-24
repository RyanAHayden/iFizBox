import test from "node:test";
import assert from "node:assert/strict";
import { shortcutStatus, addShortcut, checkShortcut } from "./cellularshortcut.js";

test("each asks the shell for its own call", async () => {
  const calls = [];
  const native = { call: async (name) => { calls.push(name); return name; } };
  for (const f of [shortcutStatus, addShortcut, checkShortcut]) await f(native);
  assert.deepEqual(calls, ["cellular.status", "cellular.add", "cellular.check"]);
});
