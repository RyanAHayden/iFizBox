// The showcase video's captures (marketing/video/make.sh runs it): web/app at an iPhone's 402x874 CSS px, DPR from
// $DPR (2), its safe areas (62 top, 34 bottom), mobile, iPhone UA, in headless Chromium over CDP. Grown from the
// README shots' capture.mjs (journal/2026-11-18-t12-readme-shots) and B129/B137's copies; touches no phone.
//
//   node capture.mjs <base url> <outdir> <script.json> [--native <state dir> | --mode sideload]
//
// script: [{ "nav": "#/x", "ms": 4000 } | { "go": "#/x" } | { "wait": ms } | { "shot": "name" } | { "eval": "js" } |
//          { "click": "css" } | { "clicktext": "text" } | { "touch": [[x, y], …], "frames": "name", "after": n }]
//
// --native renders web/app as the jailbreak app: a fake `ifizboxNative` (native/bridge.js's shape) is put in place
// before any module runs, and its calls are answered here in Node, like the Swift shell does (native/Sources/Apt.swift):
// apt.* from the made-up apt state in <state dir> (make_state.py: etc/apt/sources.list.d, var/lib/dpkg/status;
// apt's lists stay empty, so every source is read from the network through net.packages), net.* from the network,
// helper.run faked (update does nothing; simulate answers apt-get -s's plan). --mode sideload is the Lite build: a
// certificate, three signed apps, This iPhone paired (made-up names). APP_VERSION: the app's version (app.info);
// PUSH_ON=1: the signing server says it can push. Anything else answers null (logged).
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { NAME, BUNDLE_ID } from "../../web/app/brand.js";

const args = process.argv.slice(2);
const ni = args.indexOf("--native");
const phone = ni >= 0 ? args.splice(ni, 2)[1] : null;
const mi = args.indexOf("--mode"); // --mode sideload: the fake shell as the sideload app (no phone dir needed)
const mode = mi >= 0 ? args.splice(mi, 2)[1] : "jailbreak";
const bridged = Boolean(phone) || mi >= 0;
const [base, outdir, scriptFile] = args;
const steps = JSON.parse(await readFile(scriptFile, "utf8"));
const prof = await mkdtemp(join(process.cwd(), "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); cleanup(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const days = (n) => new Date(Date.now() + n * 86400e3).toISOString();
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
const handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };

// ---- the fake shell
const BRIDGE = () => `const MODE = ${JSON.stringify(mode)};(() => {
  const waiting = new Map(), streams = new Map(); let next = 1;
  globalThis.__natReply = (id, ok, value) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); streams.delete(id);
    if (ok) w.res(value === undefined ? null : value); else { const m = /^([a-z_]+): ([\\s\\S]*)$/.exec(value); const e = new Error(m ? m[2] : value); if (m) e.code = m[1]; w.rej(e); } };
  const call = (method, params, onEvent) => new Promise((res, rej) => { const id = next++; waiting.set(id, { res, rej });
    if (onEvent) streams.set(id, onEvent); globalThis.__nat(JSON.stringify({ id, method, params: params || {}, stream: Boolean(onEvent) })); });
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { call, jailbreak: MODE === "jailbreak" ? "rootless" : null, mode: MODE,
    emit(id, events) { const f = streams.get(id); if (f) for (const e of events) { try { f(e); } catch (x) { console.error(x); } } },
    helper: (words, onEvent) => call("helper.run", { words: [...words].map(String), stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: () => call("apt.dpkgStatus") };
})();`;

const readText = async (p) => { try { return await readFile(p, "utf8"); } catch { return null; } };
const b64 = (buf) => Buffer.from(buf).toString("base64");
async function get(url) {
  const r = await fetch(url, { redirect: "follow", headers: { "user-agent": `${NAME}/${process.env.APP_VERSION || "0.9.8"}` }, signal: AbortSignal.timeout(30000) });
  return { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) };
}
function unxz(buf) {
  return new Promise((res, rej) => {
    const p = spawn("xz", ["-dc"]); const out = [];
    p.stdout.on("data", (d) => out.push(d)); p.on("close", (c) => (c ? rej(new Error("xz " + c)) : res(Buffer.concat(out))));
    p.stdin.end(buf);
  });
}
// ifizbox-helper, faked: update does nothing (apt's lists stay empty, so every source comes from the network), and
// simulate answers apt-get -s's plan for the words (core/queue.js parseSimulation reads it) from the versions in
// dpkg's status and the Packages the page fetched. Nothing else is run.
const newest = new Map(); // package -> newest version seen in a fetched Packages
const vcmp = (a, b) => a.localeCompare(b, "en", { numeric: true });
function notePackages(text) {
  for (const s of text.split("\n\n")) {
    const id = /^Package: (.+)$/m.exec(s)?.[1], v = /^Version: (.+)$/m.exec(s)?.[1];
    if (id && v && (!newest.has(id) || vcmp(v, newest.get(id)) > 0)) newest.set(id, v);
  }
}
async function installedVersions() {
  const t = (await readText(apt("var/lib/dpkg/status"))) ?? "";
  return new Map(t.split("\n\n").map((s) => [/^Package: (.+)$/m.exec(s)?.[1], /^Version: (.+)$/m.exec(s)?.[1]]).filter((x) => x[0]));
}
async function helperRun(words) {
  const [verb, ...items] = words;
  if (verb !== "simulate") return { code: 0, stdout: "", stderr: "" };
  const have = await installedVersions(); const out = [];
  for (const w of items) {
    if (w.startsWith("-")) { const id = w.slice(1); out.push(`Remv ${id} [${have.get(id) ?? "1.0"}]`); continue; }
    const [id, v] = w.split("="); const to = v || newest.get(id) || "1.0";
    out.push(have.has(id) ? `Inst ${id} [${have.get(id)}] (${to} Repo [iphoneos-arm64])` : `Inst ${id} (${to} Repo [iphoneos-arm64])`);
  }
  out.push("Need to get 1,284 kB of archives.");
  return { code: 0, stdout: out.join("\n") + "\n", stderr: "" };
}
const apt = (p) => join(phone ?? "", p);
const native = {
  async "apt.sources"() {
    const d = "etc/apt/sources.list.d"; const out = [];
    for (const n of (await readdir(apt(d))).sort()) if (/\.(list|sources)$/.test(n)) out.push({ path: "/var/jb/" + d + "/" + n, text: await readText(apt(d + "/" + n)) });
    return out;
  },
  "apt.list": ({ name }) => readText(apt("var/lib/apt/lists/" + name)),
  "apt.dpkgStatus": () => readText(apt("var/lib/dpkg/status")),
  "apt.installDates": () => ({}),
  async "apt.autoInstalled"() {
    const t = await readText(apt("var/lib/apt/extended_states")); if (!t) return null;
    return t.split("\n\n").map((s) => [/^Package:\s*(.+)$/m.exec(s)?.[1], /^Auto-Installed:\s*1/m.test(s)]).filter((x) => x[0] && x[1]).map((x) => x[0]).sort();
  },
  "malware.scan": () => ({ packages: [], files: [] }),
  async "net.fetch"({ url }) { const r = await get(url); return { status: r.status, headers: r.headers, body: b64(r.body) }; },
  async "net.icon"({ url }) {
    const r = await get(url); if (r.status === 404 || r.status === 410) throw "not_found: HTTP " + r.status;
    if (r.status >= 300) throw "upstream: the repo answered HTTP " + r.status;
    const b = r.body; const type = b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : null;
    if (!type) throw "upstream: not a PNG or JPEG"; return { type, body: b64(b) };
  },
  async "net.packages"({ dir }) {
    for (const n of ["Packages.xz", "Packages.gz", "Packages"]) {
      try {
        const r = await get(dir + n); if (r.status >= 400) continue;
        const plain = n.endsWith(".xz") ? await unxz(r.body) : n.endsWith(".gz") ? gunzipSync(r.body) : r.body;
        const text = plain.toString("utf8"); notePackages(text);
        return { text, source: dir + n };
      } catch {}
    }
    throw "not_found: no Packages index in " + dir;
  },
  "helper.run": ({ words }) => helperRun(words),
  // B137: the sideload shell's sign-ahead calls. idevice.status answers after ROUTE_MS (the window where the row used
  // to say Tap Install on the This iPhone route); signing.open sends {phase: copying | installing} as SignAhead.swift does.
  async "signing.prepare"({ url }, emit) {
    for (const f of [0.3, 1]) { emit?.([{ phase: "downloading", progress: f }]); await sleep(300); }
    for (const f of [0.5, 1]) { emit?.([{ phase: "signing", progress: f }]); await sleep(300); }
    const id = /\/(\w+)\.ipa/.exec(url)?.[1] ?? "x";
    return { token: "t-" + id, bundleId: "com.example." + id, name: id, version: "1.0" };
  },
  async "idevice.status"() { await sleep(Number(process.env.ROUTE_MS || 3000)); return { paired: "rp", vpn: { available: true, tested: true } }; },
  async "signing.open"({ token }, emit) {
    for (const f of [0, 0.5, 1]) { emit?.([{ phase: "copying", progress: f }]); await sleep(1000); }
    for (const f of [0.4, 1]) { emit?.([{ phase: "installing", progress: f }]); await sleep(1000); }
    return { installed: true, bundleId: "com.example." + token.slice(2), name: token.slice(2) };
  },
  "signing.cancel": () => null,
  // The showcase's sideload phone: a certificate and profile imported, three signed apps (one due soon), paired for
  // This iPhone, push allowed. Made-up names; the shapes are core/signing.js deviceSummary's and signedAppRows'.
  "signing.status": () => ({ mode: "sideload", identity: {
    name: "Apple Development: Demo Team (DEMO123456)", team: "DEMO123456", expires: days(300),
    profile: { name: "Demo Wildcard", team: "Demo Team", appId: "DEMO123456.*", devices: 3, wildcard: true, expires: days(300), device: { listed: true } } } }),
  "signing.installed": () => ({ apps: [
    { name: "Provenance", bundleId: "com.provenance-emu.provenance", version: "3.3.0", expires: days(3.5) },
    { name: "iTorrent", bundleId: "com.xitrix.iTorrent2", version: "2.2.0", expires: days(41) },
    { name: "Flycast", bundleId: "com.chachirie.FlycastiOS", version: "1.0", expires: days(41) },
  ] }),
  "signing.checkCertificate": () => ({ status: "good" }),
  "signing.remind": () => ({ ok: true }),
  "push.status": () => ({ mode: "sideload", bundleId: BUNDLE_ID, environment: "production", authorization: "authorized" }),
  "push.register": () => ({ token: "00".repeat(32) }),
  "idevice.pairing": () => ({ paired: "rp" }),
  "app.notifyStatus": () => ({ backgroundOn: true, badges: true, alerts: true, backgroundRefresh: true, lastCheck: new Date(Date.now() - 42 * 60e3).toISOString() }),
  "updates.watch": () => ({ ok: true }),
  "apps.isInstalled": ({ bundleIds }) => ({ installed: Object.fromEntries((bundleIds || []).map((b) => [b, (process.env.INSTALLED || "").split(",").includes(b)])) }), // B129: INSTALLED=id,id
  "app.info": () => ({ version: process.env.APP_VERSION || "0.9.8", build: process.env.APP_BUILD || "", ios: "15.8.8", jailbreak: "rootless",
    mode: "jailbreak", machine: "iPhone9,1", cf: 1856.105, markers: [] }),
};
const unknown = new Set();
if (bridged) {
  handlers.push(async (m) => {
    if (m.method !== "Runtime.bindingCalled" || m.params.name !== "__nat") return;
    const { id: cid, method, params, stream } = JSON.parse(m.params.payload);
    const emit = stream ? (evs) => send("Runtime.evaluate", { expression: `ifizboxNative.emit(${cid}, ${JSON.stringify(evs)})` }) : null;
    let ok = true, value = null;
    try {
      const h = native[method];
      if (h) value = await h(params, emit); else if (!unknown.has(method)) { unknown.add(method); console.log("native: no fake for", method, JSON.stringify(params).slice(0, 200)); }
    } catch (e) { ok = false; value = typeof e === "string" ? e : "network: " + (e?.message || e); console.log("native:", method, value); }
    await send("Runtime.evaluate", { expression: `__natReply(${cid}, ${ok}, ${JSON.stringify(value ?? null)})` });
  });
}

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: Number(process.env.DPR || 2), mobile: true });
const sa = await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 62, bottom: 34, left: 0, right: 0 } });
if (sa.error) console.log("safe area override:", sa.error.message);
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
handlers.push((m) => { if (m.method === "Runtime.exceptionThrown") console.log("page exception:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]); });
if (bridged) {
  await send("Runtime.addBinding", { name: "__nat" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE() });
}
// B129: REDUCE=1 emulates iOS's Reduce Motion (prefers-reduced-motion: reduce).
if (process.env.REDUCE) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
// PUSH_ON=1: the signing server's GET /api/push says it can push (as it will once it has an APNs key; core/push.js),
// and registering answers OK, so Settings > Updates shows Push on.
if (process.env.PUSH_ON) await send("Page.addScriptToEvaluateOnNewDocument", { source: `{ const f = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (u, o) => { const s = String(u?.url ?? u);
    if (/\\/api\\/push$/.test(s)) return Promise.resolve(new Response('{"enabled":true,"topics":["${BUNDLE_ID}"]}', { headers: { "content-type": "application/json" } }));
    if (/\\/api\\/push\\/status$/.test(s)) return Promise.resolve(new Response(JSON.stringify({ registered: true, lastPush: new Date(Date.now() - 2 * 3600e3).toISOString() }), { headers: { "content-type": "application/json" } }));
    if (/\\/api\\/push\\/(register|test)$/.test(s)) return Promise.resolve(new Response('{"ok":true}', { headers: { "content-type": "application/json" } }));
    return f(u, o); }; }` });
// B129: record every Web Animation (the swipe hint is one: rowswipe.js playHint) with its row's text.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.__anims = []; { const a = Element.prototype.animate;
  Element.prototype.animate = function (k, o) { try { const row = this.closest?.(".pkg-row"); __anims.push({ at: location.hash, cls: String(this.className).slice(0, 60), row: row ? row.textContent.trim().slice(0, 40) : null, k: JSON.stringify(k).slice(0, 120) }); } catch {} return a.call(this, k, o); }; }` });
await send("Page.navigate", { url: base });
await sleep(3000);
for (const s of steps) {
  if (s.nav !== undefined) { await send("Page.navigate", { url: base + "?r=" + (++id) + s.nav }); await sleep(s.ms ?? 4000); }
  else if (s.go !== undefined) { await ev(`location.hash = ${JSON.stringify(s.go)}`); await sleep(s.ms ?? 1500); }
  else if (s.wait) await sleep(s.wait);
  else if (s.eval) console.log("eval:", String(JSON.stringify(await ev(s.eval))).slice(0, 3000));
  else if (s.click) { console.log("click", s.click, await ev(`(()=>{const e=document.querySelector(${JSON.stringify(s.click)}); if(!e) return 'none'; e.click(); return 'ok'})()`)); await sleep(s.ms ?? 1500); }
  else if (s.clicktext) {
    console.log("clicktext", s.clicktext, await ev(`(()=>{const all=[...document.querySelectorAll('a,button,li,[role=button],.row,div,span,label')].filter(e=>e.offsetParent!==null&&e.textContent.trim()===${JSON.stringify(s.clicktext)}); const e=all.at(-1); if(!e) return 'none'; e.click(); return 'ok '+e.tagName+'.'+e.className})()`));
    await sleep(s.ms ?? 1500);
  }
  else if (s.rect) {
    const r = await ev(`(()=>{const out={};for(const [k,q] of Object.entries(${JSON.stringify(s.sel)})){
      let e = q.startsWith("text:") ? [...document.querySelectorAll(".page.is-top li, .page.is-top .group, .page.is-top h3, .page.is-top p, body *")].filter(x=>x.offsetParent!==null&&x.textContent.trim()===q.slice(5)).at(-1) : document.querySelector(q);
      if (e && ${JSON.stringify(s.up ?? "")}) e = e.closest(${JSON.stringify(s.up || "*")}) ?? e;
      if (e) { const b = e.getBoundingClientRect(); out[k] = [b.left, b.top, b.right, b.bottom]; } }
      return out})()`);
    console.log("rect", s.rect, JSON.stringify(r)); await writeFile(join(outdir, s.rect + ".json"), JSON.stringify(r));
  }
  else if (s.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(outdir, s.shot + ".png"), Buffer.from(r.result.data, "base64")); console.log("shot", s.shot); }
  // A finger: { "touch": [[x, y], ...], "frames": "name", "step": ms, "lift": true }: down at the first point, moved
  // through the rest (one point per `step` ms), a screenshot after each move as name-00.png… when `frames` is given,
  // lifted at the last point unless "lift": false.
  else if (s.touch) {
    const pt = ([x, y]) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(s.touch[0]) });
    for (const [i, p] of s.touch.slice(1).entries()) {
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(p) });
      await sleep(s.step ?? 16);
      if (s.frames) { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(outdir, `${s.frames}-${String(i).padStart(2, "0")}.png`), Buffer.from(r.result.data, "base64")); }
    }
    if (s.lift !== false) await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // `after`: that many more frames after the lift (the spring back), `step` ms apart, numbered on from the moves.
    for (let i = 0; s.frames && i < (s.after ?? 0); i++) {
      await sleep(s.step ?? 16);
      const r = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(outdir, `${s.frames}-${String(s.touch.length - 1 + i).padStart(2, "0")}.png`), Buffer.from(r.result.data, "base64"));
    }
    await sleep(s.ms ?? 1000);
    console.log("touch", s.touch.length, "points");
  }
}
ws.close(); cleanup();
await sleep(500);
await rm(prof, { recursive: true, force: true });
process.exit(0);
