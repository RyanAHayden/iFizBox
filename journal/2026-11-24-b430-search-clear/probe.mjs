// B430: taps the search field's drawn x with CDP touch in every style, on each page with a search bar.
//   node journal/2026-11-24-b430-search-clear/probe.mjs [web/app dir] [route...]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";
const ROOT = resolve(process.argv[2] ?? "web/app");
const ROUTES = process.argv.length > 3 ? process.argv.slice(3) : ["search", "sources", "changes", "installed", "myipas"];
const CHROME = process.env.CHROMIUM ?? "chromium";
const MODE = process.env.MODE ?? "jailbreak";
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
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n  ${expr}`);
  return r.result?.result?.value;
};


await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.ifizboxNative = { ${MODE === "jailbreak" ? 'jailbreak: "rootless", ' : ""}call: async () => null };
  window.__t = []; document.addEventListener("click", (e) => __t.push(e.target.tagName + "." + e.target.className), true);` });
const touch = async (x, y) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await sleep(50);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(350);
};
const FIELD = `[...document.querySelectorAll(".page.is-top .search-field input")].find((i) => i.offsetParent)`;
for (const route of ROUTES) for (const style of ["ios6", "ios7", "ios13", "ios26"]) {
  await send("Page.navigate", { url: "about:blank" });
  await send("Page.navigate", { url: base + "#/" + route });
  await sleep(2500);
  await ev(`import("/core/settings.js").then((m) => m.setPhoneIos("27.0"))`);
  await ev(`document.documentElement.dataset.style = ${JSON.stringify(style)}; if (${style === "ios26"}) document.documentElement.dataset.tabbar = "float";
    document.querySelectorAll(".banner").forEach((b) => b.remove());`);
  await sleep(400);
  const has = await ev(`!!${FIELD}`);
  if (!has) { console.log(route, style, "no field drawn"); continue; }
  await ev(`(() => { const i = ${FIELD}; i.focus(); i.value = "zzz"; i.dispatchEvent(new Event("input", { bubbles: true })); window.__n = 0; i.addEventListener("input", () => __n++); })()`);
  await sleep(600);
  const r = await ev(`(() => { const r = ${FIELD}.closest(".search-field").getBoundingClientRect(); return [r.left, r.right, r.top + r.height / 2, r.height, document.documentElement.dataset.style]; })()`);
  // taps on the text: the value stays
  await touch(r[0] + 60, r[2]); await touch((r[0] + r[1]) / 2, r[2]);
  const kept = await ev(`${FIELD}.value + " focus=" + (document.activeElement === ${FIELD})`);
  const out = [];
  for (const [dx, dy] of [[-15, 0], [-15, -13], [-15, 13], [-3, 0], [-28, 0]]) {
    await ev(`(() => { const i = ${FIELD}; i.focus(); i.value = "zzz"; i.dispatchEvent(new Event("input", { bubbles: true })); __n = 0; __t.length = 0; })()`);
    const el = await ev(`document.elementFromPoint(${r[1] + dx}, ${r[2] + dy})?.outerHTML.slice(0, 12)`);
    await touch(r[1] + dx, r[2] + dy);
    out.push(`${dx},${dy}:${el} ` + await ev(`JSON.stringify([${FIELD}.value, __n, document.activeElement === ${FIELD}, __t])`));
  }
  console.log(route, r[4], "text taps:", kept, "\n   " + out.join("\n   "));
}
await bail(0, pageErrors.slice(0, 3).join("\n"));
