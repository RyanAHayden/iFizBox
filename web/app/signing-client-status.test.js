// F190: after "Installing", the website's log follows iOS's own requests on the link (GET /sign/up/<token>/status).
import { test } from "node:test";
import assert from "node:assert/strict";
import { watchInstall, installSteps, installStage, notAskedText, STATUS_EVERY, STATUS_MIN_SHOW, signInBrowser } from "./signing-client.js";

const TOKEN = "ab".repeat(24);
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const S = (manifest, started, finished) => ({ manifest, started, finished });

// A fake clock (sleep moves it), a status per look (the last repeats), and a HUD that logs with the time.
function rig(seq, { finish = true } = {}) {
  let now = 0, n = 0;
  const log = [], looks = [];
  const fetcher = async (url) => {
    looks.push({ at: now, url });
    const s = seq[Math.min(n++, seq.length - 1)];
    return s === "down" ? Promise.reject(new TypeError("Load failed")) : s === 404 ? json({ error: "no" }, 404) : json(s);
  };
  const h = { set: (t) => log.push([now, t]), done: (t) => log.push([now, "done " + t]), hide: () => log.push([now, "hide"]) };
  if (finish) h.finish = (o) => log.push([now, "finish " + o.label, o]);
  const opened = [], alerts = [];
  const opts = { fetcher, app: "iFizBox", itms: "itms-services://x", open: (u) => opened.push(u), clock: () => now,
    sleep: async (ms) => { now += ms; }, alert: async (a) => { alerts.push(a); a.onTap?.(1); return { index: 1 }; } };
  return { h, log, looks, opened, alerts, opts };
}
const texts = (log) => log.map((l) => l[1]);

test("installStage and the steps", () => {
  assert.equal(installStage(S(false, false, false)), 0);
  assert.equal(installStage(S(true, false, false)), 1);
  assert.equal(installStage(S(false, true, false)), 2, "iOS started the download: the page completes");
  assert.equal(installStage(S(true, true, true)), 2);
  const [wait, down, done] = installSteps("Delta");
  assert.equal(wait, "Waiting for iOS…");
  assert.equal(down, "iOS is asking: tap Install.");
  assert.equal(done, "Sent to iOS. Press Home to watch it install.");
});

test("a normal install steps through waiting, iOS asking, and completes once iOS starts the download, polling every 500 ms", async () => {
  const r = rig([S(false, false, false), S(false, false, false), S(true, false, false), S(true, true, false)]);
  const w = watchInstall(TOKEN, r.h, r.opts);
  await w.first;
  assert.deepEqual(texts(r.log), ["Waiting for iOS…"]);
  assert.equal(await w.end, "installed");
  const [wait, down, done] = installSteps("iFizBox");
  assert.deepEqual(texts(r.log), [wait, down, done, "done " + done]);
  assert.equal(r.looks[0].url, `/sign/up/${TOKEN}/status`);
  const gaps = r.looks.slice(1).map((l, i) => l.at - r.looks[i].at);
  assert.ok(gaps.every((g) => g === STATUS_EVERY), String(gaps));
  assert.equal(STATUS_EVERY, 500);
});

test("a fast install still shows each step for at least 0.4 s", async () => {
  const r = rig([S(true, true, true)]); // all done by the first look
  assert.equal(await watchInstall(TOKEN, r.h, r.opts).end, "installed");
  const [wait, down, done] = installSteps("iFizBox");
  assert.deepEqual(texts(r.log), [wait, down, done, "done " + done]);
  const at = r.log.map((l) => l[0]);
  for (let i = 1; i < 3; i++) assert.ok(at[i] - at[i - 1] >= STATUS_MIN_SHOW, `step ${i} after ${at[i] - at[i - 1]} ms`);
  assert.ok(STATUS_MIN_SHOW >= 300 && STATUS_MIN_SHOW <= 600);
});

test("iOS never asks within a minute: says so, and Retry opens the install link again", async () => {
  const r = rig([S(false, false, false)]);
  assert.equal(await watchInstall(TOKEN, r.h, r.opts).end, "not_asked");
  const fin = r.log.at(-1);
  assert.equal(fin[1], "finish Retry");
  assert.ok(fin[0] >= 60000 && fin[0] < 62000, String(fin[0]));
  assert.ok(texts(r.log).includes(notAskedText));
  assert.equal(r.opened.length, 0);
  assert.equal(fin[2].action(), true); // keeps the page up
  assert.deepEqual(r.opened, ["itms-services://x"]);
  // a HUD without finish: an alert with Install
  const q = rig([S(true, false, false)], { finish: false });
  assert.equal(await watchInstall(TOKEN, q.h, q.opts).end, "not_asked");
  assert.equal(q.alerts[0].message, notAskedText);
  assert.deepEqual(q.opened, ["itms-services://x"]);
});

test("a Worker without /status, or no answer: the page ends on Uploaded; a missed look later is skipped", async () => {
  for (const first of [404, "down"]) {
    const r = rig([first]);
    const w = watchInstall(TOKEN, r.h, r.opts);
    await w.first;
    assert.deepEqual(texts(r.log), ["done Uploaded. Tap Install if iOS asks."]);
    assert.equal(await w.end, "unknown");
  }
  const r = rig([S(true, false, false), "down", S(true, true, true)]);
  assert.equal(await watchInstall(TOKEN, r.h, r.opts).end, "installed");
});

test("the page closed by the user stops the polling", async () => {
  const r = rig([S(true, false, false)]);
  r.h.page = { closed: false };
  const w = watchInstall(TOKEN, r.h, r.opts);
  await w.first;
  r.h.page.closed = true;
  assert.equal(await w.end, "closed");
});

test("signInBrowser hands the early link's token to the watcher after uploading into it", async () => {
  const profile = new TextEncoder().encode(`<?xml version="1.0"?><plist version="1.0"><dict><key>TeamIdentifier</key><array><string>T</string></array>
<key>Entitlements</key><dict><key>application-identifier</key><string>T.com.you.*</string></dict></dict></plist>`);
  const id = { p12: new Uint8Array([0x30, 1]), profile, password: "", passwordOk: true };
  const fetcher = async (url) => {
    const u = new URL(url, "https://x.example");
    if (u.pathname === "/api/fetch") return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
    if (u.pathname === "/sign/upload") return json({ token: u.searchParams.get("token"), partSize: 4, parts: 1, reserved: true });
    if (u.pathname.endsWith("/done")) return json({ itms: "itms-services://done" });
    return json({ ok: true });
  };
  let watched = null;
  const ok = await signInBrowser({ url: "https://github.com/RyanAHayden/iFizBox/releases/latest/download/iFizBox.ipa", name: "iFizBox" }, {
    hud: () => ({ set() {}, hide() {}, done() {} }), alert: async () => ({ index: 0 }), open: () => {}, go: () => {},
    now: () => id, identity: async () => id, fetcher, transfer: async () => null, origin: () => "https://x.example",
    worker: async () => ({ ok: true, ipa: new Uint8Array([0x50, 0x4b, 1]), bundleId: "com.ryha.ifizbox", name: "iFizBox", version: "1" }),
    watch: (token, h, o) => { watched = { token, o }; return { first: Promise.resolve(), end: Promise.resolve("installed") }; },
  });
  assert.equal(ok, true);
  assert.match(watched.token, /^[0-9a-f]{48}$/);
  assert.equal(watched.o.app, "iFizBox");
  assert.match(watched.o.itms, new RegExp(`${watched.token}%2Fmanifest\\.plist`));
});
