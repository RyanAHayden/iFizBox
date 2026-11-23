#!/usr/bin/env node
// F390 probe (from journal/2026-11-22-f373-page-swipe-back/probe.mjs): swiping between Details, Reviews and Related in
// headless Chromium.
//
//   node journal/2026-11-23-f390-tab-swipe/probe.mjs [--site] [--style ios6|ios7|ios13|ios26] [--shots DIR] [--reduced]
//
// Default: the jailbreak app (fake bridge, one package in dpkg's status). --site: the website, with an AltStore
// source of 60 apps behind this script's own /api/fetch (the app page, a long Related). Exit 0 pass, 1 fail.
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
  await ev(`setInterval(() => document.querySelectorAll(".banner").forEach((b) => b.remove()), 200) && 0`);
  const TOP = ".tab-stack.is-active > .page.is-top";
  const state = () => ev(`(() => { const b = document.querySelector("${TOP} .page-body"); const v = [...b.querySelectorAll(".store-pane")];
    const r = (e) => { const q = e.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y)]; };
    return { tab: v.findIndex((p) => !p.hidden && p.style.position !== "absolute"), marked: [...b.querySelectorAll(":scope > .store-segmented .store-segment")].findIndex((s) => s.classList.contains("selected")),
      shown: v.filter((p) => !p.hidden).length, scroll: Math.round(b.scrollTop), height: b.scrollHeight, seg: r(b.querySelector(":scope > .store-segmented")), x: v.map((p) => p.hidden ? null : r(p)[0]), kids: v.map((p) => p.childElementCount),
      styled: v.map((p) => p.getAttribute("style") || "").join("") }; })()`);
  // A finger held down mid-drag, the state read there, then let go.
  const partDrag = async (x0, y0, x1, y1, name) => {
    await touch("touchStart", x0, y0);
    for (let i = 1; i <= 12; i++) { await sleep(16); await touch("touchMove", x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12); }
    await sleep(150);
    const s = await state();
    if (name) await shot(`${STYLE}-${SITE ? "site" : "app"}-${name}`);
    await touch("touchEnd", x1, y1);
    return s;
  };
  // The segmented control and the new pane, every frame until things settle: the biggest step between two frames.
  const watchSeg = () => ev(`window.__seg = []; (() => { const b = document.querySelector("${TOP} .page-body"); const s = b.querySelector(":scope > .store-segmented"); const until = performance.now() + 900;
    const f = () => { window.__seg.push(Math.round(s.getBoundingClientRect().y)); if (performance.now() < until) requestAnimationFrame(f); }; f(); })()`);
  const route = await (async () => {
    if (SITE) {
      const keys = await ev(`import("./backend.js").then(async (m) => { const b = m.getBackend(); const out = []; for (const u of ["https://apps.example.com/apps.json"]) { try { out.push((await b.addSource(u)).key); } catch (e) { out.push("ERR " + e.message); } } return out; })`);
      console.log("  sources:", keys.join(" | "));
      return keys.map((k) => `#/sources/${encodeURIComponent(k)}/package:com.example.app`);
    }
    return [`#/installed/package:com.example.probe`];
  })();
  for (const r of route) {
    console.log("--", r);
    if (SITE) await ev(`location.hash = ${JSON.stringify(r)}`);
    else {
      await tap("#tabbar a.tab", "Installed");
      await settle();
      await until(`[...document.querySelectorAll("${TOP} a")].some(a => a.textContent.includes("Probe Tweak"))`, 8000);
      await pushFrom(await hash(), `${TOP} a`);
    }
    if (!check(await until(`document.querySelector("${TOP} .store-segmented")`, 10000), "the page draws")) { console.log((await ev("document.body.innerText")).slice(0, 500)); continue; }
    await sleep(1500);
    const at = await hash();
    let s = await state();
    const seg0 = s.seg[1];
    check(s.tab === 0 && s.shown === 1, "Details shows");
    const w = 390;
    if (REDUCED) {
      s = await partDrag(350, 500, 100, 505);
      check(s.shown === 1 && s.x[0] === 0, "reduced motion: nothing follows the finger");
      await sleep(100);
      s = await state();
      check(s.tab === 1 && s.marked === 1 && !s.styled, "and it switches at once");
      continue;
    }
    // follows, 1:1
    s = await partDrag(350, 500, 250, 505, "drag-details-reviews");
    check(s.shown === 2 && Math.abs(s.x[1] - s.x[0] - w) <= 1 && s.x[0] < -70 && s.kids[1] > 0, `mid-drag both panes side by side (${s.x}), Reviews filled`);
    check(s.seg[1] === seg0 && s.seg[0] >= 0, "the header stays put");
    await settle(); await sleep(400);
    s = await state();
    check(s.tab === 0 && s.shown === 1 && !s.styled, `let go early it slides back (${JSON.stringify(s)})`);
    await drag(350, 500, 100, 505); await settle(); await sleep(300);
    s = await state();
    check(s.tab === 1 && s.marked === 1 && s.shown === 1 && !s.styled && (await hash()) === at, "past half: Reviews");
    await drag(350, 500, 270, 503, 4); await settle(); await sleep(400);
    s = await state();
    check(s.tab === 2 && s.marked === 2 && s.kids[2] > 0, `a flick: Related (${s.tab})`);
    s = await partDrag(350, 500, 150, 503, "related-end");
    check(s.x[2] < 0 && s.x[2] > -120, `Related rubber-bands at its end (${s.x[2]})`);
    await settle(); await sleep(400);
    check((await state()).tab === 2, "and stays");
    s = await partDrag(50, 500, 180, 505, "drag-related-reviews");
    check(s.shown === 2 && s.x[2] > 70, "a right drag shows Reviews");
    await settle(); await sleep(400);
    await drag(50, 500, 330, 505); await settle(); await sleep(400);
    s = await state();
    check(s.tab === 1 && (await hash()) === at, `Related -> Reviews by a right swipe, no pop (${await hash()})`);
    await drag(200, 600, 210, 300); await sleep(400);
    check((await state()).tab === 1, "a vertical drag is no swipe");
    await ev(`document.querySelector("${TOP} .page-body").scrollTop = 0`);
    // rapid: two flicks back to back
    await drag(50, 500, 180, 503, 4); await sleep(60); await drag(350, 500, 220, 503, 4); await settle(); await sleep(400);
    s = await state();
    check(s.tab === 1 && s.shown === 1 && !s.styled && (await hash()) === at, `rapid swipes there and back (${s.tab})`);
    // taps slide
    await ev("window.__smoke.anims.length = 0");
    await tap(`${TOP} .store-segment`, "Details");
    await sleep(80);
    s = await state();
    check(s.shown === 2 && s.marked === 0, `a tap slides (${s.x})`);
    await settle(); await sleep(300);
    const props = await ev("[...new Set(window.__smoke.anims.filter((a) => /store-pane/.test(a.target)).flatMap((a) => a.props))]");
    check(props.join() === "transform", `only transform animates on the panes (${props})`);
    const ghosts = await ev("document.querySelectorAll('[data-slide-ghost]').length");
    check(ghosts === 0, "no fading copies");
    // scrolled down in Details, then a shorter pane
    await ev(`(() => { const p = document.querySelector("${TOP} .store-details"); const d = document.createElement("div"); d.className = "probe-tall"; d.style.cssText = "height:2000px;background:linear-gradient(#cde,#edc)"; p.append(d); })()`);
    await sleep(600);
    await ev(`document.querySelector("${TOP} .page-body").scrollTop = 1200`);
    await sleep(200);
    s = await partDrag(350, 500, 120, 503, "scrolled-drag");
    check(s.scroll === 1200, `the drag scrolls nothing (${s.scroll})`);
    await watchSeg();
    await settle(); await sleep(1000);
    const steps = await ev("window.__seg");
    const big = Math.max(...steps.slice(1).map((y, i) => Math.abs(y - steps[i])));
    s = await state();
    console.log("   ", steps[0], "->", steps.at(-1), "biggest step", big, "scroll", s.scroll);
    check(s.tab === 1 && !s.styled && steps.filter((y, i) => i && y !== steps[i - 1]).length !== 1, "the header slides in, it doesn't jump");
    await shot(`${STYLE}-${SITE ? "site" : "app"}-scrolled-after`);
    await ev(`document.querySelector("${TOP} .page-body").scrollTop = 0`);
    await drag(50, 500, 330, 505); await settle(); await sleep(400);
    await ev(`(() => { document.querySelector(".probe-tall").remove(); const p = document.querySelector("${TOP} .store-details"); const g = document.createElement("div"); g.className = "probe-gallery"; g.style.cssText = "display:flex;gap:10px;overflow-x:auto;height:200px;touch-action:pan-x pan-y;overscroll-behavior-x:contain"; for (let i = 0; i < 5; i++) { const c = document.createElement("div"); c.style.cssText = "flex:none;width:250px;background:#c33"; g.append(c); } p.prepend(g); })()`);
    await sleep(600);
    const gy = await ev(`(() => { const q = document.querySelector(".probe-gallery").getBoundingClientRect(); return q.y + 100; })()`);
    for (const left of [0, 400, 9999]) {
      await ev(`document.querySelector(".probe-gallery").scrollLeft = ${left}`);
      await sleep(150);
      await drag(350, gy, 100, gy + 2); await settle(); await sleep(400);
      check((await state()).tab === 0, `a left drag on a gallery at ${left} switches nothing`);
    }
    await ev(`document.querySelector(".probe-gallery").remove()`);
    await sleep(500);
    // swipe back
    if (SITE) { await drag(170, 500, 385, 505); await sleep(500); s = await state(); check((await hash()) === at && s.tab === 0 && !s.styled, "website: a right drag on Details does nothing"); continue; }
    await drag(350, 500, 100, 505); await settle(); await sleep(400);
    await drag(6, 500, 330, 505); await until(`location.hash !== ${JSON.stringify(at)}`, 3000); await settle();
    check((await hash()) !== at, "the edge strip goes back from Reviews");
    await sleep(400);
    await pushFrom(await hash(), `${TOP} a`); await sleep(1200);
    check((await state()).tab === 0, "opened again: Details");
    await drag(170, 500, 385, 505); await until(`location.hash !== ${JSON.stringify(at)}`, 3000); await settle();
    check((await hash()) !== at, "a right swipe on Details goes back");
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

