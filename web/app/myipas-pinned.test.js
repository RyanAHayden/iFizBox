// B508: My IPAs' Sign Options on a free Apple ID's profile (free, not wildcard): no Keep Bundle ID switch or footer,
// and Save sends no keepBundleId that wasn't saved before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { render, nav } from "./screens/myipas.js";
import { ipaToken, MYIPAS } from "./core/myipas.js";
import { fakeNative, withDocument, tick } from "./fakes.test-helper.js";

const ENTRY = { file: "Delta.ipa", name: "Delta", bundleId: "com.x.delta", version: "1.5", extensions: [] };
const FREE = { free: true, wildcard: false, team: "TEAM123456", appId: "com.x.delta.TEAM123456" };

globalThis.location = { hash: "" }; // Save leaves the page, and looks at where it is a moment later

// Draws Sign Options, taps Save -> what the page showed and what library.options got.
async function saveWith(profile, options = null) {
  const native = fakeNative({
    "library.list": () => ({ ipas: [{ ...ENTRY, options }], identity: true }),
    "library.options": () => ({}),
    "signing.status": () => ({ identity: { profile } }),
  });
  const had = globalThis.ifizboxNative;
  globalThis.ifizboxNative = native;
  try {
    return await withDocument(async (doc) => {
      const body = doc.createElement("div");
      doc.body.append(body);
      const route = { tab: "installed", path: [MYIPAS, ipaToken(ENTRY.file), "options"] };
      await render(body, route);
      const labels = body.querySelectorAll(".cell-label").map((n) => n.textContent);
      const footers = body.querySelectorAll(".group-footer").map((n) => n.textContent).join(" ");
      nav(route).right.onClick({});
      for (let i = 0; i < 20; i++) await tick();
      const sent = native.calls.find((c) => c.method === "library.options")?.params;
      return { labels, footers, sent };
    });
  } finally {
    if (had === undefined) delete globalThis.ifizboxNative; else globalThis.ifizboxNative = had;
  }
}

test("a free Apple ID's profile: no Keep Bundle ID switch or footer, and none saved", async () => {
  const p = await saveWith(FREE);
  assert.ok(p.labels.includes("arm64e Fix-Up"), "the page drew");
  assert.ok(!p.labels.includes("Keep Bundle ID"));
  assert.doesNotMatch(p.footers, /keeps its own ID|Keep Bundle IDs|separate copy/);
  assert.ok(p.sent, "saved");
  assert.ok(!("keepBundleId" in p.sent));
  assert.ok(!("keepBundleId" in (await saveWith(FREE, { keepBundleId: null })).sent));
});

test("a free Apple ID's profile: a choice saved before goes back as it was", async () => {
  for (const keepBundleId of [false, true]) {
    assert.equal((await saveWith(FREE, { keepBundleId })).sent.keepBundleId, keepBundleId);
  }
});

test("any other profile keeps the switch and saves it", async () => {
  for (const profile of [{ ...FREE, wildcard: true }, { ...FREE, free: false }]) {
    const p = await saveWith(profile);
    assert.ok(p.labels.includes("Keep Bundle ID"));
    assert.match(p.footers, /keeps its own ID/);
    assert.equal(p.sent.keepBundleId, true);
  }
});
