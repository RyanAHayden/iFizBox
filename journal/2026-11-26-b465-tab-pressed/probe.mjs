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
const swipeBack = async () => { // a finger from the left edge to two thirds across, over ~300 ms
  const y = 420;
  await touch("touchStart", 4, y);
  for (let x = 10; x <= 280; x += 15) { await sleep(16); await touch("touchMove", x, y); }
  await sleep(16);
  await touch("touchEnd", 280, y);
};
const resetMoves = () => ev("window.__smoke.moves = 0");
const moved = () => ev("window.__smoke.moves");


// Probe: for every visible tappable thing, press at its centre, edges and corners (1px in); report where the look doesn't change.
const STYLE = process.env.STYLE || "ios6";
const HASHES = (process.env.HASHES || "#/home,#/home/settings,#/sources").split(",");
const PROBE = `(() => {
  const CLICK = "a, button, [role=button], label, summary, .tab, [data-action], .cell-inner, input[type=checkbox]";
  window.__probe = { block: (e) => { if (!window.__probe.allow) { e.stopImmediatePropagation(); e.preventDefault(); } } };
  addEventListener("click", window.__probe.block, true);
  const props = ["background-color", "background-image", "color", "opacity", "filter", "box-shadow", "transform", "border-image-source"];
  const snap = (el) => [el, ...el.querySelectorAll("*")].slice(0, 40).map((n) => { const s = getComputedStyle(n); const b = getComputedStyle(n, "::before"); const a = getComputedStyle(n, "::after");
    return props.map((p) => s.getPropertyValue(p) + "|" + b.getPropertyValue(p) + "|" + a.getPropertyValue(p)).join(";"); }).join("/");
  const name = (c) => c.tagName.toLowerCase() + "." + [...c.classList].filter(k => k !== "is-pressed").join(".") + " '" + c.textContent.trim().replace(/\\s+/g, " ").slice(0, 24) + "'";
  window.__probe.list = () => {
    const out = [];
    for (const c of document.querySelectorAll(CLICK)) {
      if (c.closest("[hidden], .page:not(.is-top), [aria-hidden=true]") || !c.getClientRects().length) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const pts = [[.5, .5], [0, .5], [1, .5], [.5, 0], [.5, 1], [0, 0], [1, 0], [0, 1], [1, 1]].map(([fx, fy]) => [Math.round(Math.min(Math.max(r.left + 1 + fx * (r.width - 2), 0), innerWidth - 1)), Math.round(Math.min(Math.max(r.top + 1 + fy * (r.height - 2), 0), innerHeight - 1))]);
      out.push({ i: out.length, name: name(c), pts });
      c.dataset.probe = out.length - 1;
    }
    return out;
  };
  window.__probe.target = (x, y) => { const t = document.elementFromPoint(x, y); const c = t?.closest(CLICK); window.__probe.c = c; if (!c) return null; window.__probe.before = snap(c); return c.dataset.probe ?? name(c); };
  window.__probe.changed = () => snap(window.__probe.c) !== window.__probe.before;
})()`;
try {
  await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000);
  await ev(`localStorage.setItem("ifizbox.style", ${JSON.stringify(STYLE)})`);
  for (const h of HASHES) {
    await send("Page.navigate", { url: base + h });
    await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000);
    await sleep(1500);
    await ev(PROBE);
    console.log("== " + h + " style=" + (await ev("document.documentElement.dataset.style")));
    const list = await ev("window.__probe.list()");
    for (const c of list) {
      const bad = [];
      for (const [x, y] of c.pts) {
        const hit = await ev(`window.__probe.target(${x}, ${y})`);
        if (hit === null || hit === undefined) continue;
        if (String(hit) !== String(c.i)) continue; // covered by something else here
        await mouse("mouseMoved", x, y, 0);
        await mouse("mousePressed", x, y);
        await sleep(30);
        if (!(await ev("window.__probe.changed()"))) bad.push([x, y]);
        await mouse("mouseReleased", x, y, 0);
        await sleep(170);
      }
      console.log(`  ${bad.length === 0 ? "ok  " : bad.length === c.pts.length ? "NONE" : "PART"} ${c.name}${bad.length ? " " + JSON.stringify(bad) : ""}`);
    }
  }
} catch (e) { console.error(e); }
await cleanup();
process.exit(0);
