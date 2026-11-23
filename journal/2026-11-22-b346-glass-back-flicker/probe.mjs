#!/usr/bin/env node
// B346 probe: the iOS 26 style's nav bar buttons through a back tap and a back swipe, frame by frame, in headless
// Chromium with a fake shell that answers ui.glass (nav/glass.js) the way NativeGlass.swift does: it keeps one glass
// view per button id, removes the ids an update leaves out, creates the new ones, and hides them all on
// buttonsHidden. Each message lands LAT ms after the page sends it (the bridge hop), and the page hears back LAT ms
// after that.
//
//   node probe.mjs [web/app dir] [--lat MS] [--shots DIR] [--json FILE]
//
// Every animation frame it samples each look-alike bar button (its effective opacity: its own and its ancestors',
// its rect, whether it is visible at all) and the fake glass (which views exist, where, hidden or not), and reports
// the counts listed above analyse() per transition. Exit 0 when every count is within its limit, 1 otherwise, 2 when
// Chromium didn't start. With --shots it also saves the top 140 px of the page every 30 ms.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const LAT = Number(opt("--lat") ?? 8);
const SHOTS = opt("--shots");
const JSON_OUT = opt("--json");
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(args[0] ?? join(here, "../../web/app"));
const CHROME = process.env.CHROMIUM ?? "chromium";

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

const prof = await mkdtemp(join(tmpdir(), "ifizbox-b346-"));
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
if (!ws) await bail(2, `probe: couldn't start ${CHROME}${chromeFailed ? `: ${chromeFailed.message}` : ""}`);

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
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
};

// The fake shell and the frame sampler, before any page script.
const BOOT = `(() => {
  try { localStorage.setItem("ifizbox.style", "ios26"); } catch {}
  const LAT = ${LAT};
  const glass = window.__glass = { views: new Map(), hidden: false, created: 0, log: [] };
  const apply = (p) => {
    if (Array.isArray(p.buttons)) {
      const keep = new Set();
      for (const b of p.buttons) { keep.add(b.id); if (!glass.views.has(b.id)) glass.created++; glass.views.set(b.id, { rect: b.rect, title: b.title, kind: b.kind }); }
      for (const id of [...glass.views.keys()]) if (!keep.has(id)) glass.views.delete(id);
    }
    if (typeof p.buttonsHidden === "boolean") glass.hidden = p.buttonsHidden;
    glass.log.push({ t: performance.now(), op: p.op, hidden: p.buttonsHidden, ids: (p.buttons || []).map((b) => b.id) });
  };
  window.ifizboxNative = { jailbreak: "rootless", call(name, a, onEvent) {
    if (name === "app.info") return Promise.resolve({ ios: "27.0" });
    if (name !== "ui.glass") return Promise.resolve(null);
    const p = JSON.parse(JSON.stringify(a));
    if (p.op === "open") { setTimeout(() => { apply(p); setTimeout(() => onEvent && onEvent({ ready: true }), LAT); }, LAT); return new Promise(() => {}); }
    return new Promise((res) => setTimeout(() => { apply(p); setTimeout(() => res(null), LAT); }, LAT));
  } };
  const S = window.__frames = { on: false, list: [] };
  const eff = (el) => { if (getComputedStyle(el).visibility !== "visible") return 0; let o = 1; for (let p = el; p && p.nodeType === 1; p = p.parentElement) o *= parseFloat(getComputedStyle(p).opacity); return o; };
  const sample = () => {
    if (S.on) {
      const look = [...document.querySelectorAll(".nav-stack.is-active > .nav-item .bar-button")].filter((b) => b.getClientRects().length).map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim() || b.getAttribute("aria-label") || "", o: Math.round(eff(b) * 100) / 100, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width),
          top: !!b.closest(".nav-item.is-top"), moving: !!b.closest(".nav-item.is-moving"), shown: b.dataset.glassShown != null };
      });
      S.list.push({ t: Math.round(performance.now()), moving: !!document.querySelector(".nav-item.is-moving"), look,
        glass: { hidden: glass.hidden, created: glass.created, sent: glass.log.length, views: [...glass.views.values()].map((v) => ({ x: Math.round(v.rect.x), y: Math.round(v.rect.y), w: Math.round(v.rect.width), title: v.title })) } });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
})();`;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT });
await send("Page.navigate", { url: base + "#/home" });

const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
const settle = () => until("!document.querySelector('.page.is-moving') && !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)", 4000);
const find = (css, text = "") => ev(`(() => {
  const e = [...document.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.getClientRects().length && x.textContent.includes(${JSON.stringify(text)})
    && !x.closest('.page:not(.is-top), [hidden], [aria-hidden=true]')).at(-1);
  if (!e) return null;
  e.scrollIntoView({ block: "center" });
  const r = e.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
})()`);
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, pointerType: "mouse" });
const tap = async (css, text = "") => {
  const at = await find(css, text);
  if (!at) return false;
  await sleep(150);
  await mouse("mouseMoved", at[0], at[1], 0);
  await mouse("mousePressed", at[0], at[1]);
  await sleep(60);
  await mouse("mouseReleased", at[0], at[1], 0);
  return true;
};
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
const shot = async (n) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 402, height: 140, scale: 1 } });
  await writeFile(join(SHOTS, n + ".png"), Buffer.from(r.result.data, "base64"));
};

// Frames of one transition: the sampler on, the action, the slide, 400 ms of rest after it (the glass answers).
async function record(name, action) {
  await ev("window.__frames.list = []; window.__frames.on = true; window.__glass.created = 0");
  const shots = [];
  let stop = false;
  const shooter = SHOTS ? (async () => { let i = 0; while (!stop) { shots.push(shot(`${name}-${String(i++).padStart(2, "0")}`)); await sleep(30); } })() : null;
  await action();
  await sleep(150);
  await settle();
  await sleep(400);
  stop = true;
  await shooter;
  await Promise.all(shots);
  await ev("window.__frames.on = false");
  return ev("window.__frames.list");
}

const near = (a, b) => Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3 && Math.abs(a.w - b.w) < 3;
// What the eye sees at a button's place, frame by frame. Counts:
//   created  glass views made (each is a new UIKit glass view, drawn in fresh on the phone): want 0
//   sent     glass messages landing while the slide moves (each one reconfigures the views): want at most 1 (the hide)
//   still    frames the glass stands still, shown, while its look-alike already moves away under it: want 0
//   jump     the largest one-frame opacity change of a shown look-alike at a place the glass covers (1 = it pops
//            from shown to gone or back in one frame, under or beside the glass): want under 0.5
//   blank    frames after the slide where a button of the page on top shows neither as glass nor as look-alike
//   twice    frames where two different buttons are drawn solid at the same place (look-alikes over 0.5 opacity, or
//            a shown glass view and a look-alike of another button)
function analyse(name, frames) {
  const notes = [];
  const firstMove = frames.findIndex((f) => f.moving);
  let lastMove = -1;
  frames.forEach((f, i) => { if (f.moving) lastMove = i; });
  const created = (frames.at(-1)?.glass.created ?? 0);
  const sent = firstMove < 0 ? 0 : frames[lastMove].glass.sent - frames[firstMove].glass.sent;
  let still = 0, blank = 0, jump = 0, twice = 0;
  frames.forEach((f, i) => {
    const views = f.glass.hidden ? [] : f.glass.views;
    const solid = [...f.look.filter((l) => l.o > 0.5), ...views.map((v) => ({ ...v, text: v.title }))];
    if (solid.some((a, j) => solid.some((b, k) => k > j && near(a, b) && a.text !== b.text))) {
      twice++; notes.push(`  frame ${i}: two look-alikes drawn solid at one place`);
    }
    if (f.moving && views.length && f.look.some((l) => l.top && l.moving && l.o > 0.05 && !views.some((v) => near(l, v)))) {
      still++; notes.push(`  frame ${i}: glass still shown while its look-alike moves`);
    }
    if (i > lastMove && lastMove >= 0) {
      for (const l of f.look.filter((x) => x.top && !x.moving)) {
        if (l.o < 0.05 && !views.some((v) => near(l, v))) { blank++; notes.push(`  frame ${i}: "${l.text}" shows neither glass nor look-alike`); }
      }
    }
    if (i > 0 && i > lastMove) {
      for (const l of f.look) {
        const prev = frames[i - 1].look.find((p) => p.text === l.text && p.top === l.top && near(p, l));
        if (!prev) continue;
        const d = Math.abs(l.o - prev.o);
        if (d > jump) { jump = d; if (d >= 0.5) notes.push(`  frame ${i}: "${l.text}" look-alike ${prev.o} -> ${l.o} in one frame`); }
      }
    }
  });
  jump = Math.round(jump * 100) / 100;
  console.log(`${name}: ${frames.length} frames (slide ${firstMove}..${lastMove}): created ${created}, sent ${sent}, still ${still}, jump ${jump}, blank ${blank}, twice ${twice}`);
  for (const n of notes.slice(0, 12)) console.log(n);
  if (notes.length > 12) console.log(`  ... ${notes.length - 12} more`);
  return (created > 0) + (sent > 1) + (still > 0) + (jump >= 0.5) + (blank > 0) + (twice > 0);
}

let bad = 0;
const out = {};
try {
  if (!await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000)) await bail(1, "the app didn't draw Home");
  await sleep(1500);
  console.log(`style ${await ev("document.documentElement.dataset.style")}, controls ${await ev("document.documentElement.dataset.controls")}, tabbar ${await ev("document.documentElement.dataset.tabbar")}, glass ${await ev("document.documentElement.dataset.glass")}`);
  const push = async () => {
    await tap("a, .cell, li, button", "Settings");
    await until("location.hash.includes('settings')", 3000);
    await sleep(100); await settle(); await sleep(400);
    const h = await ev("location.hash");
    await tap(".page.is-top a.cell[href*='settings/'], .page.is-top .cell.chevron, .page.is-top a[href*='settings/']");
    await until(`location.hash !== ${JSON.stringify(h)}`, 3000);
    await sleep(100); await settle(); await sleep(500);
    return h;
  };
  const back = await push();
  console.log(`pushed to ${await ev("location.hash")}, glass views ${await ev("window.__glass.views.size")}, hidden ${await ev("window.__glass.hidden")}`);
  out.tap = await record("tap", async () => { await tap(".nav-item.is-top .back"); await until(`location.hash === ${JSON.stringify(back)}`, 3000); });
  bad += analyse("back tap", out.tap);

  await tap(".page.is-top a.cell[href*='settings/'], .page.is-top .cell.chevron, .page.is-top a[href*='settings/']");
  await sleep(100); await settle(); await sleep(600);
  out.swipe = await record("swipe", async () => {
    const y = 420;
    await touch("touchStart", 4, y);
    for (let x = 10; x <= 280; x += 15) { await sleep(16); await touch("touchMove", x, y); }
    await sleep(16);
    await touch("touchEnd", 280, y);
    await until(`location.hash === ${JSON.stringify(back)}`, 3000);
  });
  bad += analyse("back swipe", out.swipe);
  if (pageErrors.length) { console.log("page errors:\n  " + pageErrors.join("\n  ")); bad++; }
  if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(out, null, 1));
} catch (e) {
  console.error(e);
  bad++;
}
await cleanup();
process.exit(bad ? 1 : 0);
