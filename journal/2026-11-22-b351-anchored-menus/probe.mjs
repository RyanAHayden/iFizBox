// B351 probe: web/app as the jailbreak app (fake bridge, every call null) in headless Chromium at 402x874@3x, iPhone
// UA (iOS 18, so no native controls hook: the CSS sheet). For each era it opens two button-opened sheets three times
// each, with real CDP taps on a nav bar button:
//   select: Installed's top-left button with installed.js selectButton (the Select… sheet, `from` the button)
//   modify: the same button opening a sheet with no `from` (as browse.js's Modify does: the source button is the
//           one the tap landed on)
// and records the sheet's final rect and class, plus 3x frames of the iOS 26 menu at 0, 60, 140 and 380 ms.
//
//   node probe.mjs <web/app dir> <out dir>
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";

const [rootArg, out] = process.argv.slice(2);
const ROOT = resolve(rootArg);
await mkdir(out, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const prof = await mkdtemp(join(tmpdir(), "b351-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
let n = 0; const pend = new Map(); const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(out, `${name}.png`), Buffer.from(r.result.data, "base64")); };
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, pointerType: "mouse" });
const tapAt = async ([x, y]) => { await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await sleep(60); await mouse("mouseReleased", x, y, 0); };

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.ifizboxNative = { jailbreak: "rootless", call: async () => null };` });

const results = {};
try {
  for (const style of ["ios26", "ios6", "ios7", "ios13"]) {
    await send("Page.navigate", { url: base + "#/installed" });
    await sleep(800);
    await ev(`localStorage.setItem("ifizbox.style", ${JSON.stringify(style)}); true`);
    await send("Page.reload");
    for (let i = 0; i < 60 && !(await ev("!!document.querySelector('#navbar .bar-button')").catch(() => false)); i++) await sleep(200);
    await sleep(1500);
    // The top-left nav bar button (Wish List; Select… while managing) opens the sheets under test.
    await ev(`(async () => {
      const b = [...document.querySelectorAll('#navbar .bar-button')].find((x) => x.getClientRects().length && x.getBoundingClientRect().left < 150);
      const inst = await import('./screens/installed.js');
      const sheets = await import('./nav/actionsheet.js');
      window.__b351 = { b, mode: 'select' };
      const view = { managing: true, manageRows: [], selected: new Set(), wish: b };
      b.addEventListener('click', (e) => {
        e.stopImmediatePropagation(); e.preventDefault();
        if (window.__b351.mode === 'select') inst.selectButton({ view, sync: () => {} });
        else sheets.showActionSheet({ title: '', buttons: ['Reinstall', 'Remove', 'Downgrade'], destructive: 1 });
      }, true);
      return true;
    })()`);
    const at = await ev(`(() => { const r = window.__b351.b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    results[style] = { button: await ev(`(() => { const r = window.__b351.b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); })()`) };
    for (const mode of ["select", "modify"]) {
      await ev(`window.__b351.mode = ${JSON.stringify(mode)}; true`);
      const opens = [];
      for (let k = 0; k < 3; k++) {
        await tapAt(at);
        await sleep(600);
        opens.push(await ev(`(() => { const s = document.querySelector('.action-sheet'); if (!s) return null; const r = s.getBoundingClientRect();
          return { cls: s.className, rect: [r.x, r.y, r.width, r.height].map(Math.round), buttons: [...s.querySelectorAll('.action-button')].map((b) => b.textContent) }; })()`));
        if (k === 0) await shot(`${style}-${mode}-open`);
        await ev(`(document.querySelector('.action-dim') || {}).click?.(); true`);
        await sleep(600);
      }
      results[style][mode] = opens;
      if (style === "ios26") { // frames of the grow, paused at fixed times
        await tapAt(at);
        await sleep(30);
        for (const t of [0, 60, 140, 380]) {
          await ev(`(() => { for (const a of document.getAnimations()) if (a.effect?.target?.closest?.('.action-scrim')) { a.pause(); a.currentTime = ${t}; } return true; })()`);
          await sleep(50);
          await shot(`${style}-${mode}-t${t}`);
        }
        await ev(`for (const a of document.getAnimations()) a.finish?.(); (document.querySelector('.action-dim') || {}).click?.(); true`);
        await sleep(600);
        // and dark
      }
    }
    if (style === "ios26") {
      await ev(`localStorage.setItem("ifizbox.appearance", "dark"); true`);
      await send("Page.reload");
      await sleep(2500);
    }
  }
  results.errors = errors;
  await writeFile(join(out, "results.json"), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
} finally {
  await cleanup();
}
