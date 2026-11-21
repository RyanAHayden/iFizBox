// B300 probe: web/app in headless Chromium as the sideload app; each way into Installation & Signing must slide.
// node probe.mjs [web/app dir]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? "web/app");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(path); res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const prof = await mkdtemp(join(tmpdir(), "b300-probe-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = list.find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
let nextId = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++nextId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value; };
// Each frame: the top page's title and its transform, so a push shows a translateX run from the right.
const REC = `(() => {
  const rec = window.__p = { frames: [] };
  const poll = () => {
    const top = document.querySelector('.nav-stack.is-active .page.is-top, .page.is-top');
    const all = [...document.querySelectorAll('.page.is-moving')].map((p) => ({ t: p.querySelector('.page-body') ? (p.dataset.title || p.getAttribute('aria-label') || '') : '', x: new DOMMatrixReadOnly(getComputedStyle(p).transform).m41 }));
    rec.frames.push({ hash: location.hash, moving: all });
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
})();`;
const BRIDGE = `window.ifizboxApp = true; window.ifizboxNative = { mode: "sideload", call: async (m) => m === "app.info" ? { version: "1.0", ios: "18.1", mode: "sideload", jailbreak: null } : null };`;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: REC + BRIDGE });
const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
const find = (css, text = "") => ev(`(() => {
  const e = [...document.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.offsetParent && x.getClientRects().length && x.textContent.includes(${JSON.stringify(text)})
    && !x.closest('.page:not(.is-top), [hidden], [aria-hidden=true]')).at(-1);
  if (!e) return null;
  e.scrollIntoView({ block: "center" });
  const r = e.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
})()`);
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, pointerType: "mouse" });
const tap = async (css, text = "") => {
  const at = await find(css, text); if (!at) return false;
  await sleep(150); await mouse("mouseMoved", at[0], at[1], 0); await mouse("mousePressed", at[0], at[1]); await sleep(60); await mouse("mouseReleased", at[0], at[1], 0);
  return true;
};
const results = [];
async function way(name, start, act) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  if (start.includes(">")) { // "#/home>a[href=…]": load the first, tap the link to get to the start
    const [first, sel] = start.split(">");
    await send("Page.navigate", { url: base + first });
    await until("document.querySelector('.page.is-top') && !document.getElementById('boot')", 15000);
    await sleep(1500);
    await tap(".page.is-top " + sel);
    await sleep(1500);
    start = null;
  }
  if (start) await send("Page.navigate", { url: base + start });
  await until("document.querySelector('.page.is-top') && !document.getElementById('boot')", 15000);
  await sleep(1500);
  await ev("window.__p.frames = []");
  const before = await ev("location.hash");
  const ok = await act();
  const shots = process.env.SHOTS;
  if (shots) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(shots, { recursive: true });
    for (let i = 0; i < 8; i++) {
      const s = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(shots, `${name.replace(/\W+/g, "-")}-${i}.png`), Buffer.from(s.result.data, "base64"));
      await sleep(40);
    }
  }
  await until(`location.hash !== ${JSON.stringify(before)}`, 3000);
  await sleep(1500);
  const r = await ev(`(() => { const f = window.__p.frames; const xs = f.flatMap((x) => x.moving.map((m) => Math.round(m.x))); return { hash: location.hash, frames: f.length, movingFrames: f.filter((x) => x.moving.length).length, xs: xs.slice(0, 12), title: document.querySelector('.nav-item.is-top .nav-title, .navbar .title, .nav-title')?.textContent }; })()`);
  results.push({ name, tapped: ok, from: before, ...r });
  console.log(JSON.stringify(results.at(-1)));
}
try {
  const args = process.argv.slice(3);
  const hrefTap = (h) => () => tap(`.page.is-top a[href="${h}"]`);
  await way("home tile (signing)", "#/home", hrefTap("#/home/settings/signing"));
  await way("settings row (signing)", "#/home/settings", hrefTap("#/home/settings/signing"));
  await way("home > settings row (signing)", "#/home>a[href=\"#/home/settings\"]", hrefTap("#/home/settings/signing"));
  await way("home > install IPAs tile > set up", "#/home>a[href=\"#/installed/myipas\"]", setUpLater);
  await way("installed tab > install IPAs > set up", "#/installed>a[href*=\"myipas\"]", setUpLater);
  await way("why > set up signing", "#/home>a[href=\"#/home/why\"]", hrefTap("#/home/settings/signing"));
  async function setUpLater() { return setUp()(); }
  function setUp() { return async () => {
    ev(`import('./signing/device.js').then((m) => m.firstInstallCheck({ native: { call: async () => null } }))`).catch(() => {});
    await until("[...document.querySelectorAll('button, .alert-button, a')].some(b => b.textContent.trim() === 'Set Up')", 5000);
    await sleep(500);
    const at = await ev(`(() => { const b = [...document.querySelectorAll('button, .alert-button, a')].filter(b => b.textContent.trim() === 'Set Up').at(-1); const r = b.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
    await ev("window.__p.frames = []");
    await mouse("mouseMoved", at[0], at[1], 0); await mouse("mousePressed", at[0], at[1]); await sleep(60); await mouse("mouseReleased", at[0], at[1], 0);
    return true;
  }; }
  await way("install redirect from installed/myipas", "#/installed/myipas", setUp());
  await way("install redirect from home/~installed/myipas", "#/home/~installed/myipas", setUp());
  await way("install redirect from home", "#/home", setUp());
  await way("install redirect from home/settings", "#/home/settings", setUp());
  await way("installApp from home", "#/home", async () => { ev(`import('./screens/home.js').then((m) => m.installApp({ ready: async () => false }))`).catch(() => {}); return true; });
  for (const a of args) { const [start, h] = a.split("=>"); await way(`custom ${a}`, start, hrefTap(h)); }
} finally {
  if (errors.length) console.log("errors:", errors);
  chrome.kill(); server.close(); await sleep(500); await rm(prof, { recursive: true, force: true }).catch(() => {});
}
