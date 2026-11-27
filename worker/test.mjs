// node worker/test.mjs: the Worker's routes against an in-memory KV.
import assert from "node:assert/strict";
import w, { manifest, allowed, loopbackUrl, appOf } from "./src/index.js";
const store = new Map();
const kvReads = [], kvCancels = []; // B96: every KV get's type, every KV stream cancelled
const env = { HOST_IDS: "*.ifizbox", TTL: "600", FETCH_RATE: "0", HOST_RATE: "0", UPLOAD_RATE: "0", HOSTED: { // F312's limits: tested on their own
  put: async (k, v, o) => store.set(k, { v, m: o.metadata }),
  // B95: type "stream" as KV gives it (app.ipa pipes whole parts), the value in two chunks
  get: async (k, o) => {
    const v = store.get(k)?.v ?? null;
    kvReads.push({ k, type: o?.type ?? "text" });
    if (v === null || o?.type !== "stream") return v;
    const b = new Uint8Array(v), half = b.length >> 1, chunks = [b.slice(0, half), b.slice(half)];
    // B96: pulled a chunk at a time, so a reader that stops early leaves the rest unread (counted in kvCancels)
    return new ReadableStream({ pull(c) { chunks.length ? c.enqueue(chunks.shift()) : c.close(); },
      cancel() { kvCancels.push({ k, left: chunks.length }); } }, { highWaterMark: 0 });
  },
  getWithMetadata: async (k) => ({ value: null, metadata: store.get(k)?.m ?? null }) } };
const go = (path, init) => w.fetch(new Request("https://sign.example" + path, init), env);

assert.deepEqual(await (await go("/sign/status")).json(), { ok: true, ttl: 600, worker: true, zsign: false, upload: 512 * 1024 * 1024 });
let r = await go("/sign/manifest?bundleid=com.a.b&version=1.2&title=A%20%26%20B&port=8080&path=x/app.ipa");
let t = await r.text();
assert.match(t, /<string>http:\/\/127\.0\.0\.1:8080\/x\/app\.ipa<\/string>/);
assert.match(t, /<string>A &amp; B<\/string>/);
assert.equal((await go("/sign/manifest?bundleid=com.a&port=80&path=../../etc")).status, 200); // a path on the phone
assert.equal((await go("/sign/manifest?bundleid=com.a&port=x&path=a")).status, 400);
assert.equal(loopbackUrl(new URLSearchParams("port=1&path=a b")), null);
assert.ok(allowed("com.ryha.ifizbox") && allowed("com.team.ifizbox") && !allowed("com.evil.app"));
assert.equal(appOf(new URLSearchParams("bundleid=a/b")), null);

const ipa = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6]);
r = await go("/sign/host?bundleid=com.evil.app&version=1", { method: "POST", body: ipa, headers: { "Content-Length": "10" } });
assert.equal(r.status, 403);
r = await go("/sign/host?bundleid=com.ryha.ifizbox&version=0.3.2&title=iFizBox", { method: "POST", body: ipa, headers: { "Content-Length": "10" } });
const j = await r.json();
assert.match(j.itms, /^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2Fsign\.example%2Fsign%2Fhost%2F[0-9a-f]{48}%2Fmanifest\.plist$/);
t = await (await go(new URL(j.manifest).pathname)).text();
assert.match(t, /\/app\.ipa<\/string>/);
assert.match(t, /<string>com\.ryha\.ifizbox<\/string>/);
const ipaPath = new URL(j.manifest).pathname.replace("manifest.plist", "app.ipa");
assert.deepEqual(new Uint8Array(await (await go(ipaPath)).arrayBuffer()), ipa);
r = await go(ipaPath, { headers: { Range: "bytes=2-4" } });
assert.equal(r.status, 206);
assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [3, 4, 1]);
assert.equal((await w.fetch(new Request("https://sign.example/sign/host/" + "0".repeat(48) + "/app.ipa"), { ...env, WAIT_SCALE: "0.002" })).status, 404);
r = await go("/sign/host?bundleid=com.ryha.ifizbox&version=1", { method: "POST", body: new Uint8Array([1, 2]), headers: { "Content-Length": "2" } });
assert.equal(r.status, 400); // not a zip
console.log("worker: ok");
import { httpUrl } from "./src/index.js";
assert.equal(httpUrl("ftp://x"), null);
assert.equal(httpUrl("https://u:p@x/"), null);
assert.ok(httpUrl("https://repo.example/"));
const bad = await go("/api/fetch?url=file:///etc/passwd");
assert.equal(bad.status, 400);
console.log("worker fetch: ok");

// F93: the website's signed IPA, uploaded in parts and served back whole (Range too).
import { PART, uploadCap } from "./src/index.js";
{
  assert.equal(uploadCap({}), 512 * 1024 * 1024);
  assert.equal(uploadCap({ MAX_UPLOAD_MB: "0" }), 0);
  assert.equal((await (await go("/sign/status")).json()).upload, 512 * 1024 * 1024);
  const size = PART + 5;
  const app = new Uint8Array(size);
  app[0] = 0x50; app[1] = 0x4b;
  for (let i = 2; i < size; i++) app[i] = i % 251;
  let r = await go(`/sign/upload?bundleid=com.any.app&version=2.0&title=Any&size=${size}`, { method: "POST" });
  const up = await r.json();
  assert.equal(r.status, 200);
  assert.equal(up.parts, 2);
  assert.equal(up.partSize, PART);
  const put = (i, body) => go(`/sign/upload/${up.token}/${i}`, { method: "PUT", body });
  // not finished: no link yet, and done refuses while a part is missing
  assert.equal((await go(`/sign/up/${up.token}/manifest.plist`)).status, 404);
  assert.equal((await put(0, app.slice(0, PART))).status, 200);
  assert.equal((await go(`/sign/upload/${up.token}/done`, { method: "POST" })).status, 409);
  assert.equal((await put(1, app.slice(PART, PART + 2))).status, 400); // wrong length
  assert.equal((await put(2, app.slice(PART))).status, 400);           // no such part
  assert.equal((await put(1, app.slice(PART))).status, 200);
  r = await go(`/sign/upload/${up.token}/done`, { method: "POST" });
  const done = await r.json();
  assert.equal(r.status, 200, JSON.stringify(done));
  assert.match(done.itms, /^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2Fsign\.example%2Fsign%2Fup%2F[0-9a-f]{48}%2Fmanifest\.plist$/);
  t = await (await go(new URL(done.manifest).pathname)).text();
  assert.match(t, /<string>com\.any\.app<\/string>/);
  assert.match(t, /\/sign\/up\/[0-9a-f]{48}\/app\.ipa<\/string>/);
  const appPath = `/sign/up/${up.token}/app.ipa`;
  r = await go(appPath);
  assert.equal(r.headers.get("content-length"), String(size));
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), app);
  r = await go(appPath, { headers: { Range: `bytes=${PART - 2}-${PART + 1}` } }); // across the parts
  assert.equal(r.status, 206);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [...app.slice(PART - 2, PART + 2)]);
  // B96: a Range's cut parts are streamed, never read whole: a Range in the first part's first half stops (cancels)
  // KV's read with the second half unread; one from the middle of a part to the end skips, then pipes the rest
  const ranged = async (range, want) => {
    kvReads.length = 0; kvCancels.length = 0;
    r = await go(appPath, { headers: { Range: range } });
    assert.equal(r.status, 206);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), want, range);
    assert.ok(kvReads.filter((g) => /^up\.[0-9a-f]{48}\.\d+$/.test(g.k)).every((g) => g.type === "stream"), JSON.stringify(kvReads));
  };
  await ranged("bytes=10-20", app.slice(10, 21));
  assert.deepEqual(kvCancels.map((c) => c.left), [1]);
  await ranged(`bytes=${PART / 2 + 3}-`, app.slice(PART / 2 + 3));
  await ranged("bytes=-3", app.slice(size - 3));
  await ranged(`bytes=${PART / 2 - 1}-${PART / 2}`, app.slice(PART / 2 - 1, PART / 2 + 1)); // across KV's chunks
  await ranged(`bytes=0-${PART - 1}`, app.slice(0, PART)); // a whole part, piped
  assert.equal((await go(appPath, { method: "HEAD" })).headers.get("content-length"), String(size));
  // too big, not a zip, finished twice, uploads off
  assert.equal((await go(`/sign/upload?bundleid=com.a&size=${600 * 1024 * 1024}`, { method: "POST" })).status, 413);
  const z = await (await go(`/sign/upload?bundleid=com.a&size=4`, { method: "POST" })).json();
  assert.equal((await go(`/sign/upload/${z.token}/0`, { method: "PUT", body: new Uint8Array([1, 2, 3, 4]) })).status, 400);
  assert.equal((await go(`/sign/upload/${up.token}/done`, { method: "POST" })).status, 409);
  const off = await w.fetch(new Request("https://sign.example/sign/upload?bundleid=com.a&size=9", { method: "POST" }), { ...env, MAX_UPLOAD_MB: "0" });
  assert.equal(off.status, 403);
  // the website's own files that start with /sign go to the assets, the server's paths don't
  const assets = { fetch: async (q) => new Response("asset " + new URL(q.url).pathname) };
  const site = (path) => w.fetch(new Request("https://sign.example" + path), { ...env, ASSETS: assets });
  assert.equal(await (await site("/signing-worker.js")).text(), "asset /signing-worker.js");
  assert.equal((await site("/sign/nothing")).status, 404);
  console.log("worker upload: ok");
}
{
  const { upstream, releaseFile } = await import("./src/index.js");
  assert.ok(releaseFile("https://github.com/RyanAHayden/iFizBox/releases/download/v0.3.6/iFizBox.ipa"));
  assert.equal(releaseFile("https://raw.githubusercontent.com/o/r/main/source.json"), false);
  const answers = [429, 503, 200];
  const seen = [];
  const r = await upstream("https://github.com/o/r/releases/download/v1/a.ipa", { wait: async () => {},
    fetcher: async (u, o) => { seen.push(o.cf.cacheTtlByStatus); return new Response("x", { status: answers.shift(), headers: {} }); } });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, Array(3).fill({ "200-299": 86400, "300-599": 0 })); // retried twice; only a 2xx is cached at the edge
  const asked = [];
  const again = await upstream("https://github.com/o/r/releases/download/v1/a.ipa", { wait: async () => {},
    fetcher: async (u, o) => { asked.push(o.cache ?? "edge"); return new Response("x", { status: asked.length === 1 ? 404 : 200 }); } });
  assert.equal(again.status, 200);
  assert.deepEqual(asked, ["edge", "no-store"]); // a release file's 404 is asked once more past the edge cache
  console.log("worker upstream: ok");
}
{
  const { upstream, githubRelease } = await import("./src/index.js");
  assert.deepEqual(githubRelease("https://github.com/FIZL0/opentennis/releases/download/v1.7.1/opentennis-ios.ipa"),
    { owner: "FIZL0", repo: "opentennis", tag: "v1.7.1", file: "opentennis-ios.ipa" });
  assert.equal(githubRelease("https://github.com/o/r/releases/latest/download/C.ipa").tag, null);
  assert.equal(githubRelease("https://example.com/a.ipa"), null);
  const calls = [];
  const fetcher = async (u, o = {}) => {
    calls.push([u, o.headers?.Authorization ? "auth" : "anon"]);
    if (u.startsWith("https://github.com/")) return new Response("slow down", { status: 429 });
    if (u.includes("/releases/tags/")) return Response.json({ assets: [{ name: "a.ipa", url: "https://api.github.com/repos/o/r/releases/assets/9" }] });
    if (u.endsWith("/assets/9")) return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/x" } });
    return new Response("IPA");
  };
  const r = await upstream("https://github.com/o/r/releases/download/v1/a.ipa", { fetcher, wait: async () => {}, token: "t" });
  assert.equal(await r.text(), "IPA");
  assert.deepEqual(calls.at(-1), ["https://release-assets.githubusercontent.com/x", "anon"]); // the blob store never sees the token
  const none = await upstream("https://github.com/o/r/releases/download/v1/a.ipa", { fetcher, wait: async () => {} });
  assert.equal(none.status, 429); // no token: as before
  console.log("worker github token: ok");
}

// F97: iFizBox Account: the size cap, the version check (409), delete, and KV never keyed by the id itself.
import { account, MAX_ACCOUNT, rateLimiter, kvKey, bindingLimiter } from "./src/account.js";
{
  const kv = new Map();
  const aenv = { HOSTED: {
    put: async (k, v, o) => kv.set(k, { v, m: o?.metadata ?? null }),
    getWithMetadata: async (k) => ({ value: kv.get(k)?.v ?? null, metadata: kv.get(k)?.m ?? null }),
    delete: async (k) => { kv.delete(k); } } };
  const id = "ab".repeat(32);
  const send = (method, { body, headers = {}, limit = rateLimiter({ rate: 1000, writes: 1000 }), path = `/api/account/${id}` } = {}) =>
    account(new Request("https://ifizbox.example" + path, { method, body, headers }), aenv, { limit });
  const blob = (n, fill = 7) => new Uint8Array(n).fill(fill);

  assert.equal((await send("GET")).status, 404);
  assert.equal((await send("GET", { path: "/api/account/xyz" })).status, 404);
  assert.equal((await send("POST")).status, 405);
  // make it: If-None-Match: *
  let r = await send("PUT", { body: blob(100), headers: { "If-None-Match": "*" } });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get("ETag"), '"1"');
  assert.deepEqual([...kv.keys()], [await kvKey(id)]);
  assert.ok(![...kv.keys()][0].includes(id), "KV's key isn't the id");
  r = await send("GET");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("ETag"), '"1"');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), blob(100));
  // a second device that made it too, or wrote without the version: 409 with the current ETag
  r = await send("PUT", { body: blob(100, 1), headers: { "If-None-Match": "*" } });
  assert.equal(r.status, 409);
  assert.equal(r.headers.get("ETag"), '"1"');
  assert.equal((await send("PUT", { body: blob(100, 1) })).status, 409);
  // the right version replaces it; the old one then conflicts
  r = await send("PUT", { body: blob(120, 2), headers: { "If-Match": '"1"' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { version: 2 });
  r = await send("PUT", { body: blob(120, 3), headers: { "If-Match": '"1"' } });
  assert.equal(r.status, 409);
  assert.equal(r.headers.get("ETag"), '"2"');
  assert.deepEqual(new Uint8Array(await (await send("GET")).arrayBuffer()), blob(120, 2));
  // the size cap: by the header, and by what really came
  assert.equal((await send("PUT", { body: blob(MAX_ACCOUNT + 1), headers: { "If-Match": '"2"' } })).status, 413);
  const big = new ReadableStream({ start(c) { c.enqueue(blob(MAX_ACCOUNT)); c.enqueue(blob(10)); c.close(); } });
  r = await account(new Request(`https://ifizbox.example/api/account/${id}`, { method: "PUT", body: big, duplex: "half",
    headers: { "If-Match": '"2"' } }), aenv, { limit: rateLimiter({ rate: 9, writes: 9 }) });
  assert.equal(r.status, 413);
  assert.equal((await send("PUT", { body: blob(MAX_ACCOUNT), headers: { "If-Match": '"2"' } })).status, 200);
  assert.equal((await send("PUT", { body: blob(5), headers: { "If-Match": '"3"' } })).status, 400); // too short to be ciphertext
  // delete, then it's gone
  assert.equal((await send("DELETE")).status, 200);
  assert.equal((await send("GET")).status, 404);
  assert.equal(kv.size, 0);
  // per address: writes run out before reads
  const lim = rateLimiter({ rate: 2, writes: 1 });
  assert.equal((await send("PUT", { body: blob(40), headers: { "If-None-Match": "*" }, limit: lim })).status, 201);
  assert.equal((await send("PUT", { body: blob(40), headers: { "If-Match": '"1"' }, limit: lim })).status, 429);
  assert.equal((await send("GET", { limit: lim })).status, 200);
  assert.equal((await send("GET", { limit: lim })).status, 429);
  assert.ok(lim.allow("?", true, Date.now() + 61000), "a new minute");
  // F98: Cloudflare's Rate Limiting bindings, when bound, count instead of memory (shared across isolates)
  const fakeRL = (n) => { const used = new Map(); return { keys: used, async limit({ key }) {
    const k = used.get(key) ?? 0; used.set(key, k + 1); return { success: k < n }; } }; };
  const all = fakeRL(3), wr = fakeRL(1); // the refused write still took one from all
  const benv = { ...aenv, ACCOUNT_RATE_LIMIT: all, ACCOUNT_WRITE_LIMIT: wr };
  const bsend = (method, opts = {}) => account(new Request(`https://ifizbox.example/api/account/${id}`, { method, ...opts }), benv);
  assert.equal((await bsend("DELETE")).status, 200);
  assert.equal((await bsend("DELETE")).status, 429, "writes run out first");
  assert.equal((await bsend("GET")).status, 404);
  assert.equal((await bsend("GET")).status, 429);
  assert.deepEqual([...all.keys.keys()], ["?"]);
  // one binding only: writes count under "w:<ip>" in it
  const one = fakeRL(1), solo = bindingLimiter(one, null, rateLimiter({ rate: 0, writes: 0 }));
  assert.equal(await solo.allow("1.2.3.4", true), true);
  assert.deepEqual([...one.keys.keys()], ["1.2.3.4", "w:1.2.3.4"]);
  // a binding that throws falls back to the memory limiter
  const broken = { async limit() { throw new Error("down"); } };
  const fb = rateLimiter({ rate: 1, writes: 1 });
  assert.equal(await bindingLimiter(broken, null, fb).allow("x", false), true);
  assert.equal(await bindingLimiter(broken, null, fb).allow("x", false), false);
  assert.equal((await account(new Request(`https://ifizbox.example/api/account/${id}`), { ...aenv, ACCOUNT_RATE_LIMIT: broken })).status, 404);
  // through the Worker: the route, and CORS for the app's ifizbox://app page
  const pre = await w.fetch(new Request(`https://ifizbox.example/api/account/${id}`, { method: "OPTIONS" }), aenv);
  assert.match(pre.headers.get("Access-Control-Allow-Methods"), /PUT/);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /If-Match/);
  assert.equal((await w.fetch(new Request(`https://ifizbox.example/api/account/${id}`), aenv)).headers.get("Access-Control-Expose-Headers"), "ETag");
  console.log("worker account: ok");
}

// F121: the website's own token, opened as an install link inside the Install tap before it signs: the manifest waits
// for the reservation, app.ipa until the upload's done (waits scaled down: WAIT_SCALE).
import { waitFor, MANIFEST_WAIT, IPA_WAIT } from "./src/index.js";
{
  assert.ok(MANIFEST_WAIT <= 20000 && IPA_WAIT >= 60000);
  // held requests get room (POLL 75 ms, manifest 0.75 s, app.ipa 6 s) so a loaded machine can't time them out;
  // the give-up cases are fast (POLL 3 ms, manifest 30 ms, app.ipa 240 ms)
  const at = (path, init) => w.fetch(new Request("https://sign.example" + path, init), { ...env, WAIT_SCALE: "0.05" });
  const quick = (path, init) => w.fetch(new Request("https://sign.example" + path, init), { ...env, WAIT_SCALE: "0.002" });
  const tok = "ab".repeat(24), app = new Uint8Array([0x50, 0x4b, 9, 8, 7, 6]);
  assert.equal((await at(`/sign/upload?bundleid=com.a&token=xyz`, { method: "POST" })).status, 400);
  // iOS asks for the manifest before the reservation lands: it waits, then answers with the reserved app
  const early = at(`/sign/up/${tok}/manifest.plist`);
  await new Promise((r) => setTimeout(r, 5));
  let r = await at(`/sign/upload?bundleid=com.ryha.ifizbox&version=0.4&title=iFizBox&token=${tok}`, { method: "POST" });
  assert.deepEqual(await r.json(), { token: tok, reserved: true, expiresIn: 600 });
  r = await early;
  assert.equal(r.status, 200);
  assert.match(await r.text(), new RegExp(`<string>com\\.ryha\\.ifizbox</string>[\\s\\S]*/sign/up/${tok}/app\\.ipa|/sign/up/${tok}/app\\.ipa[\\s\\S]*<string>com\\.ryha\\.ifizbox</string>`));
  // a reserved token can't be taken for another app, nor its parts sent before its size
  assert.equal((await at(`/sign/upload?bundleid=com.other&size=6&token=${tok}`, { method: "POST" })).status, 409);
  assert.equal((await at(`/sign/upload/${tok}/0`, { method: "PUT", body: app })).status, 409);
  // app.ipa holds while the website signs; its headers come once the upload starts, its body once it's done
  const held = at(`/sign/up/${tok}/app.ipa`);
  r = await at(`/sign/upload?bundleid=com.ryha.ifizbox&version=0.4&title=iFizBox&token=${tok}&size=${app.length}`, { method: "POST" });
  assert.equal((await r.json()).parts, 1);
  r = await held;
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-length"), String(app.length));
  const ranged = at(`/sign/up/${tok}/app.ipa`, { headers: { Range: "bytes=2-3" } }); // a Range waits for done
  let answered = false;
  const whole = r.arrayBuffer().then((b) => { answered = true; return b; });
  assert.equal((await at(`/sign/upload/${tok}/0`, { method: "PUT", body: app })).status, 200);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(answered, false);
  const done = await (await at(`/sign/upload/${tok}/done`, { method: "POST" })).json();
  assert.equal(new URL(done.manifest).pathname, `/sign/up/${tok}/manifest.plist`);
  assert.deepEqual(new Uint8Array(await whole), app);
  r = await ranged;
  assert.equal(r.status, 206);
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [9, 8]);
  // started once: the token is taken now
  assert.equal((await at(`/sign/upload?bundleid=com.ryha.ifizbox&size=6&token=${tok}`, { method: "POST" })).status, 409);
  // the link's own query: the manifest answers at once, before any reservation
  const t3 = "ef".repeat(24), t3s = Date.now();
  r = await go(`/sign/up/${t3}/manifest.plist?bundleid=com.you.delta&version=1.2&title=Delta`);
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t3s < 1000);
  assert.match(await r.text(), /<string>com\.you\.delta<\/string>/);
  // nothing reserved: the manifest gives up after its wait; a reservation never uploaded: app.ipa gives up after its
  const t2 = "cd".repeat(24);
  assert.equal((await quick(`/sign/up/${t2}/manifest.plist`)).status, 404);
  await quick(`/sign/upload?bundleid=com.a&token=${t2}`, { method: "POST" });
  r = await quick(`/sign/up/${t2}/app.ipa`);
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /in time/);
  // a plain upload's link still doesn't wait: 404 at once while it isn't done
  const plainUp = await (await go(`/sign/upload?bundleid=com.a&size=4`, { method: "POST" })).json();
  const t0 = Date.now();
  assert.equal((await go(`/sign/up/${plainUp.token}/app.ipa`)).status, 404);
  assert.ok(Date.now() - t0 < 1000);
  // B95: the website's sign failed: iOS's held app.ipa answers at once, and the link's later requests too; the token
  // can't be started after it, and a link whose upload began can't be failed
  const t4 = "f4".repeat(24);
  await at(`/sign/upload?bundleid=com.a&version=1&title=A&token=${t4}`, { method: "POST" });
  const held4 = at(`/sign/up/${t4}/app.ipa`), t4s = Date.now();
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(await (await at(`/sign/upload/${t4}/fail`, { method: "POST" })).json(), { ok: true });
  r = await held4;
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /stopped/);
  assert.ok(Date.now() - t4s < 3000, "answered once the fail landed, not after the whole wait");
  assert.equal((await at(`/sign/up/${t4}/manifest.plist?bundleid=com.a&version=1&title=A`)).status, 404);
  assert.equal((await at(`/sign/up/${t4}/app.ipa`, { method: "HEAD" })).status, 404);
  assert.equal((await at(`/sign/upload?bundleid=com.a&token=${t4}&size=6`, { method: "POST" })).status, 409);
  assert.equal((await at(`/sign/upload/${t4}/fail`, { method: "POST" })).status, 200); // again: nothing more
  const t5 = "f5".repeat(24); // failed before its reservation landed: the reservation can't take it back
  assert.equal((await at(`/sign/upload/${t5}/fail`, { method: "POST" })).status, 200);
  assert.equal((await at(`/sign/upload?bundleid=com.a&version=1&title=A&token=${t5}`, { method: "POST" })).status, 409);
  assert.equal((await at(`/sign/up/${t5}/manifest.plist?bundleid=com.a&version=1&title=A`)).status, 404);
  assert.equal((await at(`/sign/upload/${tok}/fail`, { method: "POST" })).status, 409);
  // waitFor: looks until ok or out of time
  let n = 0;
  assert.equal(await waitFor(async () => ++n, (v) => v === 3, 60000, {}, async () => {}), 3);
  console.log("worker reserved link: ok");
}
{
  // B17: /repo/ serves iFizBox's APT repo itself (the release asset fetched here, GitHub's redirect followed here):
  // Zebra names its cache file after the final URL, and GitHub's signed one is too long for it.
  const { repo, repoFile } = await import("./src/index.js");
  assert.deepEqual(repoFile("/repo/Release"), { name: "Release", type: "text/plain; charset=utf-8" });
  assert.equal(repoFile("/repo/Packages.gz").type, "application/gzip");
  assert.equal(repoFile("/repo/com.ryha.ifizbox_0.3.0-12_iphoneos-arm64.deb").name, "com.ryha.ifizbox_0.3.0-12_iphoneos-arm64.deb");
  for (const bad of ["/repo/InRelease", "/repo/Packages.xz", "/repo/..%2Fx.deb", "/repo/a/b.deb", "/repo/.deb", "/repo/%E0.deb"]) assert.equal(repoFile(bad), null, bad);
  const seen = [];
  const fetcher = async (url, o = {}) => {
    seen.push(url);
    assert.equal(o.redirect, "follow");
    if (url.endsWith("/Release")) return new Response("Origin: iFizBox\n", { headers: { "content-length": "15", "last-modified": "Wed, 18 Nov 2026 10:00:00 GMT" } });
    if (url.endsWith("/Packages.gz")) return new Response(new Uint8Array([0x1f, 0x8b, 8]));
    return new Response("no", { status: 404 });
  };
  const at = (path, init) => { const req = new Request("https://ifizbox.example" + path, init); return repo(req, new URL(req.url), {}, { fetcher, wait: async () => {} }); };
  let r = await at("/repo/Release");
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "Origin: iFizBox\n");
  assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(r.headers.get("last-modified"), "Wed, 18 Nov 2026 10:00:00 GMT");
  assert.equal(seen.pop(), "https://github.com/RyanAHayden/iFizBox/releases/latest/download/Release");
  r = await at("/repo/Packages.gz");
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0x1f, 0x8b, 8]);
  assert.equal(r.headers.get("content-type"), "application/gzip");
  assert.equal(r.headers.get("content-encoding"), null);
  assert.equal((await at("/repo/Release", { method: "HEAD" })).headers.get("content-length"), "15");
  assert.equal((await at("/repo/x_1_iphoneos-arm64.deb")).status, 404); // GitHub's 404 passed on
  const n = seen.length;
  assert.equal((await at("/repo/InRelease")).status, 404);              // not asked of GitHub at all
  assert.equal((await at("/repo/Release", { method: "POST" })).status, 404);
  assert.equal(seen.length, n);
  assert.equal((await at("/repo")).status, 301);
  assert.equal((await at("/repo/")).status, 200);
  const other = new Request("https://ifizbox.example/repo/Release");
  await repo(other, new URL(other.url), { IFIZBOX_REPO: "me/fork" }, { fetcher, wait: async () => {} });
  assert.equal(seen.pop(), "https://github.com/me/fork/releases/latest/download/Release");
  // upstream answers 503 three times: a 502 here, not GitHub's page
  const down = new Request("https://ifizbox.example/repo/Release");
  r = await repo(down, new URL(down.url), {}, { fetcher: async () => new Response("x", { status: 503 }), wait: async () => {} });
  assert.equal(r.status, 502);
  // the Worker routes /repo/ before the website's assets
  const site = await w.fetch(new Request("https://ifizbox.example/repo/InRelease"), { ...env, ASSETS: { fetch: async () => new Response("asset") } });
  assert.equal(site.status, 404);
  // B73: /repo/<tag>/<file>.deb, an older release's .deb named by Packages, comes from that release, same rules
  assert.deepEqual(repoFile("/repo/v0.9.3/com.ryha.ifizbox_0.9.3-9_iphoneos-arm64.deb"),
    { name: "com.ryha.ifizbox_0.9.3-9_iphoneos-arm64.deb", tag: "v0.9.3", type: "application/vnd.debian.binary-package" });
  for (const bad of ["/repo/v0.9.3/Packages", "/repo/v0.9.3/Release", "/repo/latest/x.deb", "/repo/v0.9/x.deb", "/repo/v0.9.3/..%2Fx.deb",
    "/repo/v0.9.3/a/x.deb", "/repo/..%2Fv0.9.3/x.deb", "/repo/v0.9.3/%E0.deb", "/repo/v0.9.3/.deb"]) assert.equal(repoFile(bad), null, bad);
  const tagged = [];
  const tfetch = async (url, o = {}) => {
    tagged.push(url);
    assert.equal(o.redirect, "follow"); // GitHub's redirect is followed here, never passed on (Zebra)
    return url.endsWith("/x_1.0-1_iphoneos-arm64.deb") ? new Response("deb", { headers: { "content-length": "3" } }) : new Response("no", { status: 404 });
  };
  const old = new Request("https://ifizbox.example/repo/v0.9.3/x_1.0-1_iphoneos-arm64.deb");
  r = await repo(old, new URL(old.url), {}, { fetcher: tfetch, wait: async () => {} });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "deb");
  assert.equal(r.headers.get("location"), null);
  assert.equal(r.headers.get("content-type"), "application/vnd.debian.binary-package");
  assert.equal(r.headers.get("cache-control"), "public, max-age=86400");
  assert.equal(tagged[0], "https://github.com/RyanAHayden/iFizBox/releases/download/v0.9.3/x_1.0-1_iphoneos-arm64.deb");
  const gone = new Request("https://ifizbox.example/repo/v0.9.3/y_1_iphoneos-arm64.deb");
  assert.equal((await repo(gone, new URL(gone.url), {}, { fetcher: tfetch, wait: async () => {} })).status, 404);
  const n2 = tagged.length;
  const badTag = new Request("https://ifizbox.example/repo/v0.9.3/Packages");
  assert.equal((await repo(badTag, new URL(badTag.url), {}, { fetcher: tfetch, wait: async () => {} })).status, 404);
  assert.equal(tagged.length, n2); // not asked of GitHub
  console.log("worker repo: ok");
}
{
  // B58: /repo/CydiaIcon.png is the app icon from the deployed assets (web/app/icons/icon-180.png), never GitHub,
  // with a long cache header; @2x/@3x get the same PNG; without ASSETS (or a missing asset) a 404.
  const { readFile } = await import("node:fs/promises");
  const png = new Uint8Array(await readFile(new URL("../web/app/icons/icon-180.png", import.meta.url)));
  const asked = [];
  const assets = { fetch: async (req) => { asked.push(new URL(req.url).pathname); return new URL(req.url).pathname === "/icons/icon-180.png" ? new Response(png, { headers: { "content-type": "image/png", etag: '"i1"' } }) : new Response("no", { status: 404 }); } };
  const gh = async () => { throw new Error("GitHub asked for the icon"); };
  const get = (path, e = { ...env, ASSETS: assets }, init) => w.fetch(new Request("https://ifizbox.example" + path, init), e);
  for (const path of ["/repo/CydiaIcon.png", "/repo/CydiaIcon@2x.png", "/repo/CydiaIcon@3x.png"]) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.match(r.headers.get("cache-control"), /max-age=604800/);
    assert.equal(r.headers.get("etag"), '"i1"');
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), png, path);
  }
  assert.deepEqual([...new Set(asked)], ["/icons/icon-180.png"]);
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]); // a real PNG ships at that path
  const head = await get("/repo/CydiaIcon.png", undefined, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await get("/repo/CydiaIcon.png", undefined, { method: "POST" })).status, 404);
  assert.equal((await get("/repo/CydiaIcon@4x.png")).status, 404);
  assert.equal((await get("/repo/CydiaIcon.png", { ...env })).status, 404); // no ASSETS
  assert.equal((await get("/repo/CydiaIcon.png", { ...env, ASSETS: { fetch: async () => new Response("no", { status: 404 }) } })).status, 404);
  const { repo } = await import("./src/index.js");
  const req = new Request("https://ifizbox.example/repo/CydiaIcon.png");
  assert.equal((await repo(req, new URL(req.url), { ASSETS: assets }, { fetcher: gh })).status, 200);
  console.log("worker repo icon: ok");
}

// F161: /api/applookup asks Apple once per bundle ID and country a day (the cache), answers its first result only.
import { appLookup } from "./src/index.js";
{
  const FIXTURE = { resultCount: 2, results: [
    { bundleId: "com.example.flight", trackName: "FlightTracker", artistName: "Example Ltd", primaryGenreName: "Travel",
      trackViewUrl: "https://apps.apple.com/gb/app/flighttracker/id123?uo=4", averageUserRating: 4.6, userRatingCount: 812,
      screenshotUrls: ["https://is1-ssl.mzstatic.com/a.jpg", "https://is1-ssl.mzstatic.com/b.jpg"], description: "Track flights.",
      version: "3.2", minimumOsVersion: "15.0" },
    { bundleId: "com.example.other", trackName: "Other" }] };
  const asked = [];
  const fetcher = async (url, o) => { asked.push({ url, ttl: o.cf.cacheTtl }); return new Response(JSON.stringify(FIXTURE), { headers: { "Content-Type": "text/javascript" } }); };
  const kept = new Map();
  const cache = { match: async (k) => kept.get(k.url)?.clone(), put: async (k, r) => { kept.set(k.url, r); } };
  const at = (q, f = fetcher) => appLookup(new URL("https://ifizbox.example/api/applookup?" + q), {}, { fetcher: f, cache });
  let r = await at("bundleId=com.example.flight&country=GB");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Cache-Control"), /max-age=86400/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  const j = await r.json();
  assert.equal(j.resultCount, 1);
  assert.equal(j.results[0].trackName, "FlightTracker");
  assert.deepEqual(asked, [{ url: "https://itunes.apple.com/lookup?bundleId=com.example.flight&country=gb", ttl: 86400 }]);
  r = await at("bundleId=com.example.flight&country=gb"); // cached: Apple isn't asked again
  assert.equal((await r.json()).results[0].trackName, "FlightTracker");
  assert.equal(asked.length, 1);
  assert.equal((await at("bundleId=a/b")).status, 400);
  assert.equal((await at("bundleId=com.a&country=usa")).status, 400);
  assert.equal(asked.length, 1); // bad input never reaches Apple
  r = await at("bundleId=com.none", async () => new Response(JSON.stringify({ resultCount: 0, results: [] })));
  assert.deepEqual(await r.json(), { resultCount: 0, results: [] });
  assert.equal((await at("bundleId=com.down", async () => new Response("x", { status: 503 }))).status, 502);
  assert.equal((await at("bundleId=com.bad", async () => new Response("<html>"))).status, 502);
  assert.equal((await at("bundleId=com.gone", async () => { throw new Error("offline"); })).status, 502);
  assert.equal((await at("bundleId=com.down")).status, 200); // a failure isn't cached
  // through the router, with node.mjs's kind of cache in env
  const routed = await w.fetch(new Request("https://ifizbox.example/api/applookup?bundleId=a/b"), { LOOKUP_CACHE: cache });
  assert.equal(routed.status, 400);
  console.log("worker applookup: ok");
}

// B37: /api/appreviews asks Apple's customer-reviews RSS once per id and country a day, Apple's JSON as it came.
import { appReviews } from "./src/index.js";
{
  const FEED = { feed: { entry: [{ "im:rating": { label: "5" }, title: { label: "Great" }, content: { label: "Works." } }] } };
  const asked = [];
  const fetcher = async (url) => { asked.push(url); return new Response(JSON.stringify(FEED)); };
  const kept = new Map();
  const cache = { match: async (k) => kept.get(k.url)?.clone(), put: async (k, r) => { kept.set(k.url, r); } };
  const at = (q, f = fetcher) => appReviews(new URL("https://ifizbox.example/api/appreviews?" + q), {}, { fetcher: f, cache });
  let r = await at("id=1048524688&country=GB");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Cache-Control"), /max-age=86400/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await r.json(), FEED);
  assert.deepEqual(asked, ["https://itunes.apple.com/gb/rss/customerreviews/id=1048524688/sortby=mostrecent/json"]);
  r = await at("id=1048524688&country=gb");
  assert.deepEqual(await r.json(), FEED);
  assert.equal(asked.length, 1); // cached
  assert.equal((await at("id=12a")).status, 400);
  assert.equal((await at("id=../x")).status, 400);
  assert.equal((await at("id=1&country=usa")).status, 400);
  assert.equal(asked.length, 1); // bad input never reaches Apple
  assert.equal((await at("id=2", async () => new Response("x", { status: 503 }))).status, 502);
  assert.equal((await at("id=3", async () => new Response("<html>"))).status, 502);
  assert.equal((await at("id=4", async () => { throw new Error("offline"); })).status, 502);
  assert.equal((await at("id=2")).status, 200); // a failure isn't cached
  const routed = await w.fetch(new Request("https://ifizbox.example/api/appreviews?id=x"), { LOOKUP_CACHE: cache });
  assert.equal(routed.status, 400);
  console.log("worker appreviews: ok");
}

// F160: /api/ipainfo reads Payload/*.app/Info.plist out of an IPA with Range requests only: a plain zip (deflated XML
// plist), a zip64 one (binary plist, sizes and offset in the zip64 extra field), a server without Range, a zip with
// no Info.plist; answers cached (30 days; lasting errors a day, network ones not at all).
import { ipaInfo } from "./src/index.js";
import { plistInfo } from "./src/ipainfo.js";
{
  const enc = new TextEncoder();
  const deflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const le = (n, w) => { const b = new Uint8Array(w); let v = n; for (let i = 0; i < w; i++) { b[i] = v % 256; v = Math.floor(v / 256); } return b; };
  const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const PK = (a, b) => new Uint8Array([0x50, 0x4b, a, b]);
  // files: [{ name, data, deflate }]; zip64: every central entry's offset and sizes in the zip64 extra field, and the
  // end record's fields all ones, pointing at zip64's end record through its locator.
  async function zip(files, { zip64 = false } = {}) {
    const locals = [], central = [];
    let off = 0;
    for (const f of files) {
      const data = f.deflate ? await deflate(f.data) : f.data;
      const name = enc.encode(f.name), method = f.deflate ? 8 : 0;
      const local = cat(PK(3, 4), le(20, 2), le(0, 2), le(method, 2), le(0, 4), le(0, 4), le(data.length, 4), le(f.data.length, 4),
        le(name.length, 2), le(0, 2), name, data);
      const extra = zip64 ? cat(le(1, 2), le(24, 2), le(f.data.length, 8), le(data.length, 8), le(off, 8)) : new Uint8Array(0);
      const big = (n) => le(zip64 ? 0xffffffff : n, 4);
      central.push(cat(PK(1, 2), le(45, 2), le(20, 2), le(0, 2), le(method, 2), le(0, 4), le(0, 4), big(data.length), big(f.data.length),
        le(name.length, 2), le(extra.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), big(off), name, extra));
      locals.push(local);
      off += local.length;
    }
    const cd = cat(...central);
    const n = files.length;
    if (!zip64) return cat(...locals, cd, PK(5, 6), le(0, 4), le(n, 2), le(n, 2), le(cd.length, 4), le(off, 4), le(0, 2));
    const rec = cat(PK(6, 6), le(44, 8), le(45, 2), le(45, 2), le(0, 4), le(0, 4), le(n, 8), le(n, 8), le(cd.length, 8), le(off, 8));
    const loc = cat(PK(6, 7), le(0, 4), le(off + cd.length, 8), le(1, 4));
    return cat(...locals, cd, rec, loc, PK(5, 6), le(0, 4), le(0xffff, 2), le(0xffff, 2), le(0xffffffff, 4), le(0xffffffff, 4), le(0, 2));
  }
  const XML = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.flight</string>
<key>CFBundleShortVersionString</key><string>3.2</string><key>MinimumOSVersion</key><string>14.0</string>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array><key>CFBundleName</key><string>A &amp; B</string></dict></plist>`;
  const BPLIST = Uint8Array.from(atob("YnBsaXN0MDDWAQIDBAUGBwgJCgsNXxASQ0ZCdW5kbGVJZGVudGlmaWVyXENGQnVuZGxlTmFtZV8QGkNGQnVuZGxlU2hvcnRWZXJzaW9uU3RyaW5nXxAQTWluaW11bU9TVmVyc2lvblZOZXN0ZWReVUlEZXZpY2VGYW1pbHlfEA9jb20uZXhhbXBsZS5wYWRkAFAA5ABkAHlTMi4xVDE2LjDRBAxTMS4woQ4QAggVKjdUZ259j5icoaSoqgAAAAAAAAEBAAAAAAAAAA8AAAAAAAAAAAAAAAAAAACs"), (c) => c.charCodeAt(0));
  assert.deepEqual(plistInfo(enc.encode(XML)), { minOSVersion: "14.0", deviceFamily: [1, 2], bundleId: "com.example.flight", version: "3.2" });
  assert.deepEqual(plistInfo(BPLIST), { minOSVersion: "16.0", deviceFamily: [2], bundleId: "com.example.pad", version: "2.1" }); // python plistlib's
  const filler = { name: "Payload/Flight.app/Assets.car", data: new Uint8Array(100000).map((_, i) => (i * 7919) % 251) }; // pushes Info.plist out of the tail
  const plain = await zip([{ name: "Payload/", data: new Uint8Array(0) }, { name: "Payload/Flight.app/Info.plist", data: enc.encode(XML), deflate: true }, filler,
    { name: "Payload/Flight.app/Frameworks/X.framework/Info.plist", data: enc.encode("not this one") }]);
  const big = await zip([{ name: "Payload/Pad.app/_CodeSignature/CodeResources", data: new Uint8Array(70000) }, { name: "Payload/Pad.app/Info.plist", data: BPLIST }, filler], { zip64: true });
  const files = { "/plain.ipa": plain, "/big.ipa": big, "/empty.ipa": await zip([filler]), "/text.ipa": enc.encode("<html>not a zip</html>") };
  const asked = [];
  // A server that answers Range like GitHub's release assets: 206 with Content-Range, suffix ranges too.
  const fetcher = async (url, o = {}) => {
    const { pathname } = new URL(url);
    if (pathname === "/moved.ipa") return fetcher("https://dl.example/plain.ipa", o); // redirect: "follow" as fetch does it
    const body = files[pathname];
    asked.push({ path: pathname, range: o.headers?.Range });
    if (!body) return new Response("no", { status: pathname === "/down.ipa" ? 503 : 404 });
    if (pathname === "/full.ipa" || !o.headers?.Range) return new Response(body);
    const m = /^bytes=(\d*)-(\d*)$/.exec(o.headers.Range);
    if (m[1] === "") return new Response("no suffix ranges", { status: 501 }); // GitHub's asset store
    const start = m[1] === "" ? Math.max(0, body.length - Number(m[2])) : Number(m[1]);
    const end = m[1] === "" || m[2] === "" ? body.length - 1 : Math.min(body.length - 1, Number(m[2]));
    return new Response(body.slice(start, end + 1), { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${body.length}` } });
  };
  files["/full.ipa"] = plain;
  const kept = new Map();
  const cache = { match: async (k) => kept.get(k.url)?.clone(), put: async (k, r) => { kept.set(k.url, r); } };
  const at = (url, f = fetcher) => ipaInfo(new URL("https://ifizbox.example/api/ipainfo?" + new URLSearchParams({ url })), {}, { fetcher: f, cache });
  let r = await at("https://dl.example/plain.ipa");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Cache-Control"), /max-age=2592000/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await r.json(), { minOSVersion: "14.0", deviceFamily: [1, 2], bundleId: "com.example.flight", version: "3.2" });
  assert.ok(asked.every((a) => a.range), "every read is a Range request");
  assert.ok(asked.length <= 4, `${asked.length} reads`);
  const read = asked.length;
  assert.equal((await (await at("https://dl.example/plain.ipa")).json()).version, "3.2");
  assert.equal(asked.length, read, "the second ask comes from the cache");
  r = await at("https://dl.example/big.ipa");
  assert.deepEqual(await r.json(), { minOSVersion: "16.0", deviceFamily: [2], bundleId: "com.example.pad", version: "2.1" });
  assert.equal((await (await at("https://dl.example/moved.ipa")).json()).minOSVersion, "14.0");
  const code = async (url, f) => { const x = await at(url, f); return [x.status, (await x.json()).code]; };
  assert.deepEqual(await code("https://dl.example/full.ipa"), [422, "no_range"]);
  assert.deepEqual(await code("https://dl.example/empty.ipa"), [422, "no_plist"]);
  assert.deepEqual(await code("https://dl.example/text.ipa"), [422, "not_zip"]);
  assert.deepEqual(await code("https://dl.example/gone.ipa"), [422, "not_found"]);
  assert.deepEqual(await code("https://dl.example/down.ipa"), [502, "upstream"]);
  assert.deepEqual(await code("https://dl.example/off.ipa", async () => { throw new Error("offline"); }), [502, "upstream"]);
  assert.ok(kept.has(`https://ipainfo.ifizbox.internal/?${new URLSearchParams({ url: "https://dl.example/full.ipa" })}`), "a lasting error is cached");
  assert.ok(!kept.has(`https://ipainfo.ifizbox.internal/?${new URLSearchParams({ url: "https://dl.example/down.ipa" })}`), "a network error isn't");
  assert.equal((await at("ftp://dl.example/a.ipa")).status, 400);
  assert.equal((await at("https://user:pw@dl.example/a.ipa")).status, 400);
  const routed = await w.fetch(new Request("https://ifizbox.example/api/ipainfo?url=nope"), { LOOKUP_CACHE: cache });
  assert.equal(routed.status, 400);
  console.log("worker ipainfo: ok");
}

// F182: user reviews in D1 (src/reviews.js), against Node's SQLite with D1's API (src/d1-sqlite.js).
import { reviews as reviewsRoute, parseReview, clean, LIMITS } from "./src/reviews.js";
import { d1 } from "./src/d1-sqlite.js";
{
  const db = d1();
  const renv = { REVIEWS: db, REVIEWS_ADMIN: "owner-secret-123" };
  const tok = (c) => c.repeat(40);
  let ipN = 0;
  const call = (path, { method = "GET", body, token, ip = `203.0.113.${++ipN % 250}`, auth, env: e = renv, now } = {}) => {
    const headers = { "CF-Connecting-IP": ip };
    if (token) headers["X-Review-Token"] = token;
    if (auth) headers.Authorization = auth;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return reviewsRoute(new Request("https://ifizbox.example" + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), e, now ? { now } : {});
  };
  // caps and cleaning
  assert.equal(parseReview({ stars: 0 }).ok, false);
  assert.equal(parseReview({ stars: 6 }).ok, false);
  assert.equal(parseReview({ stars: 2.5 }).ok, false);
  assert.deepEqual(parseReview({ stars: "4" }).review, { stars: 4, title: "", name: "", text: "", version: "" });
  assert.equal(parseReview({ stars: 5, title: "x".repeat(LIMITS.title + 1) }).ok, false);
  assert.equal(parseReview({ stars: 5, title: "é".repeat(LIMITS.title) }).ok, true, "caps count characters, not bytes");
  assert.equal(parseReview({ stars: 5, name: "x".repeat(31) }).ok, false);
  assert.equal(parseReview({ stars: 5, text: "x".repeat(2001) }).ok, false);
  assert.equal(parseReview({ stars: 5, text: { html: 1 } }).ok, false);
  assert.equal(clean("a\u0000b\nc", 10), "a b c");
  assert.equal(clean(" a\r\n\n\n\nb‮ ", 10, true), "a\n\nb");

  // empty package: enabled, nothing yet
  let r = await call("/reviews/com.example.velvet");
  let j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual([j.enabled, j.count, j.average, j.reviews.length, j.mine], [true, 0, null, 0, null]);
  assert.equal((await call("/reviews/..%2Fetc")).status, 404);
  assert.equal((await call("/reviews/a%20b")).status, 404);

  // post, then the same device again replaces it
  r = await call("/reviews/com.example.velvet", { method: "POST", token: tok("a"), body: { stars: 5, title: "Great", name: "Ann", text: "<b>Loves</b> it", version: "2.1.3" }, now: 1000 });
  j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  const first = j.review;
  assert.match(first.id, /^[0-9a-f]{16}$/);
  assert.equal(first.text, "<b>Loves</b> it", "kept as plain text; the clients draw it as text");
  r = await call("/reviews/com.example.velvet", { method: "POST", token: tok("a"), body: { stars: 3, title: "Okay", name: "Ann", text: "Changed my mind", version: "2.1.4" }, now: 2000 });
  j = await r.json();
  assert.equal(j.review.id, first.id, "the same review, replaced");
  assert.deepEqual([j.review.stars, j.review.title, j.review.date, j.review.updated], [3, "Okay", 1000, 2000]);
  await call("/reviews/com.example.velvet", { method: "POST", token: tok("b"), body: { stars: 4, title: "Nice", name: "Bo", text: "Good", version: "2.1.4" }, now: 3000 });
  await call("/reviews/com.example.velvet", { method: "POST", token: tok("c"), body: { stars: 5 }, now: 4000 }); // Tap to Rate
  await call("/reviews/com.example.other", { method: "POST", token: tok("c"), body: { stars: 1, title: "Elsewhere" }, now: 4000 });
  r = await call("/reviews/com.example.velvet", { token: tok("a") });
  j = await r.json();
  assert.equal(j.count, 3, "stars alone count as a rating");
  assert.deepEqual(j.histogram, [1, 1, 1, 0, 0]);
  assert.equal(j.average, 4);
  assert.deepEqual(j.reviews.map((x) => x.title), ["Nice", "Okay"], "only reviews with words, newest first");
  assert.equal(j.mine.id, first.id);
  assert.equal(j.mine.hidden, false);
  // paging
  r = await call("/reviews/com.example.velvet?per=1&page=0");
  j = await r.json();
  assert.deepEqual([j.reviews.length, j.reviews[0].title, j.more], [1, "Nice", true]);
  j = await (await call("/reviews/com.example.velvet?per=1&page=1")).json();
  assert.deepEqual([j.reviews[0].title, j.more], ["Okay", false]);

  // bad requests
  assert.equal((await call("/reviews/com.example.velvet", { method: "POST", body: { stars: 5 } })).status, 400, "no token");
  assert.equal((await call("/reviews/com.example.velvet", { method: "POST", token: "short", body: { stars: 5 } })).status, 400);
  assert.equal((await call("/reviews/com.example.velvet", { method: "POST", token: tok("d"), body: { stars: 9 } })).status, 400);
  assert.equal((await call("/reviews/com.example.velvet", { method: "POST", token: tok("d"), body: { stars: 5, text: "x".repeat(2001) } })).status, 400);
  assert.equal((await call("/reviews/com.example.velvet", { method: "POST", token: tok("d"), body: "not json" })).status, 400);
  assert.equal((await call("/reviews/com.example.velvet", { method: "POST", token: tok("d"), body: "x".repeat(20000) })).status, 413);

  // report: one count per reporter, hidden at REPORT_HIDE (3), never by the author
  const bo = (await (await call("/reviews/com.example.velvet")).json()).reviews[0];
  assert.equal((await call(`/reviews/com.example.velvet/${bo.id}/report`, { method: "POST", token: tok("b") })).status, 400, "not your own");
  j = await (await call(`/reviews/com.example.velvet/${bo.id}/report`, { method: "POST", token: tok("e") })).json();
  assert.equal(j.hidden, false);
  j = await (await call(`/reviews/com.example.velvet/${bo.id}/report`, { method: "POST", token: tok("e") })).json();
  assert.equal(j.hidden, false, "the same reporter counts once");
  await call(`/reviews/com.example.velvet/${bo.id}/report`, { method: "POST", token: tok("f") });
  j = await (await call(`/reviews/com.example.velvet/${bo.id}/report`, { method: "POST", ip: "198.51.100.9" })).json(); // no token: by address
  assert.equal(j.hidden, true);
  j = await (await call("/reviews/com.example.velvet", { token: tok("b") })).json();
  assert.deepEqual(j.reviews.map((x) => x.title), ["Okay"], "a hidden review is gone from the list");
  assert.equal(j.count, 2, "and from the counts");
  assert.equal(j.mine.hidden, true, "its author still sees it, marked hidden");
  // F450: every rated package at once, hidden reviews left out
  r = await call("/reviews");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("Cache-Control"), /max-age=300/);
  j = await r.json();
  assert.deepEqual(j, { enabled: true, ratings: { "com.example.velvet": [4, 2], "com.example.other": [1, 1] } });
  assert.deepEqual(await (await call("/reviews", { env: {} })).json(), { enabled: false, ratings: {} });
  assert.equal((await call(`/reviews/com.example.velvet/${"0".repeat(16)}/report`, { method: "POST", token: tok("e") })).status, 404);

  // owner delete
  assert.equal((await call(`/reviews/com.example.velvet/${first.id}`, { method: "DELETE" })).status, 403);
  assert.equal((await call(`/reviews/com.example.velvet/${first.id}`, { method: "DELETE", auth: "Bearer wrong" })).status, 403);
  assert.equal((await call(`/reviews/com.example.velvet/${first.id}`, { method: "DELETE", auth: "Bearer owner-secret-123", env: { REVIEWS: db } })).status, 403, "no secret set: nobody");
  assert.equal((await call(`/reviews/com.example.velvet/${first.id}`, { method: "DELETE", auth: "Bearer owner-secret-123" })).status, 200);
  assert.equal((await call(`/reviews/com.example.velvet/${first.id}`, { method: "DELETE", auth: "Bearer owner-secret-123" })).status, 404);
  j = await (await call("/reviews/com.example.velvet")).json();
  assert.equal(j.count, 1);

  // F207: the writer's token deletes its own review (by id, or by package alone); another token gets 403
  const mine = (await (await call("/reviews/com.example.mine", { method: "POST", token: tok("m"), body: { stars: 5, title: "Mine" } })).json()).review;
  await call("/reviews/com.example.mine", { method: "POST", token: tok("n"), body: { stars: 1, title: "Theirs" } });
  await call("/reviews/com.example.mine", { method: "POST", token: tok("o"), body: { stars: 3 } });
  assert.equal((await call(`/reviews/com.example.mine/${mine.id}`, { method: "DELETE", token: tok("n") })).status, 403, "not yours");
  assert.equal((await call(`/reviews/com.example.mine/${mine.id}`, { method: "DELETE" })).status, 403, "no token, no secret");
  assert.equal((await call(`/reviews/com.example.other/${mine.id}`, { method: "DELETE", token: tok("m") })).status, 404, "wrong package");
  r = await call(`/reviews/com.example.mine/${mine.id}`, { method: "DELETE", token: tok("m") });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: mine.id });
  j = await (await call("/reviews/com.example.mine", { token: tok("m") })).json();
  assert.deepEqual([j.count, j.histogram, j.average, j.mine, j.reviews.map((x) => x.title)], [2, [0, 0, 1, 0, 1], 2, null, ["Theirs"]]);
  assert.equal((await call(`/reviews/com.example.mine/${mine.id}`, { method: "DELETE", token: tok("m") })).status, 404, "already gone");
  assert.equal((await call("/reviews/com.example.mine", { method: "DELETE", token: tok("t") })).status, 404, "none of mine here");
  r = await call("/reviews/com.example.mine", { method: "DELETE", token: tok("o") });
  assert.equal(r.status, 200, "by package alone");
  j = await (await call("/reviews/com.example.mine")).json();
  assert.deepEqual([j.count, j.histogram], [1, [0, 0, 0, 0, 1]]);
  r = await call("/reviews/com.example.mine", { method: "POST", token: tok("p"), body: { stars: 4 } });
  const pid = (await r.json()).review.id;
  assert.equal((await call(`/reviews/com.example.mine/${pid}`, { method: "DELETE", auth: "Bearer owner-secret-123" })).status, 200, "admin still deletes");
  assert.equal((await call("/reviews/com.example.mine", { method: "DELETE", auth: "Bearer owner-secret-123" })).status, 403, "admin needs an id");
  // token deletes count against the token's minute
  const dels = [];
  for (let i = 0; i < 6; i++) dels.push((await call("/reviews/com.example.mine", { method: "DELETE", token: tok("s") })).status);
  assert.deepEqual(dels, [404, 404, 404, 404, 429, 429]);

  // rate limits: per address a minute, per token a minute, per address a day
  let codes = [];
  for (let i = 0; i < 8; i++) codes.push((await call("/reviews/com.example.rl", { method: "POST", token: tok(String.fromCharCode(103 + i)), ip: "192.0.2.1", body: { stars: 4 } })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429, 429]);
  codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call("/reviews/com.example.rl2", { method: "POST", token: tok("z"), body: { stars: 4 } })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 429, 429]);
  const daily = { REVIEWS: d1(), REVIEW_DAILY: "2" };
  codes = [];
  for (let i = 0; i < 3; i++) codes.push((await call("/reviews/com.example.day", { method: "POST", token: tok(String.fromCharCode(65 + i)), ip: "192.0.2.77", body: { stars: 2 }, env: daily, now: 5000 + i })).status);
  assert.deepEqual(codes, [200, 200, 429]);
  assert.equal((await call("/reviews/com.example.day", { method: "POST", token: tok("D"), ip: "192.0.2.77", body: { stars: 2 }, env: daily, now: 5000 + 86400001 })).status, 200, "a day later");
  // the Rate Limiting binding when there is one
  const said = [];
  const bound = { REVIEWS: d1(), REVIEW_RATE_LIMIT: { limit: async ({ key }) => { said.push(key); return { success: said.length < 2 }; } } };
  assert.equal((await call("/reviews/com.example.b", { method: "POST", token: tok("q"), body: { stars: 1 }, env: bound })).status, 200);
  assert.equal((await call("/reviews/com.example.b", { method: "POST", token: tok("r"), body: { stars: 1 }, env: bound })).status, 429);
  assert.match(said[0], /^ip:[0-9a-f]{64}$/, "addresses are hashed");

  // no database: reading says off, writing 503; and the route through the Worker
  j = await (await call("/reviews/com.example.velvet", { env: {} })).json();
  assert.equal(j.enabled, false);
  assert.equal((await call("/reviews/com.example.velvet", { method: "POST", token: tok("a"), body: { stars: 5 }, env: {} })).status, 503);
  r = await w.fetch(new Request("https://ifizbox.example/reviews/com.example.velvet"), renv);
  assert.equal((await r.json()).count, 1);
  r = await w.fetch(new Request("https://ifizbox.example/reviews/com.example.velvet", { method: "OPTIONS" }), renv);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /X-Review-Token/);
  console.log("worker reviews: ok");
}

// F190: iOS's own requests on an upload's link show in /sign/up/<token>/status, each mark written once.
{
  const writes = [];
  const counted = { ...env, WAIT_SCALE: "0.05", HOSTED: { ...env.HOSTED, put: async (k, v, o) => { writes.push(k); return env.HOSTED.put(k, v, o); } } };
  const at = (path, init) => w.fetch(new Request("https://sign.example" + path, init), counted);
  const status = async (t) => (await at(`/sign/up/${t}/status`)).json();
  const tok = "f1".repeat(24), app = new Uint8Array([0x50, 0x4b, 1, 2, 3, 4]);
  assert.deepEqual(await status(tok), { manifest: false, asked: false, started: false, finished: false });
  // the early link: iOS asks for the manifest (from its query) before anything is reserved
  let r = await at(`/sign/up/${tok}/manifest.plist?bundleid=com.you.ifizbox&version=1&title=iFizBox`);
  assert.equal(r.status, 200);
  assert.deepEqual(await status(tok), { manifest: true, asked: false, started: false, finished: false });
  await at(`/sign/up/${tok}/manifest.plist?bundleid=com.you.ifizbox&version=1&title=iFizBox`); // asked again: no write
  await at(`/sign/upload?bundleid=com.you.ifizbox&version=1&title=iFizBox&token=${tok}`, { method: "POST" });
  await at(`/sign/upload?bundleid=com.you.ifizbox&version=1&title=iFizBox&token=${tok}&size=${app.length}`, { method: "POST" });
  // the reservation and size writes leave iOS's mark alone; HEAD is no download, but iOS asked (B90)
  assert.deepEqual(await status(tok), { manifest: true, asked: false, started: false, finished: false });
  assert.equal((await at(`/sign/up/${tok}/app.ipa`, { method: "HEAD" })).status, 200);
  assert.deepEqual(await status(tok), { manifest: true, asked: true, started: false, finished: false });
  // GET held until done, then streamed whole: started, finished
  const held = at(`/sign/up/${tok}/app.ipa`);
  await at(`/sign/upload/${tok}/0`, { method: "PUT", body: app });
  await at(`/sign/upload/${tok}/done`, { method: "POST" });
  r = await held;
  const whole = r.arrayBuffer();
  assert.deepEqual(new Uint8Array(await whole), app);
  assert.deepEqual(await status(tok), { manifest: true, asked: true, started: true, finished: true });
  // a Range short of the end, and the download again: nothing more written
  const before = writes.filter((k) => k.endsWith(".ios")).length;
  assert.equal(before, 4);
  await (await at(`/sign/up/${tok}/app.ipa`, { headers: { Range: "bytes=0-1" } })).arrayBuffer();
  await (await at(`/sign/up/${tok}/app.ipa`)).arrayBuffer();
  await at(`/sign/up/${tok}/manifest.plist`);
  assert.equal(writes.filter((k) => k.endsWith(".ios")).length, 4);
  // a Range short of the end on a fresh link starts but doesn't finish
  const t2 = "f2".repeat(24);
  await at(`/sign/upload?bundleid=com.a&version=1&title=A&token=${t2}`, { method: "POST" });
  await at(`/sign/upload?bundleid=com.a&version=1&title=A&token=${t2}&size=${app.length}`, { method: "POST" });
  await at(`/sign/upload/${t2}/0`, { method: "PUT", body: app });
  await at(`/sign/upload/${t2}/done`, { method: "POST" });
  await (await at(`/sign/up/${t2}/manifest.plist`)).text();
  await (await at(`/sign/up/${t2}/app.ipa`, { headers: { Range: "bytes=0-2" } })).arrayBuffer();
  assert.deepEqual(await status(t2), { manifest: true, asked: true, started: true, finished: false });
  await (await at(`/sign/up/${t2}/app.ipa`, { headers: { Range: "bytes=3-" } })).arrayBuffer();
  assert.deepEqual(await status(t2), { manifest: true, asked: true, started: true, finished: true });
  assert.equal((await at(`/sign/up/xyz/status`)).status, 404);
  // B90: "asked" lands while app.ipa is still held for the website's upload, before any byte goes out
  const t3 = "f3".repeat(24);
  await at(`/sign/upload?bundleid=com.a&version=1&title=A&token=${t3}`, { method: "POST" });
  const held3 = at(`/sign/up/${t3}/app.ipa`);
  let seen3 = false;
  for (let i = 0; i < 100 && !seen3; i++) { seen3 = (await status(t3)).asked; if (!seen3) await new Promise((res) => setTimeout(res, 10)); }
  assert.ok(seen3, "asked while held");
  assert.equal((await status(t3)).started, false);
  await at(`/sign/upload/${t3}/fail`, { method: "POST" });
  assert.equal((await held3).status, 404);
  console.log("worker ios status: ok");
}

// B83: iFizBox's own update (/sign/host): iOS's requests show in /sign/host/<t>/status (each mark written once), and
// manifest.plist and app.ipa look again while KV hasn't caught up with the put.
{
  const writes = [];
  const lag = new Set(); // keys KV doesn't show yet (eventual consistency)
  const kv = { ...env.HOSTED,
    put: async (k, v, o) => { writes.push(k); return env.HOSTED.put(k, v, o); },
    get: async (k, o) => (lag.has(k) ? null : env.HOSTED.get(k, o)),
    getWithMetadata: async (k, o) => (lag.has(k) ? { value: null, metadata: null } : env.HOSTED.getWithMetadata(k, o)) };
  const henv = { ...env, WAIT_SCALE: "0.02", HOSTED: kv };
  const at = (path, init) => w.fetch(new Request("https://sign.example" + path, init), henv);
  const big = new Uint8Array(2.5 * 1024 * 1024 + 7);
  big[0] = 0x50; big[1] = 0x4b; big[big.length - 1] = 9;
  let r = await at("/sign/host?bundleid=com.ryha.ifizbox&version=0.9.9&title=iFizBox", { method: "POST", body: big, headers: { "Content-Length": String(big.length) } });
  const tok = /\/sign\/host\/([0-9a-f]{48})\//.exec((await r.json()).manifest)[1];
  const status = async () => (await at(`/sign/host/${tok}/status`)).json();
  assert.deepEqual(await status(), { manifest: false, asked: false, started: false, finished: false });
  // KV shows the IPA only after a moment: the manifest waits for it instead of a 404
  lag.add(tok);
  setTimeout(() => lag.delete(tok), 40);
  r = await at(`/sign/host/${tok}/manifest.plist`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<string>0\.9\.9<\/string>/);
  assert.deepEqual(await status(), { manifest: true, asked: false, started: false, finished: false });
  // HEAD and a Range short of the end start nothing / finish nothing
  assert.equal((await at(`/sign/host/${tok}/app.ipa`, { method: "HEAD" })).headers.get("Content-Length"), String(big.length));
  assert.deepEqual(await status(), { manifest: true, asked: true, started: false, finished: false });
  r = await at(`/sign/host/${tok}/app.ipa`, { headers: { Range: "bytes=0-9" } });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 10);
  assert.deepEqual(await status(), { manifest: true, asked: true, started: true, finished: false });
  // app.ipa, lagging too, waits, then streams whole: finished only once its last byte is handed over
  lag.add(tok);
  setTimeout(() => lag.delete(tok), 40);
  r = await at(`/sign/host/${tok}/app.ipa`);
  assert.equal(r.status, 200);
  const reader = r.body.getReader();
  const first = await reader.read();
  assert.ok(first.value.byteLength <= 1024 * 1024);
  assert.equal((await status()).finished, false, "not finished after the first MB");
  let got = first.value.byteLength, last = 0;
  for (let c = await reader.read(); !c.done; c = await reader.read()) { got += c.value.byteLength; last = c.value[c.value.byteLength - 1]; }
  assert.equal(got, big.length);
  assert.equal(last, 9);
  assert.deepEqual(await status(), { manifest: true, asked: true, started: true, finished: true });
  // asked again: no more writes (4 marks in all, a key each)
  await (await at(`/sign/host/${tok}/app.ipa`)).arrayBuffer();
  await (await at(`/sign/host/${tok}/manifest.plist`)).text();
  assert.equal(writes.filter((k) => /\.ios\./.test(k)).length, 4);
  // a link KV never shows: 404 once the wait is over
  const t0 = Date.now();
  assert.equal((await at(`/sign/host/${"e".repeat(48)}/manifest.plist`)).status, 404);
  assert.ok(Date.now() - t0 >= 0.02 * 6000 - 40, "it looked again before the 404");
  assert.equal((await at(`/sign/host/${"e".repeat(48)}/app.ipa`)).status, 404);
  assert.deepEqual(await (await at(`/sign/host/${"e".repeat(48)}/status`)).json(), { manifest: false, asked: false, started: false, finished: false });
  console.log("worker host status: ok");
}

// B208: the finished mark goes to ctx.waitUntil (Cloudflare cancels the request once iOS has every byte, and a put
// still pending then was lost: the app never saw finished and never closed itself); started needs none (it is written
// before the first byte goes out).
{
  const kept = [];
  const ctx = { waitUntil: (p) => kept.push(p) };
  const at = (path, init) => w.fetch(new Request("https://sign.example" + path, init), env, ctx);
  const big = new Uint8Array(1024 * 1024 + 3);
  big[0] = 0x50; big[1] = 0x4b;
  let r = await at("/sign/host?bundleid=com.ryha.ifizbox&version=1.0&title=iFizBox", { method: "POST", body: big, headers: { "Content-Length": String(big.length) } });
  const tok = /\/sign\/host\/([0-9a-f]{48})\//.exec((await r.json()).manifest)[1];
  r = await at(`/sign/host/${tok}/app.ipa`, { headers: { Range: "bytes=0-9" } });
  await r.arrayBuffer();
  assert.equal(kept.length, 1, "a Range short of the end: asked only, nothing finished");
  r = await at(`/sign/host/${tok}/app.ipa`);
  assert.equal((await r.arrayBuffer()).byteLength, big.length);
  assert.equal(kept.length, 3, "asked again, and the finished mark, are kept alive past the response");
  await Promise.all(kept);
  assert.equal((await (await at(`/sign/host/${tok}/status`)).json()).finished, true);
  console.log("worker host finished mark kept: ok");
}

// B215: a signed IPA over KV's 25 MB a value (0.17.2's was 29.6 MB): in parts (size=, PUT each, done) and as one body
// (the apps before B215), no KV value over 25 MB, served back whole, by Range across a part edge, and finished.
{
  const { PART: P, HOST_MAX, hostBody } = await import("./src/index.js");
  const sizes = [];
  const kept = [];
  const ttls = {};
  const kv = { ...env.HOSTED, put: async (k, v, o) => { sizes.push(typeof v === "string" ? v.length : v.byteLength); ttls[k] = o?.expirationTtl; return env.HOSTED.put(k, v, o); } };
  const henv = { ...env, WAIT_SCALE: "0.02", HOSTED: kv };
  const at = (path, init) => w.fetch(new Request("https://sign.example" + path, init), henv, { waitUntil: (p) => kept.push(p) });
  const big = new Uint8Array(29.6 * 1024 * 1024 | 0);
  big[0] = 0x50; big[1] = 0x4b; big[P - 1] = 7; big[P] = 8; big[big.length - 1] = 9;
  const q = "/sign/host?bundleid=com.ryha.ifizbox&version=0.17.2&title=iFizBox";
  const check = async (tok) => {
    assert.match(await (await at(`/sign/host/${tok}/manifest.plist`)).text(), /<string>0\.17\.2<\/string>/);
    assert.equal((await at(`/sign/host/${tok}/app.ipa`, { method: "HEAD" })).headers.get("Content-Length"), String(big.length));
    let r = await at(`/sign/host/${tok}/app.ipa`, { headers: { Range: `bytes=${P - 2}-${P + 1}` } });
    assert.equal(r.status, 206);
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0, 7, 8, 0]);
    r = await at(`/sign/host/${tok}/app.ipa`);
    const got = new Uint8Array(await r.arrayBuffer());
    assert.equal(got.length, big.length);
    assert.ok(got[0] === 0x50 && got[P - 1] === 7 && got[P] === 8 && got[big.length - 1] === 9);
    await Promise.all(kept);
    assert.deepEqual(await (await at(`/sign/host/${tok}/status`)).json(), { manifest: true, asked: true, started: true, finished: true });
  };
  // in parts
  let r = await at(q + "&size=" + big.length, { method: "POST" });
  const up = await r.json();
  assert.equal(up.partSize, P);
  assert.equal(up.parts, 2);
  assert.equal((await at(`/sign/host/${up.token}/manifest.plist`)).status, 404, "no link before done");
  r = await at(`/sign/host/${up.token}/done`, { method: "POST" });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Part 1 of 2 is missing/);
  assert.equal((await at(`/sign/host/${up.token}/0`, { method: "PUT", body: big.subarray(0, 10) })).status, 400, "a part of the wrong length");
  assert.equal((await at(`/sign/host/${up.token}/0`, { method: "PUT", body: new Uint8Array(P) })).status, 400, "part 0 not a zip");
  assert.equal((await at(`/sign/host/${up.token}/2`, { method: "PUT", body: big.subarray(0, 10) })).status, 400, "no such part");
  for (let i = 0; i < up.parts; i++) {
    r = await at(`/sign/host/${up.token}/${i}`, { method: "PUT", body: big.subarray(i * P, Math.min(big.length, (i + 1) * P)) });
    assert.equal(r.status, 200);
  }
  r = await at(`/sign/host/${up.token}/done`, { method: "POST" });
  assert.equal(r.status, 200);
  const done = await r.json();
  assert.match(done.itms, /^itms-services:/);
  assert.equal(done.manifest, `https://sign.example/sign/host/${up.token}/manifest.plist`);
  assert.equal((await at(`/sign/host/${up.token}/1`, { method: "PUT", body: big.subarray(P) })).status, 409, "finished");
  assert.equal((await (await at(`/sign/host/${up.token}/done`, { method: "POST" })).json()).manifest, done.manifest, "done again (a retry) answers the link");
  await check(up.token);
  // a part put just before the token's first ttl ran out outlives the token's second ttl, given at done
  assert.ok(ttls[`${up.token}.0`] >= 2 * 600, "parts outlive the link");
  assert.equal((await at(q, { method: "POST", body: new Uint8Array([0x50]), headers: { "Content-Length": "1" } })).status, 400, "too small to be an IPA");
  assert.equal((await at(q + "&size=" + (HOST_MAX + 1), { method: "POST" })).status, 413);
  assert.equal((await at(q + "&size=x", { method: "POST" })).status, 400);
  // one body, as the apps before B215 send it
  r = await at(q, { method: "POST", body: big, headers: { "Content-Length": String(big.length) } });
  assert.equal(r.status, 200);
  await check(/\/sign\/host\/([0-9a-f]{48})\//.exec((await r.json()).manifest)[1]);
  assert.ok(Math.max(...sizes) <= 25 * 1024 * 1024, "no KV value over 25 MB");
  assert.equal((await at(q, { method: "POST", body: big, headers: { "Content-Length": String(96 * 1024 * 1024) } })).status, 413);
  // hostBody: a body shorter or longer than its Content-Length, or not a zip, stores nothing usable
  const meta = { size: 10, parts: 1, partSize: P };
  const body = (b) => new Response(b).body;
  assert.equal((await hostBody(body(big.subarray(0, 9)), meta, async () => {})).status, 400);
  assert.equal((await hostBody(body(big.subarray(0, 11)), meta, async () => {})).status, 400);
  assert.equal((await hostBody(body(new Uint8Array(10)), meta, async () => {})).status, 400);
  assert.equal(await hostBody(body(big.subarray(0, 10)), meta, async () => {}), null);
  console.log("worker host in parts (B215): ok");
}

// B217: /sign/upload's parts outlive the link, as /sign/host's: done gives the upload's key a fresh ttl, so a part
// put just before the first ttl ran out must still last that second ttl (2*ttl+300 from its PUT).
{
  const ttls = {};
  const kv = { ...env.HOSTED, put: async (k, v, o) => { ttls[k] = o?.expirationTtl; return env.HOSTED.put(k, v, o); } };
  const uenv = { ...env, HOSTED: kv };
  const at = (path, init) => w.fetch(new Request("https://sign.example" + path, init), uenv);
  const app = new Uint8Array(PART + 3);
  app[0] = 0x50; app[1] = 0x4b;
  const up = await (await at(`/sign/upload?bundleid=com.any.app&version=1&title=Any&size=${app.length}`, { method: "POST" })).json();
  assert.equal((await at(`/sign/upload/${up.token}/0`, { method: "PUT", body: app.slice(0, PART) })).status, 200);
  assert.equal((await at(`/sign/upload/${up.token}/1`, { method: "PUT", body: app.slice(PART) })).status, 200);
  const done = await at(`/sign/upload/${up.token}/done`, { method: "POST" });
  assert.equal(done.status, 200);
  assert.equal(ttls[`up.${up.token}`], 600, "the link lasts ttl from done");
  for (const i of [0, 1]) assert.equal(ttls[`up.${up.token}.${i}`], 2 * 600 + 300, `part ${i} outlives the link`);
  console.log("worker upload parts outlive the link (B217): ok");
}

// F178/B165: iFizBox's AltStore source at https://<DOMAIN>/repo/source.json: the latest release's source.json
// (live the moment a release is published), else the deployed web/app/source.json (ASSETS) when GitHub fails; and
// the site's proxy answers its own /repo/ URLs without fetching itself.
{
  const { repo, selfSource, ownRepoUrl } = await import("./src/index.js");
  const { DOMAIN } = await import("../web/app/brand.js");
  // the deployed copy lags: it still lists 0.14.0 while the release's asset lists 0.15.0
  const body = '{"name":"iFizBox","apps":[{"version":"0.14.0"}]}';
  const released = '{"name":"iFizBox","apps":[{"version":"0.15.0"}]}';
  const assetsAsked = [];
  const ASSETS = { fetch: async (req) => { assetsAsked.push(new URL(req.url).pathname); return new Response(body, { headers: { "content-type": "application/json" } }); } };
  const none = async () => { throw new Error("GitHub is down"); };
  const at = (path, e = {}, fetcher = none, init) => { const req = new Request(`https://${DOMAIN}${path}`, init); return repo(req, new URL(req.url), e, { fetcher, wait: async () => {} }); };
  const seen = [];
  const gh = async (url) => { seen.push(url); return url.endsWith("/source.json") ? new Response(released) : new Response("no", { status: 404 }); };
  // the release wins over an older deployed copy, and ASSETS isn't asked
  let r = await at("/repo/source.json", { ASSETS }, gh);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), released);
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(r.headers.get("cache-control"), "public, max-age=300");
  assert.equal(seen.pop(), "https://github.com/RyanAHayden/iFizBox/releases/latest/download/source.json");
  assert.deepEqual(assetsAsked, []);
  r = await at("/repo/source.json", {}, gh);
  assert.equal(await r.text(), released);
  r = await at("/repo/source.json", { ASSETS, IFIZBOX_REPO: "me/fork" }, gh);
  assert.equal(r.status, 200);
  assert.equal(seen.pop(), "https://github.com/me/fork/releases/latest/download/source.json");
  assert.equal((await at("/repo/source.json", { ASSETS }, gh, { method: "HEAD" })).status, 200);
  assert.equal((await at("/repo/source.json", { ASSETS }, gh, { method: "POST" })).status, 404);
  // GitHub fails (throws, 404, 503 after the retries): the deployed copy
  r = await at("/repo/source.json", { ASSETS });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), body);
  assert.deepEqual(assetsAsked, ["/source.json"]);
  r = await at("/repo/source.json", { ASSETS }, async () => new Response("no", { status: 404 }));
  assert.equal(await r.text(), body);
  r = await at("/repo/source.json", { ASSETS }, async () => new Response("down", { status: 503 }));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), body);
  assert.equal(r.headers.get("cache-control"), "public, max-age=300");
  assert.equal((await at("/repo/source.json", { ASSETS }, none, { method: "HEAD" })).status, 200);
  // neither: 404
  const missing = { fetch: async () => new Response("nope", { status: 404 }) };
  assert.equal((await at("/repo/source.json", { ASSETS: missing })).status, 404);
  assert.equal((await at("/repo/source.json", {}, async () => new Response("no", { status: 404 }))).status, 404);
  assert.equal(typeof selfSource, "function");
  // the whole Worker: /repo/source.json before the website's assets (GitHub down here: the deployed copy)
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = none;
    try { r = await w.fetch(new Request(`https://${DOMAIN}/repo/source.json`), { ...env, ASSETS }); } finally { globalThis.fetch = realFetch; }
  }
  assert.equal(r.status, 200);
  assert.equal(await r.text(), body);
  // /api/fetch of the Worker's own /repo/ URL: answered here (a Worker can't fetch its own custom domain)
  const u = new URL(`https://${DOMAIN}/api/fetch`);
  assert.ok(ownRepoUrl(new URL(`https://${DOMAIN}/repo/source.json`), u));
  assert.ok(ownRepoUrl(new URL(`https://www.${DOMAIN}/repo/source.json`), u));
  assert.equal(ownRepoUrl(new URL(`https://${DOMAIN}/source.json`), u), null);
  assert.equal(ownRepoUrl(new URL("https://example.com/repo/source.json"), u), null);
  assert.equal(ownRepoUrl(new URL(`http://${DOMAIN}/repo/source.json`), u), null);
  const realFetch = globalThis.fetch;
  globalThis.fetch = none;
  try {
    r = await w.fetch(new Request(`https://${DOMAIN}/api/fetch?url=${encodeURIComponent(`https://${DOMAIN}/repo/source.json`)}`), { ...env, ASSETS });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(r.status, 200);
  assert.equal(await r.text(), body);
  assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
  console.log("worker self source: ok");
}

// B87/B95: /api/fetch?kind=ipa hands on upstream's body untouched (no JS per chunk: a 104 MB IPA through a JS
// TransformStream ran out of Worker CPU), with Content-Length and X-IPA-Length for the website's own checks; one
// over the cap is refused up front; a Range (bytes=n-) goes on, so the website can resume a body that broke off.
{
  const realFetch = globalThis.fetch;
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 5, 6, 7, 8]);
  let sentBody = null, asked = [];
  const answer = (headers, data = bytes, status = 200) => async (url, init) => {
    asked.push(init?.headers?.Range ?? null);
    sentBody = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } });
    return new Response(sentBody, { status, headers });
  };
  const ipaGo = (init) => w.fetch(new Request("https://sign.example/api/fetch?kind=ipa&url=" + encodeURIComponent("https://example.com/x.ipa"), init), env);
  try {
    globalThis.fetch = answer({ "Content-Length": "8" });
    let r = await ipaGo();
    assert.equal(r.status, 200);
    assert.equal(r.body, sentBody, "the body is upstream's own stream, not piped through JS");
    assert.equal(r.headers.get("content-length"), "8");
    assert.equal(r.headers.get("x-ipa-length"), "8");
    assert.match(r.headers.get("access-control-expose-headers"), /X-IPA-Length/);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
    assert.deepEqual(asked, [null]);
    // over the cap: refused before any byte
    globalThis.fetch = answer({ "Content-Length": String(600 * 1024 * 1024) });
    r = await ipaGo();
    assert.equal(r.status, 413);
    assert.equal((await r.json()).code, "too_large");
    // resumed: the Range goes on, the answer's total in X-IPA-Length
    asked = [];
    globalThis.fetch = answer({ "Content-Length": "3", "Content-Range": "bytes 5-7/8" }, bytes.slice(5), 206);
    r = await ipaGo({ headers: { Range: "bytes=5-" } });
    assert.equal(r.status, 206);
    assert.deepEqual(asked, ["bytes=5-"]);
    assert.equal(r.headers.get("x-ipa-length"), "8");
    assert.equal(r.headers.get("content-range"), "bytes 5-7/8");
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes.slice(5));
    // a resumed total over the cap is refused too; a Range of another shape isn't passed on
    globalThis.fetch = answer({ "Content-Length": "3", "Content-Range": `bytes 5-7/${600 * 1024 * 1024}` }, bytes.slice(5), 206);
    assert.equal((await ipaGo({ headers: { Range: "bytes=5-" } })).status, 413);
    asked = [];
    globalThis.fetch = answer({ "Content-Length": "8" });
    r = await ipaGo({ headers: { Range: "bytes=0-3" } });
    assert.equal(r.status, 200);
    assert.deepEqual(asked, [null]);
  } finally { globalThis.fetch = realFetch; }
  console.log("worker ipa length: ok");
}

// F253: this iPhone's UDID via a Profile Service profile: start, the profile, iOS's signed answer, the poll.
import { readAnswer, udidProfile, UDID_KEY } from "./src/udid.js";
{
  let r = await go("/sign/udid", { method: "POST" });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.match(s.challenge, /^[0-9a-f]{32}$/);
  assert.equal(s.poll, `https://sign.example/sign/udid/${s.challenge}`);
  assert.equal(s.expiresIn, 600);
  assert.deepEqual(await (await go(new URL(s.poll).pathname)).json(), { state: "waiting" });
  r = await go(new URL(s.profile).pathname);
  assert.equal(r.headers.get("content-type"), "application/x-apple-aspen-config");
  const prof = await r.text();
  assert.match(prof, /<key>PayloadType<\/key>\s*<string>Profile Service<\/string>/);
  assert.match(prof, new RegExp(`<key>URL</key>\\s*<string>https://sign\\.example/sign/udid/${s.challenge}/answer</string>`));
  assert.match(prof, new RegExp(`<key>Challenge</key>\\s*<string>${s.challenge}</string>`));
  for (const a of ["UDID", "PRODUCT", "VERSION"]) assert.match(prof, new RegExp(`<string>${a}</string>`));
  assert.match(udidProfile({ url: "https://x/a?b&c", challenge: "c" }), /<string>https:\/\/x\/a\?b&amp;c<\/string>/);

  // iOS's answer: a plist inside CMS bytes (made up around it here; the Worker doesn't check the signature)
  const plistOf = (udid, challenge) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CHALLENGE</key><string>${challenge}</string><key>IMEI</key><string>35 000000 000000 0</string>
<key>PRODUCT</key><string>iPhone9,3</string><key>UDID</key><string>${udid}</string><key>VERSION</key><string>19H410</string></dict></plist>`;
  const cms = (text) => new Uint8Array([0x30, 0x80, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02, 0xa0, 0x80,
    ...new TextEncoder().encode(text), 0x00, 0x00, 0xff, 0xfe, 0x31, 0x00]);
  const UDID = "00008030-001A2D3E0E38802E";
  assert.deepEqual(readAnswer(cms(plistOf(UDID, "abc"))), { udid: UDID, product: "iPhone9,3", version: "19H410", challenge: "abc" });
  assert.equal(readAnswer(cms(plistOf("<script>", "abc"))), null);
  assert.equal(readAnswer(new Uint8Array([1, 2, 3])), null);
  const answer = (c, body) => go(`/sign/udid/${c}/answer`, { method: "POST", body, headers: { "Content-Type": "application/pkcs7-signature" } });
  assert.equal((await answer(s.challenge, cms(plistOf(UDID, "f".repeat(32))))).status, 400); // another visit's challenge
  assert.equal((await answer("0".repeat(32), cms(plistOf(UDID, "0".repeat(32))))).status, 404); // never given out
  assert.equal((await answer(s.challenge, new Uint8Array(70 * 1024))).status, 413);
  r = await answer(s.challenge, cms(plistOf(UDID, s.challenge)));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("location"), `https://sign.example/sign/udid/${s.challenge}/done`);
  assert.deepEqual(await (await go(new URL(s.poll).pathname)).json(), { state: "done", udid: UDID, product: "iPhone9,3", version: "19H410" });
  const done = await (await go(`/sign/udid/${s.challenge}/done`)).text();
  assert.match(done, /UDID Sent/);
  assert.match(done, new RegExp(`localStorage\\.setItem\\("${UDID_KEY.replace(".", "\\.")}"`));
  assert.match(done, /iPhone9,3/);
  assert.equal((await go(`/sign/udid/${"1".repeat(32)}`)).status, 404);
  assert.equal((await go("/sign/udid")).status, 405);
  assert.equal((await go("/sign/udid/nothex")).status, 404);
  console.log("worker udid: ok");
}

// F251: the Apple relay (src/apple-relay.js): off unless APPLE_RELAY=1, a fixed allow-list, caps, no redirects.
import { appleRelay, relayTarget, MAX_REQUEST, MAX_REPLY } from "./src/apple-relay.js";
{
  const on = { APPLE_RELAY: "1" };
  const req = (path, init = {}) => new Request("https://sign.example" + path, init);
  // Off by default (ifizbox.com deploys from main): 404, and the route doesn't fall through to the website.
  let r = await w.fetch(req("/apple/gsa.apple.com/grandslam/GsService2", { method: "POST", body: "x" }), env);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "not_found");

  const tgt = (p, o) => relayTarget(new URL("https://sign.example" + p), o)?.href ?? null;
  assert.equal(tgt("/apple/gsa.apple.com/grandslam/GsService2"), "https://gsa.apple.com/grandslam/GsService2");
  assert.equal(tgt("/apple/gsa.apple.com/grandslam/GsService2/validate"), "https://gsa.apple.com/grandslam/GsService2/validate");
  assert.equal(tgt("/apple/gsa.apple.com/auth/verify/phone/securitycode"), "https://gsa.apple.com/auth/verify/phone/securitycode");
  assert.equal(tgt("/apple/gsa.apple.com/grandslam/MidService/startMachineProvisioning"), "https://gsa.apple.com/grandslam/MidService/startMachineProvisioning");
  assert.equal(tgt("/apple/developerservices2.apple.com/services/QH65B2/listTeams.action?clientId=XABBG36SBA"),
    "https://developerservices2.apple.com/services/QH65B2/listTeams.action?clientId=XABBG36SBA");
  assert.equal(tgt("/apple/developerservices2.apple.com/services/QH65B2/ios/addAppId.action"), "https://developerservices2.apple.com/services/QH65B2/ios/addAppId.action");
  assert.equal(tgt("/apple/new.ani.sidestore.io/v3/get_headers"), "https://new.ani.sidestore.io/v3/get_headers");
  for (const bad of ["/apple/evil.example/", "/apple/gsa.apple.com/", "/apple/gsa.apple.com/grandslam/GsService2/../x",
    "/apple/idmsa.apple.com/appleauth/auth", "/apple/developerservices2.apple.com/services/v1/profiles", "/apple/new.ani.sidestore.io/v3/provisioning_session",
    "/apple/127.0.0.1/", "/apple/gsa.apple.com.evil.example/grandslam/GsService2", "/apple/gsa.apple.com"]) assert.equal(tgt(bad), null, bad);
  assert.equal(tgt("/apple/new.ani.sidestore.io/v3/provisioning_session", { ws: true }), "https://new.ani.sidestore.io/v3/provisioning_session");
  assert.equal(tgt("/apple/gsa.apple.com/grandslam/GsService2", { ws: true }), null);

  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("GsService2/lookup")) return new Response(null, { status: 302, headers: { Location: "https://evil.example/" } });
    if (url.includes("listTeams")) return new Response(new Uint8Array(MAX_REPLY + 1), { status: 200 });
    if (url.includes("get_headers")) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    if (init.headers?.Upgrade === "websocket") return new Response("no", { status: 502 });
    return new Response("<plist/>", { status: 401, headers: { "Content-Type": "text/x-xml-plist", "Set-Cookie": "a=b", "X-Other": "1" } });
  };
  const relay = (path, init) => appleRelay(req(path, init), on, { fetcher });
  r = await relay("/apple/gsa.apple.com/grandslam/GsService2", { method: "POST", body: "<plist/>", headers: {
    "Content-Type": "text/x-xml-plist", "X-Relay-User-Agent": "akd/1.0", "X-Apple-I-MD": "md", "Cookie": "session=1",
    "Authorization": "Bearer x", "CF-Connecting-IP": "1.2.3.4", "Origin": "https://sign.example", "security-code": "123456" } });
  assert.equal(r.status, 401); // Apple's own status
  assert.equal(r.headers.get("X-Relay-Status"), "401");
  assert.equal(r.headers.get("Content-Type"), "text/x-xml-plist");
  assert.equal(r.headers.get("Set-Cookie"), null);
  assert.equal(r.headers.get("X-Other"), null);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null); // same origin only
  assert.equal(await r.text(), "<plist/>");
  const out = calls.at(-1);
  assert.equal(out.url, "https://gsa.apple.com/grandslam/GsService2");
  assert.equal(out.init.redirect, "manual");
  assert.ok(out.init.signal);
  assert.deepEqual([...out.init.headers.keys()].sort(), ["connection", "content-type", "security-code", "user-agent", "x-apple-i-md"]);
  assert.equal(out.init.headers.get("connection"), "close"); // B498d: the relay's own, a fresh connection for GrandSlam
  assert.equal(out.init.headers.get("user-agent"), "akd/1.0");
  assert.equal(new TextDecoder().decode(out.init.body), "<plist/>");

  assert.equal((await relay("/apple/evil.example/x")).status, 403);
  assert.equal((await relay("/apple/gsa.apple.com/grandslam/GsService2", { method: "POST", body: "x", headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await relay("/apple/gsa.apple.com/grandslam/GsService2", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await relay("/apple/gsa.apple.com/grandslam/GsService2", { method: "DELETE" })).status, 405);
  assert.equal((await relay("/apple/gsa.apple.com/grandslam/GsService2", { method: "POST", body: new Uint8Array(MAX_REQUEST + 1) })).status, 413);
  r = await relay("/apple/gsa.apple.com/grandslam/GsService2/lookup");
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, "redirect");
  r = await relay("/apple/developerservices2.apple.com/services/QH65B2/listTeams.action");
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, "reply_too_large");
  r = await relay("/apple/new.ani.sidestore.io/v3/get_headers", { method: "POST", body: "{}" });
  assert.equal(r.status, 504);
  assert.equal(r.headers.get("X-Relay-Status"), null); // the relay's own answer, not Apple's
  // The anisette provisioning WebSocket goes to the server (only that path, only GET); one that won't open is a 502.
  r = await relay("/apple/new.ani.sidestore.io/v3/provisioning_session", { headers: { Upgrade: "websocket" } });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, "upstream");
  assert.equal(calls.at(-1).url, "https://new.ani.sidestore.io/v3/provisioning_session");
  assert.equal((await relay("/apple/gsa.apple.com/grandslam/GsService2", { headers: { Upgrade: "websocket" } })).status, 403);
  // Routed by the Worker when on.
  assert.equal((await w.fetch(req("/apple/evil.example/x"), { ...env, ...on })).status, 403);
  // F254: /apple/status says on (and nothing reaches the fetcher); off it's the same 404 as every relay path.
  const before = calls.length;
  r = await relay("/apple/status");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { on: true });
  assert.equal(calls.length, before);
  assert.equal((await w.fetch(req("/apple/status"), env)).status, 404);
  assert.equal((await relay("/apple/status", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);

  // App Store Connect pass-through (core/asc.js): on even with APPLE_RELAY off, Authorization goes out only there,
  // DELETE only there, and only the provisioning paths.
  assert.equal(tgt("/apple/api.appstoreconnect.apple.com/v1/devices?filter%5Budid%5D=X"), "https://api.appstoreconnect.apple.com/v1/devices?filter%5Budid%5D=X");
  assert.equal(tgt("/apple/api.appstoreconnect.apple.com/v1/bundleIds/ABC123/bundleIdCapabilities"), "https://api.appstoreconnect.apple.com/v1/bundleIds/ABC123/bundleIdCapabilities");
  for (const bad of ["/apple/api.appstoreconnect.apple.com/v1/apps", "/apple/api.appstoreconnect.apple.com/v1/users",
    "/apple/api.appstoreconnect.apple.com/v2/devices", "/apple/api.appstoreconnect.apple.com/v1/profiles/a/b"]) assert.equal(tgt(bad), null, bad);
  const off = (path, init) => appleRelay(req(path, init), {}, { fetcher });
  r = await off("/apple/api.appstoreconnect.apple.com/v1/profiles/P1", { method: "DELETE", headers: { Authorization: "Bearer jwt", Cookie: "c=1" } });
  assert.equal(r.status, 401); // the fake's answer, passed through
  assert.equal(calls.at(-1).url, "https://api.appstoreconnect.apple.com/v1/profiles/P1");
  assert.equal(calls.at(-1).init.method, "DELETE");
  assert.deepEqual([...calls.at(-1).init.headers.keys()].sort(), ["authorization"]);
  assert.equal((await off("/apple/gsa.apple.com/grandslam/GsService2", { method: "POST", body: "x" })).status, 404); // the rest stays off
  assert.equal((await off("/apple/api.appstoreconnect.apple.com/v1/devices", { headers: { Origin: "https://evil.example" } })).status, 403);
  console.log("worker apple relay: ok");
}

// B498b: the provisioning WebSocket end to end: gsa.js's anisetteV3 through relayTransport and appleRelay to a mock
// anisette server that drops its socket without a close frame right after its last message.
import { anisetteV3, relayTransport, relayWsUrl, encodePlist, utf8 } from "../web/app/core/gsa.js";
{
  // One end of a socket, as a Worker has it: nothing is delivered before accept(), and everything arrives in order.
  class End {
    listeners = {}; queue = []; accepted = false; closed = false; sentClose = null;
    addEventListener(type, f) { (this.listeners[type] ??= []).push(f); }
    accept() { this.accepted = true; for (const [type, e] of this.queue.splice(0)) this.emit(type, e); }
    emit(type, e) {
      if (!this.accepted) return void this.queue.push([type, e]);
      queueMicrotask(() => { for (const f of this.listeners[type] ?? []) f(e); });
    }
    send(data) { if (this.closed) throw new Error("closed"); this.peer.emit("message", { data }); }
    close(code, reason) {
      if (this.closed) return;
      if (code === 1005 || code === 1006) throw new Error("reserved close code");
      this.closed = true; this.sentClose = code; this.peer.emit("close", { code, reason });
    }
    drop() { this.closed = true; this.peer.emit("error", {}); this.peer.emit("close", { code: 1006, reason: "" }); }
  }
  const pair = () => { const a = new End(), b = new End(); a.peer = b; b.peer = a; return [a, b]; };
  class Pair { constructor() { [this[0], this[1]] = pair(); } }

  const got = []; // what reached the anisette server
  let remote; // the server's end of the latest socket
  const anisette = () => {
    const [near, far] = pair();
    remote = far;
    far.accept();
    const say = (m) => far.send(JSON.stringify(m));
    far.addEventListener("message", ({ data }) => {
      const m = JSON.parse(data);
      got.push(Object.keys(m)[0]);
      if (m.identifier) say({ result: "GiveStartProvisioningData" });
      else if (m.spim) say({ result: "GiveEndProvisioningData", cpim: "CPIM" });
      else { say({ result: "ProvisioningSuccess", adi_pb: "ADI" }); far.drop(); }
    });
    say({ result: "GiveIdentifier" }); // before the relay has called accept()
    return { webSocket: near };
  };
  const xml = (o) => new Response(encodePlist(o), { headers: { "Content-Type": "text/x-xml-plist" } });
  const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
  const upstream = async (url, init) => {
    if (init.headers?.Upgrade === "websocket") return anisette();
    if (url.endsWith("/v3/client_info")) return json({ client_info: "<MacBookPro13,2> <macOS;10.12.6;16G29>", user_agent: "akd/1.0" });
    if (url.endsWith("/v3/get_headers")) return json({ result: "Headers", "X-Apple-I-MD": "md", "X-Apple-I-MD-M": "mdm" });
    return xml(url.endsWith("lookup") ? { urls: {} } : { Response: { spim: "SPIM", ptm: "PTM", tk: "TK" } });
  };
  const origin = "https://sign.example";
  const hook = { fetcher: upstream, Pair, upgrade: (client) => ({ status: 101, webSocket: client }) };
  const relayed = (path, init) => appleRelay(new Request(origin + path, init), { APPLE_RELAY: "1" }, hook);
  let browserEnd;
  const closes = [], errors = [];
  class BrowserSocket { // the page's WebSocket: connects through the relay and takes the other end of its pair
    constructor(url) {
      relayed(new URL(url).pathname, { headers: { Upgrade: "websocket", Origin: origin } }).then((r) => {
        assert.equal(r.status, 101);
        browserEnd = r.webSocket;
        browserEnd.addEventListener("message", (e) => this.onmessage?.(e));
        browserEnd.addEventListener("error", (e) => { errors.push(e); this.onerror?.(e); });
        browserEnd.addEventListener("close", (e) => { closes.push(e.code); this.onclose?.(e); });
        browserEnd.accept();
      }).catch((e) => this.onerror?.(e));
    }
    send(data) { browserEnd.send(data); }
    close() { browserEnd?.close(1000); }
  }
  let saved;
  const ani = anisetteV3({ transport: relayTransport({ fetcher: relayed }), servers: ["https://new.ani.sidestore.io"],
    wsUrl: (s) => relayWsUrl(s, origin), WebSocketImpl: BrowserSocket, provisionTimeout: 5000,
    storage: { load: () => null, save: (s) => { saved = s; } } });
  const h = await ani.get();
  assert.equal(h.headers["X-Apple-I-MD"], "md");
  assert.equal(saved.adi_pb, "ADI");
  assert.deepEqual(got, ["identifier", "spim", "ptm"]);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(errors.length, 0); // the server's drop reaches the page as a close, not an error

  // Closes cross over both ways, with codes close() accepts; binary messages stay as they are.
  const open = async () => {
    const r = await relayed("/apple/new.ani.sidestore.io/v3/provisioning_session", { headers: { Upgrade: "websocket" } });
    const page = r.webSocket, seen = [];
    for (const type of ["message", "close"]) page.addEventListener(type, (e) => seen.push([type, e.data ?? e.code]));
    page.accept();
    return { page, seen, far: remote };
  };
  const settle = () => new Promise((done) => setTimeout(done, 0));
  for (const [sent, expected] of [[1000, 1000], [4001, 4001]]) {
    const { seen, far } = await open();
    const bytes = utf8("bin").buffer;
    far.send(bytes); far.close(sent);
    await settle();
    assert.deepEqual(seen.slice(1), [["message", bytes], ["close", expected]]);
  }
  {
    const { seen, far } = await open();
    far.drop();
    await settle();
    assert.deepEqual(seen.at(-1), ["close", 1011]);
  }
  {
    const { page, far } = await open();
    const closed = [];
    far.addEventListener("close", (e) => closed.push(e.code));
    page.close(1000);
    await settle();
    assert.deepEqual(closed, [1000]);
  }
  console.log("worker apple relay websocket: ok");
}

// F258: the setup command's code hand-off (src/setup.js): a finished upload gets a short code; the code reads back
// the IPA's link, the app and where the pairing file goes; the scripts and binaries come from the setup release.
import { setup, normalCode, newCode, showCode, containerPath, SETUP_ALPHABET, PAIRING_PATH } from "./src/setup.js";
{
  assert.equal(SETUP_ALPHABET.length, 31);
  assert.ok(!/[01OIL]/.test(SETUP_ALPHABET));
  assert.equal(normalCode(" abcd-2345 "), "ABCD2345");
  assert.equal(normalCode("ABCD 2345"), "ABCD2345");
  assert.equal(normalCode("ABCD-234"), null);   // too short
  assert.equal(normalCode("ABCD-23O5"), null);  // O isn't in the alphabet
  assert.equal(normalCode(null), null);
  assert.equal(showCode("ABCD2345"), "ABCD-2345");
  let calls = 0;
  const fixed = newCode((n) => { calls++; return calls === 1 ? new Uint8Array(n).fill(250) : Uint8Array.from({ length: n }, (_, i) => i); });
  assert.equal(fixed, SETUP_ALPHABET.slice(0, 8)); // bytes over 247 are skipped (no bias), then 0..7
  for (let i = 0; i < 50; i++) assert.ok(normalCode(newCode()));
  assert.equal(containerPath("Documents/pairingFile.plist"), "Documents/pairingFile.plist");
  for (const bad of ["", "/etc/passwd", "Documents/../x", "a//b", "./a", "a\\b", "a\nb"]) assert.equal(containerPath(bad), null, bad);

  const app = new Uint8Array([0x50, 0x4b, 9, 8, 7, 6]);
  const tok = "c".repeat(48);
  const post = (q) => go(`/sign/setup?${q}`, { method: "POST" });
  assert.equal((await post("token=xyz")).status, 400);
  assert.equal((await post(`token=${tok}`)).status, 404); // no such upload
  await go(`/sign/upload?bundleid=com.kdt.livecontainer.TEAM123&version=3.4&title=LiveContainer&token=${tok}`, { method: "POST" });
  assert.equal((await post(`token=${tok}`)).status, 409); // reserved, not finished
  await go(`/sign/upload?bundleid=com.kdt.livecontainer.TEAM123&version=3.4&title=LiveContainer&token=${tok}&size=${app.length}`, { method: "POST" });
  await go(`/sign/upload/${tok}/0`, { method: "PUT", body: app });
  await go(`/sign/upload/${tok}/done`, { method: "POST" });
  assert.equal((await post(`token=${tok}&pairing=../x`)).status, 400);
  assert.equal((await post(`token=${tok}&sha256=XYZ`)).status, 400);
  assert.equal((await post(`token=${tok}&bundleid=a/b`)).status, 400);
  const sha = "ab".repeat(32);
  let r = await post(`token=${tok}&sha256=${sha}`);
  const made = await r.json();
  assert.equal(r.status, 200, JSON.stringify(made));
  assert.match(made.code, new RegExp(`^[${SETUP_ALPHABET}]{4}-[${SETUP_ALPHABET}]{4}$`));
  assert.ok(made.expiresIn >= 590 && made.expiresIn <= 600, String(made.expiresIn));
  // read back: as typed, lowercase and without the dash too
  for (const typed of [made.code, made.code.toLowerCase().replace("-", "")]) {
    r = await go(`/sign/setup/${encodeURIComponent(typed)}`);
    const got = await r.json();
    assert.equal(r.status, 200, JSON.stringify(got));
    assert.equal(got.ipa, `https://sign.example/sign/up/${tok}/app.ipa`);
    assert.equal(got.size, app.length);
    assert.equal(got.sha256, sha);
    assert.equal(got.bundleId, "com.kdt.livecontainer.TEAM123");
    assert.equal(got.name, "LiveContainer");
    assert.deepEqual(got.pairing, { bundleId: "com.kdt.livecontainer.TEAM123", path: PAIRING_PATH });
    assert.ok(got.expiresIn > 0);
  }
  // the link it gives is the upload's own, whole
  r = await go(`/sign/up/${tok}/app.ipa`);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), app);
  // another app's container and path, or no pairing file at all
  let other = await (await post(`token=${tok}&bundleid=com.other.app&pairing=Documents/x/p.plist`)).json();
  let got = await (await go(`/sign/setup/${other.code}`)).json();
  assert.deepEqual(got.pairing, { bundleId: "com.other.app", path: "Documents/x/p.plist" });
  assert.equal(got.sha256, null);
  other = await (await post(`token=${tok}&pairing=`)).json();
  assert.equal((await (await go(`/sign/setup/${other.code}`)).json()).pairing, null);
  // a bad code, an unknown one, and one whose upload has gone
  r = await go("/sign/setup/ABC");
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "bad_code");
  r = await go("/sign/setup/ZZZZ-ZZZZ");
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "gone");
  store.delete(`up.${tok}`);
  assert.equal((await go(`/sign/setup/${made.code}`)).status, 404);

  // scripts and binaries: only the listed names, from the setup release
  const fetched = [];
  const upstream = async (url) => { fetched.push(url); return url.endsWith("/missing") ? new Response("", { status: 404 })
    : new Response(url.endsWith(".sh") ? "#!/bin/sh\n" : new Uint8Array([1, 2, 3]), { headers: { "content-length": url.endsWith(".sh") ? "10" : "3" } }); };
  const s = (path, e = env, init) => setup(new Request("https://sign.example" + path, init), new URL("https://sign.example" + path), e, 600, { upstream, repo: "owner/repo" });
  r = await s("/sign/setup.sh");
  assert.equal(await r.text(), "#!/bin/sh\n");
  assert.match(r.headers.get("content-type"), /^text\/plain/);
  assert.equal(fetched.at(-1), "https://github.com/owner/repo/releases/download/setup/install.sh");
  await s("/sign/setup.ps1");
  assert.equal(fetched.at(-1), "https://github.com/owner/repo/releases/download/setup/install.ps1");
  r = await s("/sign/setup/bin/ifizbox-setup-linux-arm64", { ...env, SETUP_TAG: "setup-test", IFIZBOX_REPO: "me/fork" });
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
  assert.equal(r.headers.get("content-type"), "application/octet-stream");
  assert.equal(fetched.at(-1), "https://github.com/me/fork/releases/download/setup-test/ifizbox-setup-linux-arm64");
  const n = fetched.length;
  assert.equal((await s("/sign/setup/bin/evil.exe")).status, 404);
  assert.equal((await s("/sign/setup/bin/..%2Fx")).status, 404);
  assert.equal(fetched.length, n); // nothing asked of GitHub for a name not on the list
  assert.equal((await s("/sign/setup/bin/SHA256SUMS", { ...env, SETUP_TAG: "bad tag!" })).status, 200);
  assert.equal(fetched.at(-1), "https://github.com/owner/repo/releases/download/setup/SHA256SUMS");
  assert.equal((await s("/sign/setup.sh", env, { method: "POST" })).status, 404);
  console.log("worker setup: ok");
}
// B190: the SSRF guard. Cloudflare's fetch refuses private addresses; the self-hosted server (node.mjs) can reach
// them, so its fetch (src/ssrf-node.js) resolves and checks every host and redirect, and both runtimes refuse
// literal private hosts before fetching.
import { blockedIp, blockedHost } from "./src/ssrf.js";
import { guardedFetch } from "./src/ssrf-node.js";
import { cappedBody, FETCH_MAX_BYTES } from "./src/index.js";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
{
  for (const ip of ["127.0.0.1", "127.255.0.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1",
    "fd12:3456::1", "ff02::1", "fec0::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "::127.0.0.1",
    "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "2002:7f00:1::", "2001:db8::1", "not an ip", ""]) assert.ok(blockedIp(ip), ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "100.128.0.1", "172.32.0.1", "2606:4700::1111", "64:ff9b::808:808", "2002:808:808::"])
    assert.ok(!blockedIp(ip), ip);
  const hostOf = (u) => new URL(u).hostname;
  for (const u of ["http://localhost/", "http://LOCALHOST./", "http://a.localhost/", "http://2130706433/", "http://0x7f.1/",
    "http://0177.0.0.1/", "http://127.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[0:0:0:0:0:0:0:1]/", "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/"]) assert.ok(blockedHost(hostOf(u)), u);
  for (const u of ["https://repo.example/", "https://8.8.8.8/", "https://[2606:4700::1111]/"]) assert.ok(!blockedHost(hostOf(u)), u);

  // an inner server the guard must never reach: /secret counts its hits, /hop?to= redirects, /public answers
  let hits = 0;
  const inner = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/secret") { hits++; res.end("SECRET"); return; }
    if (u.pathname === "/hop") { res.writeHead(302, { Location: u.searchParams.get("to") }); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok");
  });
  await new Promise((ok) => inner.listen(0, "127.0.0.1", ok));
  const P = inner.address().port;
  const refusedCode = async (p) => { await assert.rejects(p, (e) => e.code === "SSRF_REFUSED"); };
  try {
    const gf = guardedFetch({ lookup: async (h) => (h === "inward.test" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.9.9.9", family: 4 }]) });
    for (const u of [`http://127.0.0.1:${P}/secret`, `http://localhost:${P}/secret`, `http://2130706433:${P}/secret`, `http://[::1]:${P}/secret`,
      `http://[::ffff:127.0.0.1]:${P}/secret`, `http://inward.test:${P}/secret`, `http://other.test:${P}/secret`]) await refusedCode(gf(u));

    // "outer.test" stands for a public host (it resolves to the inner server, and only it is let through), so a
    // redirect inward is what the guard sees
    const lookup = async (h) => [{ address: h === "outer.test" ? "127.0.0.1" : "10.0.0.1", family: 4 }];
    const gf2 = guardedFetch({ lookup, blocked: (ip, host) => host !== "outer.test" && blockedIp(ip) });
    let r = await gf2(`http://outer.test:${P}/public`);
    assert.equal(await r.text(), "ok"); // connected to the resolved address: outer.test is in no DNS
    r = await gf2(`http://outer.test:${P}/hop?to=${encodeURIComponent(`http://outer.test:${P}/public`)}`);
    assert.equal(r.status, 200);
    assert.ok(r.redirected && r.url.endsWith("/public"));
    r = await gf2(`http://outer.test:${P}/hop?to=/public`, { redirect: "manual" });
    assert.equal(r.status, 302);
    for (const to of [`http://127.0.0.1:${P}/secret`, `http://localhost:${P}/secret`, `http://[::1]:${P}/secret`, `http://2130706433:${P}/secret`, `http://inward.test:${P}/secret`])
      await refusedCode(gf2(`http://outer.test:${P}/hop?to=${encodeURIComponent(to)}`));
    await assert.rejects(gf2(`http://outer.test:${P}/hop?to=${encodeURIComponent("file:///etc/passwd")}`));

    // through the routes, as node.mjs runs them (env.FETCH)
    const nodeEnv = { ...env, FETCH: gf };
    const at = (path, e = nodeEnv) => w.fetch(new Request("https://ifizbox.example" + path), e);
    const q = (u) => encodeURIComponent(u);
    for (const u of [`http://127.0.0.1:${P}/secret`, `http://localhost:${P}/secret`, `http://2130706433:${P}/secret`, `http://[::1]:${P}/secret`, `http://inward.test:${P}/secret`]) {
      for (const path of [`/api/fetch?url=${q(u)}`, `/api/fetch?url=${q(u)}&kind=ipa`, `/api/fetch?url=${q(u)}&kind=packages`, `/api/ipainfo?url=${q(u)}`]) {
        r = await at(path);
        assert.equal(r.status, 403, path);
        assert.equal((await r.json()).code, "refused", path);
      }
    }
    const viaOuter = { ...env, FETCH: gf2 };
    r = await at(`/api/fetch?url=${q(`http://outer.test:${P}/hop?to=${q(`http://127.0.0.1:${P}/secret`)}`)}`, viaOuter);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, "refused");
    r = await at(`/api/ipainfo?url=${q(`http://outer.test:${P}/hop?to=${q(`http://localhost:${P}/secret`)}`)}`, viaOuter);
    assert.equal(r.status, 403);
    r = await at(`/api/fetch?url=${q(`http://outer.test:${P}/public`)}`, viaOuter);
    assert.equal(await r.text(), "ok");
    assert.equal(hits, 0, "the inner server's /secret was reached");

    // /api/applookup and /api/appreviews ask Apple through env.FETCH too
    const asked = [];
    const spy = async (u) => { asked.push(String(u)); return Response.json({ results: [] }); };
    await at("/api/applookup?bundleId=com.a.b&country=us", { ...env, FETCH: spy });
    await at("/api/appreviews?id=1&country=us", { ...env, FETCH: spy });
    assert.deepEqual(asked.map((u) => new URL(u).host), ["itunes.apple.com", "itunes.apple.com"]);

    // the Worker (no env.FETCH): literal private hosts refused before any fetch
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = async () => { fetched++; return new Response("x"); };
    try {
      for (const u of [`http://127.0.0.1:${P}/`, "http://localhost/", "http://2130706433/", "http://[::1]/", "http://169.254.169.254/"]) {
        assert.equal((await at(`/api/fetch?url=${q(u)}`, env)).status, 403, u);
        assert.equal((await at(`/api/ipainfo?url=${q(u)}`, env)).status, 403, u);
      }
      assert.equal(fetched, 0);
      // the plain path's byte cap: a Content-Length over it is refused up front
      globalThis.fetch = async () => new Response("x", { headers: { "Content-Length": String(FETCH_MAX_BYTES + 1) } });
      r = await at(`/api/fetch?url=${q("https://repo.example/big.json")}`, env);
      assert.equal(r.status, 413);
      assert.equal((await r.json()).code, "too_large");
    } finally { globalThis.fetch = realFetch; }

    // cappedBody: over the cap, or slower than the overall time, the body errors; under both it comes whole
    const chunks = (n, size) => new ReadableStream({ pull(c) { n-- > 0 ? c.enqueue(new Uint8Array(size)) : c.close(); } });
    assert.equal((await new Response(cappedBody(chunks(3, 4), 12)).arrayBuffer()).byteLength, 12);
    await assert.rejects(new Response(cappedBody(chunks(3, 4), 11)).arrayBuffer(), /over/);
    let cancelled = false;
    const stuck = new ReadableStream({ pull: () => new Promise(() => {}), cancel() { cancelled = true; } });
    await assert.rejects(new Response(cappedBody(stuck, 100, 50)).arrayBuffer(), /longer than/);
    assert.ok(cancelled, "the upstream body is cancelled when the time runs out");
  } finally { inner.close(); }

  // node.mjs itself, as the audit found it: /api/fetch on its own port, localhost and the decimal form, refused
  const free = http.createServer();
  await new Promise((ok) => free.listen(0, "127.0.0.1", ok));
  const port = free.address().port;
  await new Promise((ok) => free.close(ok));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./node.mjs", import.meta.url))],
    { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", REVIEWS_DB: "off" }, stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise((ok, no) => {
      const deadline = setTimeout(() => no(new Error("node.mjs didn't start in 15 s")), 15000);
      child.stdout.on("data", (d) => { if (String(d).includes("ifizbox:")) { clearTimeout(deadline); ok(); } });
      child.on("exit", (c) => { clearTimeout(deadline); no(new Error(`node.mjs exited ${c}`)); });
    });
    for (const u of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://2130706433:${port}/`, `http://[::1]:${port}/`]) {
      const r = await fetch(`http://127.0.0.1:${port}/api/fetch?url=${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(15000) });
      assert.equal(r.status, 403, u);
      assert.equal((await r.json()).code, "refused", u);
    }
  } finally { child.kill(); }
  console.log("worker ssrf: ok");
}
{ // F312: per-address limits on /api/fetch, /sign/host and /sign/upload (src/limits.js)
  const { ROUTE_LIMITS, rateOf } = await import("./src/limits.js");
  const lenv = { ...env, FETCH_RATE: undefined, HOST_RATE: undefined, UPLOAD_RATE: undefined };
  const call = (path, ip, init = {}, e = lenv) => w.fetch(new Request("https://sign.example" + path,
    { ...init, headers: { ...(init.headers ?? {}), "CF-Connecting-IP": ip } }), e);
  const fetchPath = "/api/fetch?url=" + encodeURIComponent("http://127.0.0.1/"); // refused (403) before any fetch
  const hostInit = () => ({ method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "Content-Length": "3" } });
  const uploadPath = "/sign/upload?bundleid=com.a.b&version=1&title=A&size=100";
  assert.deepEqual([rateOf(lenv, "fetch"), rateOf(lenv, "host"), rateOf(lenv, "upload")], [300, 10, 12]);
  assert.equal(rateOf({ HOST_RATE: "3" }, "host"), 3);
  assert.equal(rateOf({ HOST_RATE: "x" }, "host"), 10);
  // the Nth request in a minute gets 429, per route and per address, defaults as shipped
  for (const [route, path, init] of [["fetch", fetchPath, () => ({})], ["host", "/sign/host?bundleid=com.ryha.ifizbox&version=1&title=X", hostInit],
    ["upload", uploadPath, () => ({ method: "POST" })]]) {
    const n = ROUTE_LIMITS[route].rate, ip = `198.51.100.${n}`;
    for (let i = 0; i < n; i++) assert.notEqual((await call(path, ip, init())).status, 429, `${route} #${i + 1}`);
    const r = await call(path, ip, init());
    assert.equal(r.status, 429, `${route} #${n + 1}`);
    assert.equal(r.headers.get("Retry-After"), "60");
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "*", "the website can read the 429");
    assert.equal((await r.json()).code, "rate_limited");
    assert.notEqual((await call(path, "203.0.113.9", init())).status, 429, `${route}: another address has its own count`);
  }
  // upload parts aren't counted: an install of a big app sends many
  const big = await (await call("/sign/upload?bundleid=com.a.b&version=1&title=A&size=100", "192.0.2.77", { method: "POST" }, { ...lenv, UPLOAD_RATE: "1" })).json();
  for (let i = 0; i < 3; i++) assert.notEqual((await call(`/sign/upload/${big.token}/0`, "192.0.2.77", { method: "PUT", body: new Uint8Array(5) }, { ...lenv, UPLOAD_RATE: "1" })).status, 429);
  assert.equal((await call(uploadPath, "192.0.2.77", { method: "POST" }, { ...lenv, UPLOAD_RATE: "1" })).status, 429);
  // "0": no limit
  for (let i = 0; i < 15; i++) assert.notEqual((await call(uploadPath, "192.0.2.78", { method: "POST" }, { ...lenv, UPLOAD_RATE: "0" })).status, 429);
  // the binding counts when bound (across isolates), keyed by route and address; a binding that throws falls back to memory
  const keys = [];
  const rl = (n) => { const used = new Map(); return { async limit({ key }) { keys.push(key); const k = used.get(key) ?? 0; used.set(key, k + 1); return { success: k < n }; } }; };
  const benv = { ...lenv, HOST_RATE_LIMIT: rl(2) };
  const hostPath = "/sign/host?bundleid=com.ryha.ifizbox&version=1&title=X";
  assert.deepEqual([(await call(hostPath, "192.0.2.5", hostInit(), benv)).status, (await call(hostPath, "192.0.2.5", hostInit(), benv)).status,
    (await call(hostPath, "192.0.2.5", hostInit(), benv)).status].map((s) => s === 429), [false, false, true]);
  assert.equal(keys[0], "host:192.0.2.5");
  const broken = { ...lenv, HOST_RATE: "1", HOST_RATE_LIMIT: { async limit() { throw new Error("down"); } } };
  assert.notEqual((await call(hostPath, "192.0.2.6", hostInit(), broken)).status, 429);
  assert.equal((await call(hostPath, "192.0.2.6", hostInit(), broken)).status, 429);
  // other routes have none of these limits
  for (let i = 0; i < 20; i++) assert.notEqual((await call("/sign/status", "192.0.2.7", {}, { ...lenv, HOST_RATE: "1", UPLOAD_RATE: "1", FETCH_RATE: "1" })).status, 429);

  // node.mjs: the same limits in memory, counted by the socket's address, never by a header the visitor sends
  const free = http.createServer();
  await new Promise((ok) => free.listen(0, "127.0.0.1", ok));
  const port = free.address().port;
  await new Promise((ok) => free.close(ok));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./node.mjs", import.meta.url))],
    { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", REVIEWS_DB: "off", FETCH_RATE: "3", UPLOAD_RATE: "2" }, stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise((ok, no) => {
      const deadline = setTimeout(() => no(new Error("node.mjs didn't start in 15 s")), 15000);
      child.stdout.on("data", (d) => { if (String(d).includes("ifizbox:")) { clearTimeout(deadline); ok(); } });
      child.on("exit", (c) => { clearTimeout(deadline); no(new Error(`node.mjs exited ${c}`)); });
    });
    const get = (path, headers = {}, method = "GET") => fetch(`http://127.0.0.1:${port}${path}`, { method, headers, signal: AbortSignal.timeout(15000) });
    // a proxy on this machine: its X-Forwarded-For entry (the last) is the address
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await get(fetchPath, { "X-Forwarded-For": `10.0.0.${i}, 198.51.100.40` })).status);
    assert.deepEqual(statuses.map((s) => s === 429), [false, false, false, true]);
    assert.notEqual((await get(fetchPath, { "X-Forwarded-For": "198.51.100.41" })).status, 429, "another address behind the proxy");
    // a spoofed CF-Connecting-IP picks no new bucket
    const up = [];
    for (let i = 0; i < 3; i++) up.push((await get(uploadPath, { "CF-Connecting-IP": `192.0.2.${100 + i}` }, "POST")).status);
    assert.deepEqual(up.map((s) => s === 429), [false, false, true]);
  } finally { child.kill(); }
  console.log("worker limits: ok");
}
{ // node.mjs: static files stay inside WEB (not a sibling folder sharing its prefix), X-Forwarded-Host only with TRUST_PROXY=1
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: pjoin } = await import("node:path");
  const httpReq = (port, path, headers = {}) => new Promise((ok, no) => {
    const q = http.request({ host: "127.0.0.1", port, path, headers, timeout: 15000 }, (r) => {
      let b = ""; r.setEncoding("utf8"); r.on("data", (d) => { b += d; }); r.on("end", () => ok({ status: r.statusCode, body: b, location: r.headers.location }));
    });
    q.on("timeout", () => q.destroy(new Error("timeout"))); q.on("error", no); q.end();
  });
  const root = await mkdtemp(pjoin(tmpdir(), "ifizbox-node-"));
  await mkdir(pjoin(root, "site")); await mkdir(pjoin(root, "site-secret"));
  await writeFile(pjoin(root, "site", "index.html"), "home");
  await writeFile(pjoin(root, "site-secret", "secret.txt"), "SECRET");
  const start = async (extra) => {
    const free = http.createServer();
    await new Promise((ok) => free.listen(0, "127.0.0.1", ok));
    const port = free.address().port;
    await new Promise((ok) => free.close(ok));
    const child = spawn(process.execPath, [fileURLToPath(new URL("./node.mjs", import.meta.url))],
      { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", REVIEWS_DB: "off", WEB: pjoin(root, "site"), TRUST_PROXY: "", ...extra }, stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((ok, no) => {
      const deadline = setTimeout(() => no(new Error("node.mjs didn't start in 15 s")), 15000);
      child.stdout.on("data", (d) => { if (String(d).includes("ifizbox:")) { clearTimeout(deadline); ok(); } });
      child.on("exit", (c) => { clearTimeout(deadline); no(new Error(`node.mjs exited ${c}`)); });
    });
    return { port, child };
  };
  let s = await start({});
  try {
    assert.equal((await httpReq(s.port, "/")).body, "home");
    for (const p of ["/../site-secret/secret.txt", "/..%2fsite-secret/secret.txt", "/%2e%2e/site-secret/secret.txt", "/..%5csite-secret%5csecret.txt"]) {
      const r = await httpReq(s.port, p);
      assert.ok(!r.body.includes("SECRET"), `${p} reached the sibling folder`);
    }
    // a spoofed X-Forwarded-Host doesn't move the repo page's addresses (nor the install manifests')
    const r = await httpReq(s.port, "/repo/", { "X-Forwarded-Host": "evil.example" });
    assert.ok(r.body.includes(`http://127.0.0.1:${s.port}/repo/source.json`), r.body);
    assert.ok(!r.body.includes("evil.example"), r.body);
    assert.ok(!String((await httpReq(s.port, "/repo", { "X-Forwarded-Host": "evil.example" })).location).includes("evil.example"));
  } finally { s.child.kill(); }
  s = await start({ TRUST_PROXY: "1" });
  try {
    const r = await httpReq(s.port, "/repo/", { "X-Forwarded-Host": "box.example.ts.net", "X-Forwarded-Proto": "https" });
    assert.ok(r.body.includes("https://box.example.ts.net/repo/source.json"), r.body);
  } finally { s.child.kill(); await rm(root, { recursive: true, force: true }); }
  console.log("worker node static/host: ok");
}
