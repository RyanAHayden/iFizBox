// B470: Lite's own IPA from a source's app page keeps the picked own icon: the self route sends {ownIcon} as params.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signAndInstall } from "./install.js";
import { GITHUB_REPO, NAME } from "../brand.js";

const SELF = `https://github.com/${GITHUB_REPO}/releases/latest/download/${NAME}.ipa`;

async function run(ownIcon) {
  const saved = globalThis.ifizboxNative;
  globalThis.ifizboxNative = { mode: "sideload", call: async () => null };
  const sent = [];
  try {
    const ok = await signAndInstall({ url: SELF }, { install: async (o) => { sent.push(o); return true; }, ownIcon });
    return { ok, sent };
  } finally {
    if (saved === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = saved;
  }
}

test("the self route passes {ownIcon} params when an own icon is picked", async () => {
  const { ok, sent } = await run(async (url) => ({ url, ownIcon: "owna1" }));
  assert.equal(ok, true);
  assert.equal(sent[0].host, true);
  assert.deepEqual(sent[0].params, { url: SELF, ownIcon: "owna1" });
});

test("the self route sends no params without an own icon", async () => {
  const { sent } = await run(async (url) => ({ url }));
  assert.equal(sent[0].host, true);
  assert.equal(sent[0].params, undefined);
});
