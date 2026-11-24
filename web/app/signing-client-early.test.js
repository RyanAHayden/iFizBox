// F121: Install on the website opens iOS's install prompt inside its own tap (before anything waits), for a link
// whose app the upload fills later; the Ready to Install alert only when that can't work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInBrowser, expectedBundleId, earlyLink, reserveUpload, uploadSigned, EARLY_WINDOW } from "./signing-client.js";

const profile = (appId) => new TextEncoder().encode(`junk<?xml version="1.0"?><plist version="1.0"><dict>
<key>TeamIdentifier</key><array><string>TEAM1</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>TEAM1.${appId}</string></dict></dict></plist>junk`);
const idFor = (appId) => ({ p12: new Uint8Array([0x30, 1]), profile: profile(appId), password: "pw", passwordOk: true });
const SELF = "https://github.com/RyanAHayden/iFizBox/releases/latest/download/iFizBox.ipa";
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// The Worker: /api/fetch answers an IPA; /sign/upload reserves (token, no size) or starts (size); parts of 4 bytes.
function fakeServer({ reserveStatus = 200 } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url, "https://ifizbox.example");
    calls.push({ method: init.method ?? "GET", path: u.pathname, q: Object.fromEntries(u.searchParams) });
    if (u.pathname === "/api/fetch") return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
    if (u.pathname === "/sign/upload") {
      const token = u.searchParams.get("token");
      if (!u.searchParams.has("size")) return reserveStatus === 200 ? json({ token, reserved: true }) : json({ error: "no" }, reserveStatus);
      return json({ token: token ?? "t0k", partSize: 4, parts: Math.ceil(Number(u.searchParams.get("size")) / 4) });
    }
    const done = /^\/sign\/upload\/(\w+)\/done$/.exec(u.pathname);
    if (done) return json({ itms: `itms-services://?action=download-manifest&url=${done[1]}`, expiresIn: 600 });
    if (/^\/sign\/upload\/\w+\/\d+$/.test(u.pathname)) return json({ ok: true });
    return json({ error: "no" }, 404);
  };
  return { fetcher, calls };
}

function deps(id, over = {}) {
  const log = { order: [], alerts: [], opened: [], hud: [] };
  const d = {
    hud: (t) => { log.hud.push(t); return { set: (x) => log.hud.push(x), hide: () => log.hud.push("hide"), done: (x) => log.hud.push("done " + x) }; },
    alert: async (a) => { log.alerts.push(a.title); const index = a.title === "Ready to Install" ? 1 : 0; a.onTap?.(index); return { index }; },
    open: (u) => { log.order.push("open"); log.opened.push(u); },
    go: () => {},
    now: () => id,
    identity: async () => { log.order.push("identity"); return id; },
    worker: async () => ({ ok: true, ipa: new Uint8Array([0x50, 0x4b, 1, 2, 3]), bundleId: "com.ryha.ifizbox", name: "iFizBox", version: "0.4" }),
    transfer: async () => null,
    origin: () => "https://ifizbox.example",
    ...over,
  };
  return { d, log };
}

test("F237: expectedBundleId with Keep Bundle IDs (the default): the app's own ID when known, iFizBox's own too (F280)", () => {
  assert.equal(expectedBundleId(idFor("com.you.app"), { url: "https://x/a.ipa", bundleId: "io.dev.delta" }), "io.dev.delta");
  assert.equal(expectedBundleId(idFor("com.you.*"), { url: "https://x/a.ipa", bundleId: "io.dev.delta" }), "io.dev.delta");
  assert.equal(expectedBundleId(idFor("com.you.app"), { url: "https://x/a.ipa" }), null); // its own ID comes with the download
  assert.equal(expectedBundleId(idFor("com.you.*"), { url: SELF }), "com.ryha.ifizbox");
  assert.equal(expectedBundleId(idFor("com.you.app"), { url: SELF }), "com.ryha.ifizbox");
});

test("expectedBundleId (Keep Bundle IDs off): explicit profiles, wildcards with a known app ID, else null", () => {
  const off = (o) => ({ ...o, keep: false });
  assert.equal(expectedBundleId(idFor("com.you.app"), off({ url: "https://x/a.ipa" })), "com.you.app");
  assert.equal(expectedBundleId(idFor("com.you.*"), off({ url: SELF })), "com.you.ifizbox");
  assert.equal(expectedBundleId(idFor("com.you.*"), off({ url: "https://x/a.ipa", bundleId: "io.dev.delta" })), "com.you.delta");
  assert.equal(expectedBundleId(idFor("*"), off({ url: "https://x/a.ipa", bundleId: "io.dev.delta" })), "io.dev.delta");
  assert.equal(expectedBundleId(idFor("com.you.*"), off({ url: "https://x/a.ipa" })), null); // its own ID comes with the download
  assert.equal(expectedBundleId(null, { url: SELF }), null);
  assert.equal(expectedBundleId({ p12: new Uint8Array(1), profile: new Uint8Array([1, 2]) }, { url: SELF }), null); // not a profile
  assert.equal(expectedBundleId({ ...idFor("com.you.app"), passwordOk: null }, { url: SELF }), null); // password never checked: no early link
});

test("earlyLink: a fresh 48-hex token and the itms link to its manifest", () => {
  const app = { bundleId: "com.you.ifizbox", name: "iFizBox & Co", version: "0.4" };
  const a = earlyLink("https://ifizbox.com", app), b = earlyLink("https://ifizbox.com", app);
  assert.match(a.token, /^[0-9a-f]{48}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.manifest, `https://ifizbox.com/sign/up/${a.token}/manifest.plist?bundleid=com.you.ifizbox&version=0.4&title=iFizBox+%26+Co`);
  assert.equal(a.itms, "itms-services://?action=download-manifest&url=" + encodeURIComponent(a.manifest));
});

test("Install with the bundle ID known: iOS's prompt opens first, reserved, then signed and uploaded into it; no alert", async () => {
  const srv = fakeServer();
  const { d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher });
  let recorded = null;
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox", onInstalled: (r) => { recorded = r; } }, d), true);
  assert.deepEqual(log.order.slice(0, 2), ["open", "identity"]); // the link opened before anything waited
  const token = /%2Fsign%2Fup%2F([0-9a-f]{48})%2Fmanifest\.plist%3Fbundleid%3Dcom\.ryha\.ifizbox%26/.exec(log.opened[0])?.[1];
  assert.ok(token, log.opened[0]);
  assert.equal(log.opened.length, 1);
  assert.deepEqual(log.alerts, []);
  const ups = srv.calls.filter((c) => c.path === "/sign/upload");
  assert.deepEqual(ups.map((c) => [c.q.token, c.q.bundleid, "size" in c.q]), [[token, "com.ryha.ifizbox", false], [token, "com.ryha.ifizbox", true]]);
  assert.ok(srv.calls.some((c) => c.path === `/sign/upload/${token}/done`));
  assert.equal(recorded.bundleId, "com.ryha.ifizbox");
  assert.equal(log.hud.at(-1), "done Uploaded. Tap Install if iOS asks.");
});

test("the early link falls back to Ready to Install: another bundle ID came out, the reservation failed, too slow", async () => {
  // signed under another ID than reserved: a fresh upload, and the alert opens its link
  let srv = fakeServer();
  let { d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher,
    worker: async () => ({ ok: true, ipa: new Uint8Array([0x50, 0x4b, 1]), bundleId: "com.you.other", name: "Other", version: "1" }) });
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, d), true);
  assert.deepEqual(log.alerts, ["Ready to Install"]);
  assert.equal(log.opened.length, 2);
  assert.equal(log.opened[1], "itms-services://?action=download-manifest&url=t0k");
  assert.equal(srv.calls.filter((c) => c.path === "/sign/upload").at(-1).q.token, undefined);

  srv = fakeServer({ reserveStatus: 500 });
  ({ d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher }));
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, d), true);
  assert.deepEqual(log.alerts, ["Ready to Install"]);
  assert.equal(log.opened[1], "itms-services://?action=download-manifest&url=t0k");

  // past iOS's wait: the same (now finished) link again, from the alert's tap
  let t = 0;
  srv = fakeServer();
  ({ d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher, clock: () => (t += EARLY_WINDOW) }));
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, d), true);
  assert.deepEqual(log.alerts, ["Ready to Install"]);
  const token = /%2Fsign%2Fup%2F([0-9a-f]{48})%2F/.exec(log.opened[0])[1];
  assert.equal(log.opened[1], `itms-services://?action=download-manifest&url=${token}`);
});

test("no profile in memory, or its bundle ID unknown before signing: today's flow (alert), nothing opened early", async () => {
  for (const [now, url] of [[null, SELF], [idFor("com.you.*"), "https://x/Delta.ipa"]]) {
    const srv = fakeServer();
    const { d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher, now: () => now });
    assert.equal(await signInBrowser({ url, name: "Delta" }, d), true);
    assert.equal(log.order[0], "identity");
    assert.deepEqual(log.alerts, ["Ready to Install"]);
    assert.equal(log.opened.length, 1);
    assert.ok(!srv.calls.some((c) => c.path === "/sign/upload" && !("size" in c.q)));
  }
});

test("an error after the early open still says why in an alert", async () => {
  const srv = fakeServer();
  const { d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher, worker: async () => { throw Object.assign(new Error("zsign: bad p12"), { code: "sign_failed" }); } });
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, d), false);
  assert.equal(log.opened.length, 1);
  assert.deepEqual(log.alerts, ["Couldn't Install iFizBox"]);
});

test("reserveUpload and uploadSigned with a token", async () => {
  const srv = fakeServer();
  assert.equal(await reserveUpload("a".repeat(48), { bundleId: "com.a", name: "", version: "" }, { fetcher: srv.fetcher }), true);
  assert.deepEqual(srv.calls[0].q, { bundleid: "com.a", version: "1.0", title: "com.a", token: "a".repeat(48) });
  const bad = fakeServer({ reserveStatus: 409 });
  assert.equal(await reserveUpload("b".repeat(48), { bundleId: "com.a" }, { fetcher: bad.fetcher }), false);
  const down = async () => { throw new TypeError("Load failed"); };
  assert.equal(await reserveUpload("c".repeat(48), { bundleId: "com.a" }, { fetcher: down, wait: async () => {} }), false);
  await uploadSigned(new Uint8Array([0x50, 0x4b, 1]), { bundleId: "com.a" }, { fetcher: srv.fetcher, token: "d".repeat(48) });
  assert.equal(srv.calls.find((c) => "size" in c.q).q.token, "d".repeat(48));
});

test("F132: a slow sign/upload still lands in the early link for minutes (iOS retries app.ipa 5+ minutes): no alert", async () => {
  assert.ok(EARLY_WINDOW >= 5 * 60 * 1000 && EARLY_WINDOW <= 10 * 60 * 1000, String(EARLY_WINDOW)); // R14's retries; the upload TTL
  for (const late of [111 * 1000, 5 * 60 * 1000, EARLY_WINDOW - 1]) {
    let calls = 0;
    const srv = fakeServer();
    const { d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher, clock: () => (calls++ ? late : 0) });
    assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, d), true);
    assert.deepEqual(log.alerts, [], `alert after ${late} ms`);
    assert.equal(log.opened.length, 1);
    assert.equal(log.hud.at(-1), "done Uploaded. Tap Install if iOS asks.");
  }
  // at the window: Ready to Install, opening the same link again
  let calls = 0;
  const srv = fakeServer();
  const { d, log } = deps(idFor("com.you.*"), { fetcher: srv.fetcher, clock: () => (calls++ ? EARLY_WINDOW : 0) });
  assert.equal(await signInBrowser({ url: SELF, name: "iFizBox" }, d), true);
  assert.deepEqual(log.alerts, ["Ready to Install"]);
  assert.equal(log.opened.length, 2);
});
