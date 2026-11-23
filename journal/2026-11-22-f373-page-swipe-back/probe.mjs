#!/usr/bin/env node
// F373 probe (from tools/smoke/smoke.mjs): page swipe back in headless Chromium with the fake bridge.
//
//   node journal/2026-11-22-f373-page-swipe-back/probe.mjs [web/app dir] [--site] [--shots DIR]
//
// Serves the directory on 127.0.0.1 and opens it as the jailbreak app (a fake `ifizboxNative` answering apt.sources
// and apt.dpkgStatus, null otherwise; --site: the website) at 390x844, then drives CDP touch events:
//   1. a rightward drag from mid-page on a pushed Settings page pops, with the slide (--site: does nothing, and stops);
//   2. a vertical drag scrolls a pushed page and starts no swipe;
//   3. an overflow-x gallery not at its start scrolls under a right drag, no pop; at its start the drag pops;
//   4. Sources rows: left swipe shows Delete, right swipe puts it away (root, and the list moved into a pushed page,
//      with no pop); with no Delete showing a right swipe on a row pops;
//   5. a Details page (Installed > a package from the fake dpkg status): a mid-page drag pops.
// Taps are CDP mouse events at the element's centre (the tap guard ignores el.click()). Exit 0 pass, 1 fail, 2 no Chromium.
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
  check(await tap("a, .cell, li, button", "Settings"), "Home shows a Settings row");
  await until("location.hash.includes('settings')", 3000);
  await settle();
  await sleep(300);
  const settingsHash = await hash();
  const SUB = ".tab-stack.is-active > .page.is-top a.cell[href*='settings/'], .tab-stack.is-active > .page.is-top .cell.chevron, .tab-stack.is-active > .page.is-top a[href*='settings/']";

  // 1. a rightward drag from mid-page pops, with the slide
  check(await pushFrom(settingsHash, SUB), `push a Settings page (${await hash()})`);
  check(await ev("!document.elementFromPoint(170, 420)?.closest('.edge-swipe')"), "x=170 is page, not the edge strip");
  await resetMoves();
  await shot("1-before");
  await drag(170, 420, 385, 425); // past half the width, so it commits even if headless timing loses the speed
  if (SITE) { // --site: the website leaves back to Safari's own swipe (webBack): nothing of ours moves
    await sleep(800);
    check((await hash()) !== settingsHash && (await moved()) === 0, `website: a mid-page drag does nothing (route ${await hash()})`);
    throw "site-done";
  }
  check(await backTo(settingsHash), `mid-page swipe pops (route ${await hash()})`);
  check(await moved() > 0, "the swipe dragged the page");

  // 2. vertical scroll on a pushed page: scrolls, never pops, nothing slides
  check(await pushFrom(settingsHash, SUB), "push again");
  const sub = await hash();
  await ev(`(() => { const b = document.querySelector(".tab-stack.is-active > .page.is-top .page-body"); const d = document.createElement("div"); d.className = "probe-tall"; d.style.height = "3000px"; b.append(d); b.scrollTop = 0; })()`);
  await resetMoves();
  await drag(200, 650, 215, 250, 14);
  await sleep(600);
  const top = await ev(`document.querySelector(".tab-stack.is-active > .page.is-top .page-body").scrollTop`);
  check(top > 100, `a vertical drag scrolls the page (scrollTop ${top})`);
  check((await hash()) === sub && (await moved()) === 0, "and starts no swipe");
  await ev(`(() => { const b = document.querySelector(".tab-stack.is-active > .page.is-top .page-body"); b.querySelector(".probe-tall").remove(); b.scrollTop = 0; })()`);

  // 3. a sideways gallery (overflow-x, as Preview's) not at its start: the drag scrolls it, no pop; at its start: pops
  await ev(`(() => {
    const b = document.querySelector(".tab-stack.is-active > .page.is-top .page-body");
    const g = document.createElement("div");
    g.className = "probe-gallery";
    g.style.cssText = "display:flex;gap:10px;overflow-x:auto;height:300px;touch-action:pan-x pan-y;overscroll-behavior-x:contain";
    for (let i = 0; i < 5; i++) { const s = document.createElement("div"); s.style.cssText = "flex:none;width:250px;height:280px;background:#c33"; g.append(s); }
    b.prepend(g);
    g.scrollLeft = 500;
  })()`);
  await sleep(200);
  const gy = await ev(`(() => { const r = document.querySelector(".probe-gallery").getBoundingClientRect(); return r.y + r.height / 2; })()`);
  await resetMoves();
  await drag(120, gy, 300, gy + 3);
  await sleep(600);
  const left = await ev(`document.querySelector(".probe-gallery").scrollLeft`);
  check((await hash()) === sub && (await moved()) === 0, `a right drag on a gallery mid-way doesn't pop (route ${await hash()})`);
  check(left < 500, `it scrolls the gallery instead (scrollLeft 500 -> ${left})`);
  await ev(`document.querySelector(".probe-gallery").scrollLeft = 0`);
  await sleep(200);
  await resetMoves();
  await drag(120, gy, 330, gy + 3);
  check(await backTo(settingsHash), `at its start the same drag pops (route ${await hash()})`);
  check(await moved() > 0, "with the slide");

  // 4. row swipe actions (sources.js): open with a left swipe, a right swipe closes it, on the tab root and moved
  // into a pushed page (the real list, its listeners with it)
  await tap("#tabbar a.tab", "Sources");
  check(await until("document.querySelectorAll('.tab-stack.is-active > .page.is-top .source-row').length >= 2", 6000), "Sources lists the fake sources");
  await settle();
  await sleep(400);
  const rowAt = (i) => ev(`(() => { const r = document.querySelectorAll(".tab-stack.is-active > .page.is-top .source-row")[${i}].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const armedRows = () => ev(`document.querySelectorAll(".tab-stack.is-active > .page.is-top .source-row.armed").length`);
  let [rx, ry] = await rowAt(1);
  await drag(330, ry, 150, ry + 2, 10);
  await sleep(300);
  check(await armedRows() === 1, "root: a left swipe shows the row's Delete");
  await drag(150, ry, 330, ry + 2, 10);
  await sleep(300);
  check(await armedRows() === 0, "root: a right swipe puts it away");
  const root = await hash();
  check(await pushFrom(root, ".tab-stack.is-active > .page.is-top .source-row a.cell-inner, .tab-stack.is-active > .page.is-top .source-row .cell-inner"), `push a source page (${await hash()})`);
  const srcPage = await hash();
  await ev(`(() => {
    const ul = [...document.querySelectorAll(".page .sources-list")][0];
    const b = document.querySelector(".tab-stack.is-active > .page.is-top .page-body");
    b.prepend(ul); b.scrollTop = 0;
  })()`);
  await sleep(300);
  [rx, ry] = await rowAt(1);
  await resetMoves();
  await drag(330, ry, 150, ry + 2, 10);
  await sleep(300);
  check(await armedRows() === 1 && (await hash()) === srcPage, "pushed: a left swipe shows the Delete, no pop");
  await drag(150, ry, 330, ry + 2, 10);
  await sleep(500);
  check(await armedRows() === 0, "pushed: a right swipe on it puts the Delete away");
  check((await hash()) === srcPage && (await moved()) === 0, `and doesn't pop (route ${await hash()})`);
  await drag(150, ry, 360, ry + 2, 12);
  check(await backTo(root), `with no Delete showing, a right swipe on a row pops (route ${await hash()})`);
  check(await ev("!document.querySelector('.tab-stack.is-active > .page.is-top .is-pressed')"), "no row left blue after it");

  // 5. a Details page: Installed lists the fake package; its page pops from a mid-page drag
  await tap("#tabbar a.tab", "Installed");
  await settle();
  const instRoot = await hash();
  const hasPkg = await until("[...document.querySelectorAll('.tab-stack.is-active > .page.is-top a')].some(a => a.textContent.includes('Probe Tweak'))", 8000);
  if (!hasPkg) { await shot("5-installed"); console.log("  installed page:", (await ev("document.querySelector('.tab-stack.is-active > .page.is-top')?.innerText")).slice(0, 400)); }
  if (check(hasPkg, `Installed lists the fake package (${instRoot})`)) {
    check(await pushFrom(instRoot, ".tab-stack.is-active > .page.is-top a"), `open its Details page (${await hash()})`);
    await shot("5-details");
    await resetMoves();
    await drag(170, 500, 385, 505);
    check(await backTo(instRoot), `mid-page swipe on the Details page pops (route ${await hash()})`);
    check(await moved() > 0, "with the slide");
  }

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ").slice(0, 600) : ""}`);
} catch (e) {
  if (e !== "site-done") failures.push(String(e?.stack ?? e));
  console.error(e);
}
ws.close();
await cleanup();
console.log(failures.length ? `probe: ${failures.length} failed` : "probe: passed");
process.exit(failures.length ? 1 : 0);

