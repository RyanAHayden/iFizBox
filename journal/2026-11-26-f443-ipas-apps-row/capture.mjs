// B369: F317's capture.mjs at 390x844 CSS px, DPR 3 (safe areas 47 top, 34 bottom),
// mobile, iPhone UA, in headless Chromium over CDP.
//
//   node capture.mjs <base url> <outdir> <script.json> [--native <phone dir>]
//
// script: [{ "nav": "#/x", "ms": 4000 } | { "wait": ms } | { "shot": "name" } | { "eval": "js" } |
//          { "click": "css" } | { "clicktext": "text" }]
//
// --native renders web/app as the jailbreak app: a fake `ifizboxNative` (native/bridge.js's shape) is put in place
// before any module runs, and its calls are answered here in Node, like the Swift shell does (native/Sources/Apt.swift):
// apt.* from a copy of the iPhone 7's apt state in <phone dir> (etc/apt/sources.list.d, var/lib/apt/lists,
// var/lib/dpkg/status, var/lib/apt/extended_states, pulled read-only with tar over ssh), net.* from the network,
// and helper.run's simulate/apply on the iPhone 7 itself (ssh 7, sudo -n, the apt-get command ifizbox-helper would
// run, stdout/stderr/status fd 3 kept apart), so an
// install shown in a screenshot is a real one. Anything else answers null (logged).
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

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
  // F285: the signing server's /api/push answered here (a server with its APNs key; the token registered).
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (url, init) => {
    const p = (() => { try { return new URL(String(url), location.href).pathname; } catch { return ""; } })();
    if (p === "/api/push") return Promise.resolve(Response.json({ enabled: true, reason: null, topics: ["com.ryha.ifizbox"] }));
    if (p === "/api/push/status") return Promise.resolve(Response.json({ registered: true, lastPush: new Date(Date.now() - 600e3).toISOString() }));
    if (p.startsWith("/api/push/")) return Promise.resolve(Response.json({ ok: true }));
    return realFetch(url, init);
  };
})();`;

const readText = async (p) => { try { return await readFile(p, "utf8"); } catch { return null; } };
const b64 = (buf) => Buffer.from(buf).toString("base64");
async function get(url) {
  const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "iFizBox/0.9.8" }, signal: AbortSignal.timeout(30000) });
  return { status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) };
}
function unxz(buf) {
  return new Promise((res, rej) => {
    const p = spawn("xz", ["-dc"]); const out = [];
    p.stdout.on("data", (d) => out.push(d)); p.on("close", (c) => (c ? rej(new Error("xz " + c)) : res(Buffer.concat(out))));
    p.stdin.end(buf);
  });
}
const sh1 = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
// ifizbox-helper only answers the installed app (it checks its caller), so the queue verbs run the apt-get command
// it builds (native/helper/policy.c queue_plan) instead; other verbs are refused here.
function aptWords(words) {
  const [verb, ...items] = words;
  if (!items.length || items.some((w) => !/^-?[a-z0-9][a-z0-9.+~:=-]*$/.test(w))) return null;
  const its = items.map((w) => (w.startsWith("-") ? w.slice(1) + "-" : w));
  const common = ["--reinstall", "--allow-downgrades", "--allow-unauthenticated"];
  if (verb === "simulate") return ["apt-get", "-s", ...common, "install", ...its];
  if (verb === "apply" || verb === "apply-ask")
    return ["apt-get", "-y", ...(verb === "apply" ? ["-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"] : []),
      ...common, "-o", "APT::Keep-Fds::=3", "-o", "APT::Status-Fd=3", "install", ...its];
  return null;
}
function helperRun(words, emit) {
  const apt = aptWords(words);
  if (!apt) return Promise.resolve({ code: 64, stdout: "", stderr: `ifizbox-helper: ${words[0]}: not run by the screenshot shell\n` });
  return new Promise((resolve) => {
    // fd 3 is apt's status: tag the three streams so they stay apart over one ssh pipe.
    const cmd = `CYDIA='3 1' /var/jb/usr/bin/${apt.map(sh1).join(" ")}`;
    const inner = `{ { { ${cmd} 3>&1 1>&4 2>&5 | sed -u 's/^/S:/' >&6; } 4>&1 | sed -u 's/^/O:/' >&6; } 5>&1 | sed -u 's/^/E:/' >&6; } 6>&1; echo "X:$?"`;
    const p = spawn("ssh", ["7", `sudo -n sh -c ${sh1(inner)}`]);
    const all = { out: [], err: [], status: [] }; let code = 0, pending = "";
    p.stdout.on("data", (d) => {
      pending += d; const lines = pending.split("\n"); pending = lines.pop();
      const evs = [];
      for (const l of lines) {
        const fd = { S: "status", O: "out", E: "err" }[l[0]];
        if (l.startsWith("X:")) code = Number(l.slice(2)); else if (fd) { all[fd].push(l.slice(2)); evs.push({ fd, line: l.slice(2) }); }
      }
      if (emit && evs.length) emit(evs);
    });
    p.stderr.on("data", (d) => process.stderr.write("[ssh] " + d));
    p.on("close", () => resolve({ code, stdout: all.out.join("\n") + (all.out.length ? "\n" : ""), stderr: all.err.join("\n") + (all.err.length ? "\n" : "") }));
  });
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
        return { text: plain.toString("utf8"), source: dir + n };
      } catch {}
    }
    throw "not_found: no Packages index in " + dir;
  },
  "helper.run": ({ words }, emit) => helperRun(words, emit),
  "apps.isInstalled": ({ bundleIds }) => ({ installed: Object.fromEntries((bundleIds || []).map((b) => [b, (process.env.INSTALLED || "").split(",").includes(b)])) }), // B129: INSTALLED=id,id
  "app.info": () => ({ version: process.env.APP_VERSION || "0.9.8", build: process.env.APP_BUILD || "", ios: "15.8.8", jailbreak: "rootless",
    mode: "jailbreak", machine: "iPhone9,1", cf: 1856.105, markers: [] }),
  // F285: the sideload app's Updates page (Notifications.swift app.notifyStatus / push.status, BackgroundCheck.swift)
  "app.notifyStatus": () => ({ status: "authorized", badges: true, alerts: true, backgroundRefresh: true, backgroundOn: true,
    lastCheck: new Date(Date.now() - 2 * 3600e3).toISOString(), ...JSON.parse(process.env.NOTIFY || "{}") }), // F311: NOTIFY='{"backgroundRefresh":false}'
  "push.status": () => ({ mode: "sideload", bundleId: "com.ryha.ifizbox", team: "ABCDE12345", environment: "production",
    authorization: "authorized", registered: true, version: "0.9.8", ios: "18.1" }),
  "push.register": () => ({ token: "ab".repeat(32) }),
  "updates.watch": () => ({ scheduled: true }),
  // F317: the pairing page: PAIR='{"paired":false,"pairOnPhone":false}' (idevice.status), VPN_APPS='{"localdevvpn":false,"tailscale":false}'
  "idevice.status": () => JSON.parse(process.env.PAIR || '{"paired":false}'),
  "idevice.vpnApps": () => JSON.parse(process.env.VPN_APPS || '{"localdevvpn":true,"tailscale":false}'),
  "idevice.developerMode": () => ({ enabled: true }),
  "tailscale.status": () => ({ signedIn: false, connect: "auto" }),
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
// B369: 390x844 (iPhone 12-14 size), its safe areas 47 top, 34 bottom
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
const sa = await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
if (sa.error) console.log("safe area override:", sa.error.message);
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
handlers.push((m) => { if (m.method === "Runtime.exceptionThrown") console.log("page exception:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]); });
if (bridged) {
  await send("Runtime.addBinding", { name: "__nat" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE() });
}
// F317: RELAY=1: the Worker's Apple relay answers on (GET /apple/status), so the website's Free Apple ID group shows.
if (process.env.RELAY) await send("Page.addScriptToEvaluateOnNewDocument", { source: `{ const f = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (u, i) => (String(u).endsWith("/apple/status") ? Promise.resolve(Response.json({ on: true })) : f(u, i)); }` });
// B129: REDUCE=1 emulates iOS's Reduce Motion (prefers-reduced-motion: reduce).
if (process.env.REDUCE) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
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
}
ws.close(); cleanup();
await sleep(500);
await rm(prof, { recursive: true, force: true });
process.exit(0);
