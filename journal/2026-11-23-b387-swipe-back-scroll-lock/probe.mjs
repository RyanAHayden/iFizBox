#!/usr/bin/env node
// B387 probe (from F390's): while a swipe back is under way neither page scrolls vertically. Headless Chromium, fake bridge, CDP touches.
//   node journal/2026-11-23-b387-swipe-back-scroll-lock/probe.mjs [web/app dir] [--style ios6|ios7|ios13|ios26]
// Edge strip and page swipe: both scrollers are held while the finger drags (it then moves 200 px down, and a second
// finger drags the page for the edge one); a cancelled swipe keeps the scroll place and scrolling works after it.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; args.splice(i, 1); return true; };
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const SITE = flag("--site");
const REDUCED = flag("--reduced");
const STYLE = opt("--style") ?? "ios6";
const SHOTS = opt("--shots");
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(args[0] ?? join(here, "../../web/app"));
const CHROME = process.env.CHROMIUM ?? "chromium";

// Animated properties that make the browser lay out again every frame.
const LAYOUT = /^(height|width|(min|max)-(height|width)|top|right|bottom|left|inset(-.*)?|margin(-.*)?|padding(-.*)?|flex(-basis|-grow|-shrink)?|grid(-.*)?|gap|row-gap|column-gap|font-size|line-height|letter-spacing|word-spacing|border(-(top|right|bottom|left))?-width|border-width|block-size|inline-size|(min|max)-(block|inline)-size|all)$/;
export const isLayoutProperty = (p) => LAYOUT.test(p);

const FILES = {
  "apps.example.com/apps.json": JSON.stringify({ name: "Probe Apps", identifier: "com.example.apps", apps: Array.from({ length: 60 }, (_, i) => ({ name: `Probe App ${i || ""}`.trim(), bundleIdentifier: `com.example.app${i || ""}`, developerName: "Probe", localizedDescription: "An app.\n".repeat(30), iconURL: "", versions: [{ version: "1.0", date: "2026-01-01", size: 1000, downloadURL: "https://apps.example.com/a.ipa" }] })) }),
};

// --- static server ---------------------------------------------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/fetch") {
    const u = new URL(url.searchParams.get("url") ?? "http://x/");
    const text = FILES[u.host + u.pathname];
    if (text == null) { res.writeHead(404, { "Content-Type": "application/json" }).end('{"code":"not_found","error":"not found"}'); return; }
    res.writeHead(200, { "Content-Type": "text/plain" }).end(text);
    return;
  }
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; }
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
if (!ws) await bail(2, `probe: couldn't start ${CHROME}${chromeFailed ? `: ${chromeFailed.message}` : ""} (set CHROMIUM=<path>)`);

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

// Runs before any page script: the animation recorder, and the fake bridge for the app.
const RECORDER = `(() => {
  const rec = window.__smoke = { anims: [], moves: 0, seen: new WeakSet() };
  const name = (el) => el && el.nodeType === 1 ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "") : String(el);
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const SKIP = new Set(["offset", "easing", "composite", "computedOffset"]);
  const note = (kind, target, props, extra) => rec.anims.push({ kind, target: name(target), props, extra, at: Math.round(performance.now()) });
  const fromAnim = (a, kind) => {
    if (rec.seen.has(a)) return; rec.seen.add(a);
    let props = [];
    try { props = [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((x) => !SKIP.has(x)).map(kebab)))]; } catch {}
    if (a.transitionProperty) props.push(a.transitionProperty);
    note(kind || a.constructor.name, a.effect && a.effect.target, [...new Set(props)], a.animationName || a.transitionProperty || "");
  };
  document.addEventListener("transitionrun", (e) => note("transitionrun", e.target, [e.propertyName]), true);
  document.addEventListener("animationstart", (e) => { note("animationstart", e.target, [], e.animationName); for (const a of e.target.getAnimations()) fromAnim(a); }, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...a) { const r = animate.apply(this, a); fromAnim(r, "animate"); return r; };
  const poll = () => { try { for (const a of document.getAnimations()) fromAnim(a); } catch {} if (document.querySelector(".page.is-moving")) rec.moves++; requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
})();`;
// F373: apt.sources answers two sources, so the Sources tab has rows with swipe actions.
const SOURCES = [{ path: "/etc/apt/sources.list.d/ifizbox.sources", text: "Types: deb\nURIs: https://one.example.com/\nSuites: ./\nComponents:\n\nTypes: deb\nURIs: https://two.example.com/\nSuites: ./\nComponents:\n" }];
const STATUS = "Package: com.example.probe\nStatus: install ok installed\nVersion: 1.0\nArchitecture: iphoneos-arm64\nName: Probe Tweak\nSection: Tweaks\nDescription: A package for the F373 probe\nMaintainer: Probe <probe@example.com>\n\n";
const BRIDGE = `window.ifizboxNative = { jailbreak: "rootless", dpkgStatus: async () => ${JSON.stringify(STATUS)}, call: async (m) => (m === "apt.sources" ? ${JSON.stringify(SOURCES)} : m === "apt.dpkgStatus" ? ${JSON.stringify(STATUS)} : null) };`;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER + (`try { localStorage.setItem("ifizbox.style", ${JSON.stringify(STYLE)}); localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}` + (SITE ? "" : BRIDGE)) });
if (REDUCED) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await send("Page.navigate", { url: base + "#/home" });

const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
const settle = () => until("!document.querySelector('.page.is-moving, .sheet.is-moving') && !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)", 4000);
const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); return ok; };
const shot = async (n) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(SHOTS, n + ".png"), Buffer.from(r.result.data, "base64"));
};
const hash = () => ev("location.hash");
// The centre of the last visible element matching css (and holding text), scrolled into view; null if none.
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
// A finger from (x0, y0) to (x1, y1) in `steps` moves 16 ms apart.
const drag = async (x0, y0, x1, y1, steps = 18) => {
  await touch("touchStart", x0, y0);
  for (let i = 1; i <= steps; i++) { await sleep(16); await touch("touchMove", x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); }
  await sleep(16);
  await touch("touchEnd", x1, y1);
};
const resetMoves = () => ev("window.__smoke.moves = 0");
const moved = () => ev("window.__smoke.moves");
const pushFrom = async (from, css) => { // a tap on the first row matching css on the top page, and its slide
  await resetMoves();
  const ok = await tap(css);
  await until(`location.hash !== ${JSON.stringify(from)}`, 3000);
  await until("window.__smoke.moves > 0", 3000);
  await settle();
  await sleep(300);
  return ok && (await hash()) !== from;
};
const backTo = async (want) => { await until(`location.hash === ${JSON.stringify(want)}`, 3000); await settle(); await sleep(300); return (await hash()) === want; };

try {
  check(await until("document.querySelector('.tab-stack.is-active > .page.is-top') && document.querySelector('#tabbar .tab')", 15000), "the app draws Home");
  await sleep(1500);
  await tap("a, .cell, li, button", "Settings");
  await until("location.hash.includes('settings')", 3000);
  await settle(); await sleep(300);
  const SUB = ".tab-stack.is-active > .page.is-top a.cell[href*='settings/'], .tab-stack.is-active > .page.is-top .cell.chevron, .tab-stack.is-active > .page.is-top a[href*='settings/']";
  const root = await hash();
  await tap(SUB);
  await until(`location.hash !== ${JSON.stringify(root)}`, 3000);
  await settle(); await sleep(300);
  const sub = await hash();
  check(sub !== root, `a pushed page (${sub})`);
  await ev(`(() => { window.__b = [...document.querySelectorAll(".tab-stack.is-active > .page")].slice(-2).map((p) => p.querySelector(".page-body"));
    for (const b of window.__b) { const d = document.createElement("div"); d.style.height = "3000px"; b.append(d); b.scrollTop = 400; } })()`);
  await sleep(400);
  const tops = () => ev("window.__b.map((b) => Math.round(b.scrollTop))");
  const held = () => ev("window.__b.map((b) => getComputedStyle(b).overflowY)");
  const pts = (type, list) => send("Input.dispatchTouchEvent", { type, touchPoints: list.map(([id, x, y]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })) });
  const line = async (from, to, n, extra = []) => { for (let i = 1; i <= n; i++) { await sleep(16); await pts("touchMove", [[1, from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n], ...extra]); } };
  const scrolls = async (what) => {
    const before = (await tops())[1];
    await drag(200, 600, 205, 350, 14);
    await sleep(700);
    const after = (await tops())[1];
    check(after > before + 100, `${what}: a vertical drag scrolls (${before} -> ${after})`);
    await ev("window.__b[1].scrollTop = 400"); await sleep(200);
  };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [name, x0] of [["edge strip", 6], ["page swipe", 170]]) {
    // decided, then far down and up, and back to the left so it cancels
    await touch("touchStart", x0, 400);
    await line([x0, 400], [x0 + 60, 404], 6);
    await sleep(60);
    check(eq(await held(), ["hidden", "hidden"]), `${name}: both scrollers held (${await held()})`);
    const start = await tops();
    await line([x0 + 60, 404], [x0 + 70, 604], 12);
    await sleep(60);
    check(eq(await tops(), start), `${name}: 200 px down scrolls neither (${start} -> ${await tops()})`);
    await line([x0 + 70, 604], [x0 + 70, 304], 12);
    await sleep(60);
    check(eq(await tops(), start), `${name}: 300 px up scrolls neither (${await tops()})`);
    if (x0 === 6) { // a second finger on the page (the page swipe itself drops on one)
      await pts("touchStart", [[1, x0 + 70, 304], [2, 250, 600]]);
      for (let i = 1; i <= 14; i++) { await sleep(16); await pts("touchMove", [[1, x0 + 70, 304], [2, 250, 600 - i * 18]]); }
      await sleep(60);
      check(eq(await tops(), start), `${name}: a second finger scrolls neither (${await tops()})`);
      await pts("touchEnd", [[1, x0 + 70, 304]]);
    }
    await line([x0 + 70, 304], [x0 + 14, 304], 10);
    await sleep(150);
    await touch("touchEnd", x0 + 14, 304);
    await sleep(700);
    check((await hash()) === sub, `${name}: cancelled, still on the page`);
    check(eq(await tops(), start), `${name}: the scroll place is kept (${await tops()})`);
    check(eq(await held(), ["auto", "auto"]), `${name}: both scroll again (${await held()})`);
    await scrolls(`${name}, after it`);
  }
  await drag(170, 400, 385, 520); // commits
  await backTo(root);
  check((await hash()) === root, "a diagonal page swipe commits");
  check((await tops())[0] === 400 && (await held())[0] === "auto", `the page below kept its place (${await tops()}, ${await held()})`);
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ").slice(0, 600) : ""}`);
} catch (e) {
  if (e !== "site-done") failures.push(String(e?.stack ?? e));
  console.error(e);
}
ws.close();
await cleanup();
console.log(failures.length ? `probe: ${failures.length} failed` : "probe: passed");
process.exit(failures.length ? 1 : 0);

