// local site (static web/app + the real Worker, KV in memory) driven in headless Chromium over CDP
import http from "node:http"; import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs"; import { spawn } from "node:child_process"; import { join, extname } from "node:path";
const R = "/home/ryha/runs/iFizBox/s2", out = process.argv[2];
const worker = (await import(R + "/worker/src/index.js")).default;
const { saveFreeIdentity, FREE_KEY } = await import(R + "/web/app/screens/free-apple-id.js");
const fx = (n) => new Uint8Array(readFileSync(`${R}/web/app/core/fixtures/signing/${n}`));
let free; saveFreeIdentity({ teamId: "TESTTEAM42", teamName: "Test Team", serial: "1", password: "hunter2", p12: fx("test.p12"), profile: fx("test.mobileprovision"), appId: "com.ryha.ifizbox.TESTTEAM42", expires: new Date("2027-11-01") }, { setItem: (k, v) => { free = v; } });
const kv = new Map();
const env = { TTL: "600", MAX_UPLOAD_MB: "512", APPLE_RELAY: "1", UPLOAD_RATE: "0", HOSTED: {
  put: async (k, v, o = {}) => { kv.set(k, { v: new Uint8Array(await new Response(v).arrayBuffer()), m: o.metadata ?? null }); }, get: async (k) => kv.get(k)?.v ?? null,
  getWithMetadata: async (k) => ({ value: kv.has(k) ? new Response(kv.get(k).v).body : null, metadata: kv.get(k)?.m ?? null }), delete: async (k) => kv.delete(k), list: async () => ({ keys: [] }) } };
const T = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer(async (q, s) => {
  const u = new URL(q.url, "http://127.0.0.1");
  if (u.pathname === "/api/fetch" && u.searchParams.get("kind") === "ipa") { const b = fx("tiny-ifizbox.ipa"); s.writeHead(200, { "x-ipa-length": b.length }); return s.end(b); }
  if (/^\/(sign|apple)\//.test(u.pathname)) {
    const ch = []; for await (const c of q) ch.push(c);
    const r = await worker.fetch(new Request(`http://127.0.0.1:${srv.address().port}${q.url}`, { method: q.method, headers: q.headers, ...(ch.length ? { body: Buffer.concat(ch) } : {}) }), env, { waitUntil() {} });
    console.log(q.method, u.pathname.slice(0, 30), r.status);
    s.writeHead(r.status, Object.fromEntries(r.headers)); return s.end(Buffer.from(await r.arrayBuffer()));
  }
  const f = join(R, "web/app", u.pathname === "/" ? "index.html" : u.pathname);
  if (!existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": T[extname(f)] ?? "application/octet-stream" }); s.end(readFileSync(f));
}).listen(0, "127.0.0.1"); await new Promise((r) => srv.once("listening", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const ch = spawn("chromium", ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(out + "/prof-")}`, "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const ws0 = await new Promise((r) => { let b = ""; ch.stderr.on("data", (d) => { b += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(b); if (m) r(m[1]); }); });
const tab = (await (await fetch(`http://127.0.0.1:${ws0}/json`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
let n = 0; const wait = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (wait.has(m.id)) { wait.get(m.id)(m.result ?? m); wait.delete(m.id); } else if (m.method === "Runtime.exceptionThrown") console.log("EXC", m.params.exceptionDetails.exception?.description); };
const cmd = (method, params = {}) => new Promise((r) => { wait.set(++n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await cmd("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (f) => { const r = await cmd("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}/${f}.png`, Buffer.from(r.data, "base64")); };
await cmd("Runtime.enable"); await cmd("Page.enable");
await cmd("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await cmd("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
// fixed clock: the fixture profile ends 2026-11-24
const skew = process.argv[3] === "expired" ? "" : "const D=Date;const off=new D('2026-11-21').getTime()-D.now();globalThis.Date=class extends D{constructor(...a){a.length?super(...a):super(D.now()+off)}static now(){return D.now()+off}};";
await cmd("Page.addScriptToEvaluateOnNewDocument", { source: `${skew}localStorage.setItem(${JSON.stringify(FREE_KEY)}, ${JSON.stringify(free)});localStorage.setItem("ifizbox.firstVisit","later");` });
await cmd("Page.navigate", { url: base + "/#/settings/signing" }); await sleep(4000);
const click = (re) => ev(`(()=>{const b=[...document.querySelectorAll('.page:not([hidden]) button, button, a')].find(x=>${re}.test(x.textContent.trim())&&x.offsetParent!==null);if(b){b.scrollIntoView({block:'center'});b.click();return b.textContent.trim()}return null})()`);
await ev("document.querySelector('.banner')?.remove()");
console.log(await click("/^(Not Now|Later)$/"), await click("/^Use a Free Apple ID/")); await sleep(900);
await ev("[...document.querySelectorAll('.free-computer')].at(-1)?.scrollIntoView({block:'center'})"); await sleep(400); await shot("1-" + (process.argv[3] ?? "ready"));
if (process.argv[3] !== "expired") {
  console.log(await click("/^Download for a Computer Install/"));
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ev("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Show Code')")) break; }
  await shot("2-progress"); console.log(await click("/^Show Code$/")); await sleep(1200);
  await ev("[...document.querySelectorAll('.free-computer')].at(-1)?.scrollIntoView({block:'center'})"); await sleep(400); await shot("3-code");
  console.log(await ev("[...document.querySelectorAll('.free-computer')].at(-1)?.innerText"));
  const up = [...kv].find(([k]) => /^up\.[0-9a-f]{48}$/.test(k)); console.log(up?.[1].m);
}
ch.kill(); srv.close(); process.exit(0);
