#!/usr/bin/env node
// Browser smoke test: web/app in headless Chromium, driven like a finger. Not part of tools/check.sh (it needs
// Chromium; a run takes about 10 seconds); run it by hand after touching navigation, slides or overlays.
//
//   node tools/smoke/smoke.mjs [web/app dir] [--site] [--shots DIR] [--keep]
//
// It serves the directory on 127.0.0.1 (a random port), opens it as the jailbreak app (a fake `ifizboxNative`
// whose every call answers null; --site opens it as the website instead) at 390x844 with an iPhone user agent, and:
//   1. push: taps Home's Settings row, then a Settings row, and checks a push slide ran (.page.is-moving);
//   2. pop: taps the nav bar's Back and checks the route came back, with a slide;
//   3. swipe back: pushes again and drags a finger (CDP touch events) from the left edge, and checks the route came
//      back (the edge strip is off on the website, so --site skips this one);
//   4. sheet: opens one through the sheet scaffold (nav/sheet.js showSheet: every sheet in the app is built on it;
//      none opens from the fake bridge's empty state without data) and closes it with its Done button;
//   5. gallery: opens the screenshots gallery (screens/altstore.js previewSlot) above a group of rows and samples
//      every frame: the rows below must never overlap the gallery's visible part and must move with its edge;
//   6. skeleton: swaps a loading skeleton for content, at rest and with the page marked as mid-push: no fading
//      copy of the skeleton, and no fade at all mid-push;
// and through all of it records every animation that runs: `transitionrun` and `animationstart` events, and every
// Web Animation (CSS ones included) caught by polling document.getAnimations() each frame and by wrapping
// Element.animate. It fails if any of them animates a layout property (height, width, top/left, margins,
// padding, ...): 120 Hz means transform and opacity only (AGENTS.md, docs/native.md). Page errors fail it too.
// Taps are real CDP mouse events at the element's centre: the tap guard ignores el.click().
// Exit 0 on pass, 1 on a failed check, 2 when it couldn't run (no Chromium).
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
const KEEP = flag("--keep");
const SHOTS = opt("--shots");
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(args[0] ?? join(here, "../../web/app"));
const CHROME = process.env.CHROMIUM ?? "chromium";

// Animated properties that make the browser lay out again every frame.
const LAYOUT = /^(height|width|(min|max)-(height|width)|top|right|bottom|left|inset(-.*)?|margin(-.*)?|padding(-.*)?|flex(-basis|-grow|-shrink)?|grid(-.*)?|gap|row-gap|column-gap|font-size|line-height|letter-spacing|word-spacing|border(-(top|right|bottom|left))?-width|border-width|block-size|inline-size|(min|max)-(block|inline)-size|all)$/;
export const isLayoutProperty = (p) => LAYOUT.test(p);

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
const BRIDGE = `window.ifizboxNative = { jailbreak: "rootless", call: async () => null };`;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER + (SITE ? `try { localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}` : BRIDGE) });
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

// B466 probe: on Settings, (1) drag a row up and back down, releasing on the same row: the list scrolls and nothing
// opens; (2) a fling, then a tap on a row while it glides: nothing opens; (3) a plain tap opens the row.
// Run: node journal/2026-11-26-b466-drag-not-tap/probe.mjs web/app   (exit 1 on a failed check)
const STYLE = process.env.STYLE || "ios6";
const WATCH = `(() => {
  window.__b466 = { clicks: 0, pressedDuringDrag: false, scrolls: 0 };
  document.addEventListener("click", (e) => { if (e.target.closest?.(".cell-inner")) window.__b466.clicks++; });
  document.addEventListener("scroll", () => { window.__b466.scrolls++; }, true);
})()`;
const rowAt = (text) => ev(`(() => { const e = [...document.querySelectorAll('.page.is-top .cell-inner')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, e.textContent.trim().slice(0, 30)]; })()`);
const bodyTop = () => ev("document.querySelector('.page.is-top .page-body').scrollTop");
const pressedNow = () => ev("!!document.querySelector('.page.is-top .is-pressed')");
const reset = () => ev("Object.assign(window.__b466, { clicks: 0, scrolls: 0 })");
try {
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000);
  await ev(`localStorage.setItem("ifizbox.style", ${JSON.stringify(STYLE)})`);
  await send("Page.navigate", { url: base + "#/home/settings" });
  await until("document.querySelector('.page.is-top .cell-inner')", 15000);
  await sleep(800);
  // The fake bridge's Settings barely overflows: copies of its row groups after it give the list room to scroll and
  // fling, with rows (links) under the finger all the way down.
  await ev(`(() => { const b = document.querySelector('.page.is-top .page-body'); const ul = [...b.querySelectorAll('ul')].find((u) => u.querySelector('a.cell-inner'));
    for (let i = 0; i < 12; i++) b.append(ul.cloneNode(true)); })()`);
  await ev(WATCH);
  const start = await hash();
  // pick a row in the middle of the screen
  const mid = await ev(`(() => { const rows = [...document.querySelectorAll('.page.is-top a.cell-inner')].filter((e) => { const r = e.getBoundingClientRect(); return r.top > 300 && r.bottom < 600; });
    const e = rows[0]; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, e.textContent.trim().slice(0, 30)]; })()`);
  check(!!mid, `a row mid-screen on Settings (${mid?.[2]})`);
  const sh = await ev("(() => { const b = document.querySelector('.page.is-top .page-body'); return b.scrollHeight - b.clientHeight; })()");
  check(sh > 120, `Settings scrolls (${sh}px of overflow)`);

  // 1. drag from the row, up 120 px and back, release on the same row
  await reset();
  const [x, y] = mid;
  await touch("touchStart", x, y);
  await sleep(80);
  let midPressed = null;
  for (let d = 10; d <= 120; d += 10) { await sleep(16); await touch("touchMove", x, y - d); if (d === 60) midPressed = await pressedNow(); }
  for (let d = 110; d >= 0; d -= 10) { await sleep(16); await touch("touchMove", x, y - d); }
  await sleep(150); // let it come to rest, so the lift is on the same row
  const scrolledMid = await ev("window.__b466.scrolls");
  const back = await ev(`document.elementFromPoint(${x}, ${y})?.closest('.cell-inner')?.textContent.trim().slice(0, 30)`);
  await touch("touchEnd", x, y);
  await sleep(600);
  check(scrolledMid > 0, `1. the drag scrolled the list (${scrolledMid} scroll events)`);
  check(back === mid[2], `1. the finger lifted on the same row (${back})`);
  check(midPressed === false, "1. the row lost its pressed look once the drag began");
  check((await hash()) === start && (await ev("window.__b466.clicks")) === 0, `1. nothing opened (hash ${await hash()}, row clicks ${await ev("window.__b466.clicks")})`);

  // 2. a fling, then a tap on a row while the list still glides
  await ev("document.querySelector('.page.is-top .page-body').scrollTop = 0");
  await sleep(300);
  await reset();
  await touch("touchStart", x, 650);
  for (let yy = 630; yy >= 330; yy -= 50) { await sleep(8); await touch("touchMove", x, yy); }
  await touch("touchEnd", x, 330);
  await sleep(40);
  const t0 = await bodyTop();
  await sleep(30);
  const t1 = await bodyTop();
  const gliding = t1 !== t0;
  const [gy, row2] = await ev(`(() => { const e = [...document.querySelectorAll('.page.is-top a.cell-inner')].map((c) => [c, c.getBoundingClientRect()])
    .filter(([, r]) => r.top > 150 && r.bottom < 700).sort((a, b) => Math.abs(a[1].top - 400) - Math.abs(b[1].top - 400))[0];
    return e ? [e[1].top + e[1].height / 2, e[0].textContent.trim().slice(0, 30)] : [450, null]; })()`);
  await touch("touchStart", x, gy);
  await sleep(50);
  const pressedOnGlide = await pressedNow();
  await touch("touchEnd", x, gy);
  await sleep(600);
  console.log(`     glide: scrollTop ${t0} -> ${t1} before the tap on '${row2}'`);
  if (gliding) {
    check(!pressedOnGlide, "2. a touch on the gliding list shows no pressed look");
    check((await hash()) === start && (await ev("window.__b466.clicks")) === 0, `2. the tap that stopped the glide opened nothing (hash ${await hash()})`);
  } else console.log("skip 2. headless Chromium didn't fling (no momentum after the lift)");

  // 4. a short drag along the row (14 px sideways, past our 10 px but inside Chromium's own tap slop, so Chromium
  // still sends click, as iOS does after a short drag): nothing opens. Rows are pan-y, so nothing scrolls.
  await ev("document.querySelector('.page.is-top .page-body').scrollTop = 0");
  await sleep(400);
  await reset();
  await touch("touchStart", x, y);
  for (let d = 2; d <= 14; d += 2) { await sleep(16); await touch("touchMove", x + d, y); }
  await sleep(30);
  await touch("touchEnd", x + 14, y);
  await sleep(600);
  const clicks4 = await ev("window.__b466.clicks");
  check((await hash()) === start, `4. a 14 px drag opened nothing (hash ${await hash()}, row clicks reaching handlers ${clicks4})`);

  // 3. a plain tap opens the row
  await ev("document.querySelector('.page.is-top .page-body').scrollTop = 0");
  await sleep(400);
  const p = mid;
  await touch("touchStart", p[0], p[1]);
  await sleep(60);
  const pressedTap = await pressedNow();
  await touch("touchEnd", p[0], p[1]);
  await until(`location.hash !== ${JSON.stringify(start)}`, 3000);
  check(pressedTap, "3. the tapped row shows its pressed look");
  check((await hash()) !== start, `3. a plain tap opened '${p[2]}' (hash ${await hash()})`);
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ") : ""}`);
} catch (e) { failures.push(String(e)); console.error(e); }
await cleanup();
console.log(failures.length ? `FAIL: ${failures.length}` : "pass");
process.exit(failures.length ? 1 : 0);
