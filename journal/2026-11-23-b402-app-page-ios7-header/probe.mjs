// B402 probe: the app page header and the nav toggles in every style, 375 pt. node probe.mjs [outdir]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)); const ROOT = resolve(join(here, "../../web/app")); const CHROME = "chromium"; const OUT = process.argv[2];
// --- static server ---------------------------------------------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; } // the site's Worker isn't here
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// --- Chromium over CDP ---------------------------------------------------------------------------------------------
const prof = await mkdtemp(join(tmpdir(), "ifizbox-smoke-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
let chromeFailed = null;
chrome.on("error", (e) => { chromeFailed = e; });
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bail = async (code, msg) => { console.error(msg); await cleanup(); process.exit(code); };

let ws;
for (let i = 0; i < 75 && !ws && !chromeFailed; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = list.find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
if (!ws) await bail(2, `smoke: couldn't start ${CHROME}${chromeFailed ? `: ${chromeFailed.message}` : ""} (set CHROMIUM=<path>)`);

let nextId = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++nextId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
};
await send("Page.enable"); await send("Runtime.enable");
for (const width of [375, 320]) for (const style of ["ios6", "ios7", "ios13", "ios26"]) for (const tone of ["light", "dark"]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 667, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
  const { result } = await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.ifizboxNative={jailbreak:"rootless",mode:"jailbreak",call:async(m)=>m==="app.info"?{ios:"26.0",systemVersion:"26.0"}:null};
    try{localStorage.setItem("ifizbox.style","${style}");localStorage.setItem("ifizbox.appearance","${tone}")}catch{}` });
  await send("Page.navigate", { url: base + "#/home" });
  await sleep(1800);
  const got = await ev(`(async () => {
    document.documentElement.dataset.style = "${style}"; document.documentElement.dataset.theme = "${tone}";
    const { storeHeader } = await import("./screens/storepage.js"); const { shareHeadButton } = await import("./screens/handoff.js");
    const { queueToggle, markToggle } = await import("./screens/altstore.js");
    const pkg = { key: "x", row: { id: "com.x" }, stanza: { ipa: { name: "RyukGram (iOS 15)", bundleIdentifier: "com.x", versions: [] } } };
    const q = (on) => queueToggle(pkg, null, { queue: { get: () => on, clear() {}, add() {} } });
    const art = document.createElement("span"); art.className = "pkg-icon large"; art.innerHTML = '<span class="pkg-letter">R</span>';
    const h = storeHeader({ art, name: "RyukGram (iOS 15)", author: "Ryuk", line: "1.2.3 (440) · 312.4 MB · Free", action: shareHeadButton(() => {}) });
    const before = () => h.head.getBoundingClientRect().height;
    const body = document.querySelector(".nav-stack.is-active .page-body, .page-body"); body.replaceChildren(h.head);
    const right = document.querySelector(".nav-stack.is-active .nav-item.is-top .nav-right, .nav-right");
    const inst = document.createElement("button"); inst.className = "bar-button"; inst.textContent = "Install";
    const mk = (on) => { const m = markToggle(pkg.stanza.ipa, pkg, null, { store: { all: async () => [] }, signedOf: async () => null }); if (on) setTimeout(() => m.classList.add("is-marked"), 200); return m; };
    const toggles = [q(false), q(true), mk(false), mk(true)];
    right.replaceChildren(...toggles, inst); right.parentElement.style.cssText += ";visibility:visible";
    document.querySelectorAll(".banner").forEach((b) => b.remove());
    const h0 = before();
    h.setRating({ average: 4.7, count: 29740392, onAppStore: true });
    await new Promise((r) => setTimeout(r, 500));
    const R = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((x) => Math.round(x * 10) / 10).join(","); };
    const c = h.head.querySelector(".store-head-count"), s = h.head.querySelector(".store-head-share");
    const g = document.createRange(); g.selectNodeContents(c);
    const cs = getComputedStyle(toggles[0], "::before");
    return JSON.stringify({ h0, h1: before(), count: [...g.getClientRects()].map((r) => [r.left, r.top, r.right, r.bottom].map(Math.round).join()), share: R(s), head: R(h.head), line: R(h.head.querySelector(".store-head-line")), gl: [cs.backgroundColor, cs.filter, cs.maskImage.slice(0, 12)] });
  })()`);
  console.log(width, style, tone, got);
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height: 220, scale: 1 } });
  if (OUT) { await mkdir(OUT, { recursive: true }); await writeFile(join(OUT, `${width}-${style}-${tone}.png`), Buffer.from(r.result.data, "base64")); }
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: result.identifier });
}
await cleanup(); process.exit(0);
