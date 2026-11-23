// F400: what the source lists goes with a downloading call, so the shell uses an IPA it kept from a failed install only
// when it still matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listedOf } from "./appqueue.js";
import { prepareParams } from "../signing/queue.js";
import { installIpa } from "../ipa-install.js";

test("listedOf: the version and size of a url job, nothing else", () => {
  assert.deepEqual(listedOf({ url: "u", version: "2", size: 5 }), { listed: { version: "2", size: 5 } });
  assert.deepEqual(listedOf({ url: "u", version: "2", size: null }), { listed: { version: "2" } });
  assert.deepEqual(listedOf({ url: "u" }), {});
  assert.deepEqual(listedOf({ library: "f.ipa", url: "u", version: "2" }), {});
  assert.deepEqual(listedOf(null), {});
});

test("signing.prepare and ipa.install carry it; a Re-sign from its record doesn't", async () => {
  assert.deepEqual(prepareParams({ id: "a", mode: "upgrade", url: "u", version: "2", size: 5 }), { url: "u", listed: { version: "2", size: 5 } });
  assert.deepEqual(prepareParams({ id: "a", mode: "resign", url: null, version: "2" }), { record: "a" });
  const calls = [];
  const native = { call: async (m, p) => { calls.push(p); return { code: 0 }; } };
  await installIpa("u", null, { native, listed: { version: "2" } });
  await installIpa("u", null, { native });
  assert.deepEqual(calls.map((p) => p.listed), [{ version: "2" }, undefined]);
});
