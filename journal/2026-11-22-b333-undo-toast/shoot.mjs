#!/usr/bin/env node
// B333: the undo bar in every era and tone, in headless Chromium (402x874 at 3x, the 18 Pro's safe areas, an iPhone
// UA) with a fake jailbreak shell: one apt source (repo.test) whose Packages list is a handful of tweaks. It opens the
// source's package list, swipes a row left with CDP mouse events (rowswipe.js takes pointer events) to queue it, and
// shoots the bottom of the screen while the bar shows.
//
//   node shoot.mjs [web/app dir] OUT_DIR [--only ios26-dark] [--dump]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const ONLY = opt("--only");
const DUMP = flag("--dump");
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(args.length > 1 ? args[0] : join(here, "../../web/app"));
const OUT = resolve(args.at(-1));
await mkdir(OUT, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
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

const PKGS = ["AppSync Unified", "Filza File Manager", "NewTerm 3", "Shadow", "Snowboard", "Velvet 2", "Watusi"]
  .map((name, i) => `Package: com.test.p${i}\nName: ${name}\nVersion: 1.${i}\nArchitecture: iphoneos-arm64\nSection: Tweaks\nDescription: Test package ${i}\nFilename: debs/p${i}.deb\nSize: 1000\nAuthor: Test <t@example.com>\nMaintainer: Test <t@example.com>\n`).join("\n");
const BOOT = (style, theme) => `(() => {
  try {
    localStorage.setItem("ifizbox.style", ${JSON.stringify(style)});
    localStorage.setItem("ifizbox.appearance", ${JSON.stringify(theme)});
    localStorage.setItem("ifizbox.swipeHint", "1"); localStorage.setItem("cydian.swipeHint", "1");
  } catch {}
  const PK = ${JSON.stringify(PKGS)};
  window.__calls = [];
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { jailbreak: "rootless", mode: "jailbreak", call(name, a) {
    window.__calls.push(name);
    if (name === "app.info") return Promise.resolve({ ios: "16.0" });
    if (name === "apt.sources") return Promise.resolve([{ path: "/var/jb/etc/apt/sources.list.d/test.list", text: "deb https://repo.test/ ./\\n" }]);
    if (name === "apt.list") {
      const n = String(a?.name ?? "");
      if (/Packages$/.test(n)) return Promise.resolve(PK);
      if (/Release$/.test(n)) return Promise.resolve("Origin: Test Repo\\nLabel: Test Repo\\nSuite: stable\\n");
      return Promise.resolve(null);
    }
    if (name === "apt.dpkgStatus") return Promise.resolve("");
    if (name.startsWith("net.")) return Promise.reject(new Error("not_found: offline"));
    return Promise.resolve(null);
  } };
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(style, theme) {
  const prof = await mkdtemp(join(tmpdir(), "ifizbox-b333-"));
  const port = 9400 + Math.floor(Math.random() * 500);
  const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  const done = async () => { try { chrome.kill(); } catch {} await rm(prof, { recursive: true, force: true }).catch(() => {}); };
  let ws;
  for (let i = 0; i < 75 && !ws; i++) {
    try {
      const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
      if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
    } catch { ws = null; }
    if (!ws) await sleep(200);
  }
  if (!ws) { await done(); throw new Error("chromium didn't start"); }
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++nextId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
  const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, pointerType: "mouse" });
  const centre = (css, text = "") => ev(`(() => {
    const e = [...document.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.getClientRects().length && x.textContent.includes(${JSON.stringify(text)})
      && !x.closest('.page:not(.is-top), [hidden], [aria-hidden=true]')).at(-1);
    if (!e) return null;
    e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })()`);
  const tap = async (css, text = "") => {
    const at = await centre(css, text);
    if (!at) return false;
    await sleep(150);
    await mouse("mouseMoved", at[0], at[1], 0);
    await mouse("mousePressed", at[0], at[1]);
    await sleep(60);
    await mouse("mouseReleased", at[0], at[1], 0);
    return true;
  };
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
    await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 62, bottom: 34, left: 0, right: 0 } }).catch(() => {});
    await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", platform: "iPhone" });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT(style, theme) });
    await send("Page.navigate", { url: base });
    await until("document.querySelector('.tabbar')");
    await sleep(800);
    if (!(await tap(".tab", "Sources"))) throw new Error("no Sources tab");
    await sleep(900);
    if (!(await tap(".page.is-top .cell, .page.is-top .cell-inner", "Test Repo")) && !(await tap(".cell", "repo.test"))) {
      if (DUMP) console.log(await ev("document.querySelector('.page.is-top')?.innerText"));
      throw new Error("no repo row");
    }
    await sleep(1200);
    if (!(await tap(".cell", "All Packages"))) throw new Error("no All Packages row");
    await sleep(1200);
    if (!(await until("document.querySelector('.pkg-row')", 6000))) {
      if (DUMP) {
        console.log(await ev("JSON.stringify({ hash: location.hash, calls: window.__calls, text: document.body.innerText.slice(0, 1500) })"));
        const s = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(OUT, "dump.png"), Buffer.from(s.result.data, "base64"));
      }
      throw new Error("no package rows");
    }
    // swipe the third row left, slowly, past the arm point
    const at = await centre(".pkg-row", "NewTerm");
    if (!at) throw new Error("no NewTerm row");
    await sleep(300);
    const [x0, y] = [at[0] + 120, at[1]];
    await mouse("mouseMoved", x0, y, 0);
    await mouse("mousePressed", x0, y);
    for (let i = 1; i <= 24; i++) { await mouse("mouseMoved", x0 - i * 12, y + (i % 2), 1); await sleep(16); }
    await sleep(80);
    await mouse("mouseReleased", x0 - 288, y, 0);
    if (!(await until("document.querySelector('.undo-bar.shown')", 4000))) {
      if (DUMP) console.log(await ev("JSON.stringify({ calls: window.__calls.slice(-20), html: document.body.className })"));
      throw new Error("no undo bar");
    }
    await sleep(600); // the slide in (.3 s) and the row's own slide back
    const name = `${style}-${theme}`;
    const info = await ev(`(() => { const b = document.querySelector('.undo-bar'); const r = b.getBoundingClientRect();
      return { text: b.innerText.replace(/\\n/g, ' | '), rect: [r.x, r.y, r.width, r.height].map(Math.round), bg: getComputedStyle(b).backgroundColor,
        radius: getComputedStyle(b).borderRadius, blur: getComputedStyle(b).backdropFilter }; })()`);
    const bottom = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 874 - 260, width: 402, height: 260, scale: 1 } });
    await writeFile(join(OUT, name + ".png"), Buffer.from(bottom.result.data, "base64"));
    const whole = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, name + "-full.png"), Buffer.from(whole.result.data, "base64"));
    console.log(name, JSON.stringify(info), errors.length ? "errors: " + errors.join("; ") : "");
  } finally {
    ws.close();
    await done();
  }
}

let failed = 0;
for (const style of ["ios6", "ios7", "ios13", "ios26"]) for (const theme of ["light", "dark"]) {
  if (ONLY && ONLY !== `${style}-${theme}`) continue;
  try { await run(style, theme); } catch (e) { failed++; console.error(`${style}-${theme}: ${e.message}`); }
}
server.close();
process.exit(failed ? 1 : 0);
