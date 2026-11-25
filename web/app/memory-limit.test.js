// F261: the website's signing cap per browser. IPA_MAX stays the one global cap; each browser remembers the smallest
// IPA that ran zsign out of memory, and an app listed at that size or more opens the Too Big alert (Too Big for This
// iPhone, with Try Anyway) before anything downloads. An IPA that size or bigger that then signs forgets it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memStorage } from "./fakes.test-helper.js";
import { signInBrowser, tooBigAlert, memoryText, memoryNote, MEMORY_TITLE, MEMORY_BUTTONS, TOO_BIG_BUTTONS } from "./signing-client.js";
import { IPA_MAX, MEMORY_KEY, OLD_MEMORY_KEY, memoryLimit, noteOutOfMemory, noteSigned, overMemoryLimit, isOutOfMemory } from "./core/websign.js";
import { NAME } from "./brand.js";

const MB = 1048576;
const URL1 = "https://dl.example/Unbound.ipa";
const OOM = "zsign stopped: Out of memory. The app may be too big for this browser.";

test("F261: the limit keeps the smallest out-of-memory size, and a sign at or past it forgets it", () => {
  const s = memStorage();
  assert.equal(memoryLimit(s), null);
  assert.equal(overMemoryLimit(100 * MB, s), false);
  assert.equal(noteOutOfMemory(s, 100 * MB), 100 * MB);
  assert.equal(noteOutOfMemory(s, 120 * MB), 100 * MB); // the smaller stays
  assert.equal(noteOutOfMemory(s, 90 * MB), 90 * MB);
  assert.equal(overMemoryLimit(90 * MB, s), true); // at the size that failed
  assert.equal(overMemoryLimit(89 * MB, s), false);
  assert.equal(overMemoryLimit(null, s), false); // no listed size: nothing to go by
  assert.equal(noteSigned(s, 70 * MB), 90 * MB); // smaller: says nothing about 90
  assert.equal(noteSigned(s, 95 * MB), null); // bigger signed: the failure was the moment's memory
  assert.equal(memoryLimit(s), null);
  assert.equal(s.m.has(MEMORY_KEY), false);
  // a damaged or missing store reads as no limit, and nothing throws
  s.setItem(MEMORY_KEY, "{oops");
  assert.equal(memoryLimit(s), null);
  assert.equal(noteOutOfMemory(null, 5 * MB), null);
  assert.equal(noteOutOfMemory(s, 0), null);
  assert.equal(IPA_MAX, 512 * MB); // the global cap doesn't move
});

test("F435: a limit learned under the old signer is forgotten", () => {
  const s = memStorage();
  s.setItem(OLD_MEMORY_KEY, JSON.stringify({ failed: 100 * MB }));
  assert.equal(memoryLimit(s), null);
  assert.equal(overMemoryLimit(200 * MB, s), false);
  assert.equal(s.m.has(OLD_MEMORY_KEY), false);
  assert.equal(noteOutOfMemory(s, 300 * MB), 300 * MB); // the streaming signer's own limit still works
});

test("F261: zsign's out-of-memory errors are told apart from others", () => {
  assert.equal(isOutOfMemory(OOM), true);
  assert.equal(isOutOfMemory("zsign: Can't find CodeResources."), false);
  assert.equal(isOutOfMemory(undefined), false);
});

test("F261: the alert's words and buttons", () => {
  assert.equal(memoryText("Unbound", 104 * MB, 100 * MB),
    `Unbound is 104 MB. Signing a 100 MB app ran this browser out of memory. Download the IPA and import it into ${NAME} Lite or another sideloader, or try anyway.`);
  assert.deepEqual(MEMORY_BUTTONS, [...TOO_BIG_BUTTONS.slice(0, 3), "Try Anyway", "Cancel"]);
  assert.equal(memoryNote(100 * MB), `${NAME} Lite signs big apps on the phone without this limit. From now on, apps of 100 MB or more open Too Big here first.`);
});

test("F261: Too Big for This iPhone: Try Anyway runs from its tap; Cancel is last", async () => {
  let ran = 0, asked = null;
  const r = await tooBigAlert({ url: URL1, name: "Unbound", size: 104 * MB, limit: 100 * MB }, {
    alert: async (a) => { asked = a; a.onTap(3); return { index: 3 }; }, anyway: () => { ran++; }, storage: memStorage() });
  assert.equal(r, "try");
  assert.equal(ran, 1);
  assert.equal(asked.title, MEMORY_TITLE);
  assert.equal(asked.cancel, 4);
  assert.deepEqual(asked.colors, { 0: "blue" });
  assert.equal(asked.message, memoryText("Unbound", 104 * MB, 100 * MB));
  ran = 0;
  assert.equal(await tooBigAlert({ url: URL1, name: "Unbound", size: 104 * MB, limit: 100 * MB }, {
    alert: async (a) => { a.onTap(4); return { index: 4 }; }, anyway: () => { ran++; } }), "cancel");
  assert.equal(ran, 0);
  // without a limit, index 3 is the plain alert's Cancel (F257), never Try Anyway
  assert.equal(await tooBigAlert({ url: URL1, size: 700 * MB }, { alert: async (a) => { a.onTap(3); return { index: 3 }; }, anyway: () => { ran++; } }), "cancel");
  assert.equal(ran, 0);
});

// A whole run: /api/fetch answers `ipa`, the upload takes it, the worker signs or throws `throws`.
function rig({ ipa, throws = null }) {
  const seen = { fetch: 0, worker: 0, alerts: [] };
  const fetcher = async (url) => {
    const u = new URL(url, "https://ifizbox.example");
    if (u.pathname === "/api/fetch") { seen.fetch++; return new Response(ipa, { headers: { "X-IPA-Length": String(ipa.length) } }); }
    if (u.pathname === "/sign/upload") return Response.json({ token: "t0k", partSize: 1 << 20, parts: 1 });
    if (u.pathname.startsWith("/sign/upload/t0k/")) return Response.json({ ok: true, itms: "itms-services://x" });
    return Response.json({ error: "no" }, { status: 404 });
  };
  const deps = {
    hud: () => ({ set() {}, hide() {} }), alert: async (a) => { seen.alerts.push(a); return { index: 0 }; }, open: () => {},
    identity: async () => ({ p12: new Uint8Array([1]), profile: new Uint8Array([2]), password: "" }), now: () => null, phone: async () => null,
    fetcher, transfer: async () => null,
    worker: async () => {
      seen.worker++;
      if (throws) throw Object.assign(new Error(throws), { code: "sign_failed" });
      return { ipa: new Uint8Array([0x50, 0x4b]), bundleId: "a.b", name: "X", version: "1" };
    },
  };
  return { seen, deps };
}
const zip = (n) => { const b = new Uint8Array(n); b[0] = 0x50; b[1] = 0x4b; return b; };

test("F261: an Out of memory remembers the IPA's size and says what changes", async () => {
  const storage = memStorage();
  const { seen, deps } = rig({ ipa: zip(3000), throws: OOM });
  assert.equal(await signInBrowser({ url: URL1, name: "Unbound" }, { ...deps, storage }), false);
  assert.equal(memoryLimit(storage), 3000);
  assert.equal(seen.alerts.at(-1).message, `${OOM}\n\n${memoryNote(3000)}`);
  // another error remembers nothing
  const other = memStorage();
  const r2 = rig({ ipa: zip(3000), throws: "zsign: Can't find CodeResources." });
  await signInBrowser({ url: URL1, name: "Unbound" }, { ...r2.deps, storage: other });
  assert.equal(memoryLimit(other), null);
  assert.equal(r2.seen.alerts.at(-1).message, "zsign: Can't find CodeResources.");
});

test("F261: an app listed at or past the limit opens the alert before any download; under it goes on", async () => {
  const storage = memStorage();
  noteOutOfMemory(storage, 100 * MB);
  const asked = [];
  const { seen, deps } = rig({ ipa: zip(10) });
  const tooBig = async (app) => { asked.push(app); return "cancel"; };
  assert.equal(await signInBrowser({ url: URL1, name: "Unbound", size: 104 * MB }, { ...deps, storage, tooBig }), false);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].limit, 100 * MB);
  assert.equal(seen.fetch, 0);
  await signInBrowser({ url: URL1, name: "Small", size: 70 * MB }, { ...deps, storage, tooBig });
  assert.equal(asked.length, 1);
  assert.equal(seen.fetch, 1);
});

test("F261: Try Anyway signs it, and a sign at or past the limit forgets it", async () => {
  const storage = memStorage();
  noteOutOfMemory(storage, 2000);
  const { seen, deps } = rig({ ipa: zip(3000) });
  const r = await signInBrowser({ url: URL1, name: "Unbound", size: 3000 }, { ...deps, storage,
    alert: async (a) => { seen.alerts.push(a); if (a.title === MEMORY_TITLE) { a.onTap(3); return { index: 3 }; } return { index: 1 }; } });
  assert.equal(r, true);
  assert.equal(seen.worker, 1);
  assert.equal(seen.alerts[0].title, MEMORY_TITLE);
  assert.equal(memoryLimit(storage), null);
});
