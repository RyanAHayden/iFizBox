#!/usr/bin/env node
// Opens a built concept page (tools/concept/build.py --standalone) in headless Chromium under a CSP like the
// Artifact viewer's (no host, nothing fetched, inline scripts and data: images only) and checks it at each
// device x theme x mode asked for: the app came up in the phone (a page drawn, the Loading screen gone), a tap on
// the tab bar navigates, and nothing logged an error (exceptions, console.error, CSP refusals, any request at all
// besides the page). Not in tools/check.sh: it needs Chromium.
//
//   node tools/concept/check.mjs PAGE.html [--devices iphone-se,iphone-17-pro-max] [--themes light:classic,dark:gunmetal,ios7:light:white]
//                                [--modes jailbreak,sideload,site] [--version after|before] [--shots DIR]
//                                [--viewport 1280x900] [--tap '.tabbar a:nth-child(2)'] [--route '#/sources'] [--probe 'return …']
//                                [--drag-route '#/home/credits' | none]
//
// The mouse is a finger in the phone (tools/concept/touch.js), so each run also opens --drag-route and drags its
// list by mouse: the row pressed shows its pressed state and the app saw a touch (pointerType "touch", touchstart),
// the list follows the drag, keeps going after the release (momentum) and lets go of the press, and pulling past the
// top rubber-bands and springs back; a drag from the left edge goes back; on Sources a left drag shows a row's
// Delete and a tap puts it away (iOS 7 and later: the full-row swipe arms, and dragged back it springs back), and a
// hold shows the row's menu. Then the device changes to another size and back with the app running, and
// window error events count as errors too, in the page and in the phone (ResizeObserver's loop warning is one).
// Last, the page is served once more sandboxed (an opaque origin, where IndexedDB's open() throws) and each mode
// checks that the phone came up on the shell's in-memory IndexedDB, Sources lists its sources and Home's tile isn't
// Add a Source.
//
// Exit 0: every run clean; 1: an error or a failed check (listed); 2: Chromium didn't start.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FULL_SWIPE_ERAS } from "../../web/app/nav/rowswipe.js";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const DEVICES = opt("--devices", "iphone-se,iphone-17-pro-max").split(",");
const THEMES = opt("--themes", "light:classic,dark:gunmetal").split(",");
const MODES = opt("--modes", "jailbreak").split(",");
const VERSION = opt("--version", "after");
const SHOTS = opt("--shots", null);
const ROUTE = opt("--route", null);
const PROBE = opt("--probe", null); // JS run in the app's frame (d: document, w: window) after each run; its value printed
const TAP = opt("--tap", "#tabbar a, #tabbar button, .tabbar a, .tabbar button");
const [VW, VH] = opt("--viewport", "1280x900").split("x").map(Number);
const DRAG = opt("--drag-route", "#/home/credits"); // a page that scrolls at every device: the mouse-as-finger checks run there ("none": skip)
const PAGE = args[0];
if (!PAGE) { console.error("usage: node tools/concept/check.mjs PAGE.html [options]"); process.exit(2); }
const CHROME = process.env.CHROMIUM ?? "chromium";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Artifact viewer's CSP, as its rules describe it: scripts from a few CDNs and inline, styles inline and from
// Google Fonts, images and media as data:/blob:, no fetch/XHR anywhere.
const CSP = ["default-src 'none'", "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com data:", "img-src data: blob:", "media-src data: blob:",
  "connect-src 'none'", "frame-src 'self' blob: data:", "worker-src blob:"].join("; ");
// /sandboxed: the same page in an opaque origin (CSP sandbox without allow-same-origin), as iPhone Safari's data: tab
// and any sandboxed viewer frame give it: IndexedDB's open() throws there (shell.js stands in for it).
const SANDBOX_CSP = CSP + "; sandbox allow-scripts allow-forms allow-popups allow-modals";
const page = await readFile(PAGE);
const stray = [];
const server = createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/?")) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP }).end(page); return; }
  if (req.url === "/sandboxed") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": SANDBOX_CSP }).end(page); return; }
  stray.push(req.url);
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const prof = await mkdtemp(join(tmpdir(), "ifizbox-concept-"));
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(CHROME, ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await sleep(300); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
if (!ws) { console.error("concept check: Chromium didn't start"); await cleanup(); process.exit(2); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); let errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "assert"))
    errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("log: " + m.params.entry.text + (m.params.entry.url ? " " + m.params.entry.url : ""));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error("eval: " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
// In an opaque origin (the /sandboxed pass) the phone's frame is cross-origin to the page (no contentDocument), so
// its body runs in the frame's own execution context: the newest default one that isn't the top frame's.
const contexts = [];
let topFrame = null, sandboxed = false;
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated" && m.params.context.auxData?.isDefault) contexts.push(m.params.context);
  if (m.method === "Runtime.executionContextDestroyed") { const i = contexts.findIndex((c) => c.id === m.params.executionContextId); if (i >= 0) contexts.splice(i, 1); }
  if (m.method === "Runtime.executionContextsCleared") contexts.length = 0;
});
const inFrame = async (body) => {
  const c = contexts.filter((x) => x.auxData.frameId !== topFrame).at(-1);
  if (!c) throw new Error("no frame context");
  const r = await send("Runtime.evaluate", { expression: `(() => { const d = document, w = window; ${body} })()`, contextId: c.id, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error("eval: " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const inApp = (body) => sandboxed ? inFrame(body) :
  ev(`(() => { const d = document.getElementById("app").contentDocument; const w = document.getElementById("app").contentWindow; ${body} })()`);
const until = async (expr, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await inApp(expr)) return true; } catch {} await sleep(150); } return false; };

await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
// window error events that reach no console (ResizeObserver's "loop completed with undelivered notifications" is one),
// in the page and in every frame
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__conceptErrors = [];
  addEventListener("error", (e) => window.__conceptErrors.push(String(e.message || e.error || "error")));` });
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(800);

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); return ok; };
// A real tap (the app's tap guard ignores el.click()): CDP mouse events at the element's centre on screen, through
// the iframe's offset and the phone's scale.
async function tap(css) {
  const at = await ev(`(() => {
    const f = document.getElementById("app"), d = f.contentDocument;
    const e = [...d.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.getClientRects().length)[0];
    if (!e) return null;
    const fr = f.getBoundingClientRect(), r = e.getBoundingClientRect(), k = fr.width / f.offsetWidth;
    return { x: fr.left + (r.left + r.width / 2) * k, y: fr.top + (r.top + r.height / 2) * k, text: e.textContent.trim().slice(0, 30) };
  })()`);
  if (!at) return null;
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  return at.text;
}
// B210: Home > a page pushed on it (Why <NAME> while its tile shows, else a link in Home's list) > the Home tab: Home
// still draws every row and group it drew before (the Why tile may go: F306 hides it once the page was opened), each
// one on the page with a height, and what's on screen at a row's centre is that row (nothing blank over it).
const HOME_ROWS = `const home = d.querySelector(".page.is-top .home"); if (!home) return null;
  const sc = home.closest(".page-body"), box = sc.getBoundingClientRect();
  // The list runs on behind the tab bar (and, on a phone with a home indicator, its inset below it): a row counts as
  // on screen only above the tab bar's top, measured, not a fixed 60 px off the list's bottom.
  const bar = [...d.querySelectorAll(".tabbar")].find((t) => t.getClientRects().length);
  const above = bar ? Math.min(box.bottom, bar.getBoundingClientRect().top) : box.bottom - 60;
  return [...home.children].filter((c) => !c.hidden && !c.matches(".why") && c.getClientRects().length && c.textContent.trim())
    .map((c) => { const r = c.getBoundingClientRect(), y = r.top + Math.min(r.height / 2, 10);
      const onScreen = r.top >= box.top && y < above;
      const hit = onScreen ? d.elementFromPoint(r.left + r.width / 2, y) : null;
      const cs = w.getComputedStyle(c), seen = cs.visibility !== "hidden" && Number(cs.opacity) > 0; // below the screen too
      return { cls: String(c.className).split(" ").slice(0, 3).join("."), h: Math.round(r.height), onScreen, painted: seen && (!onScreen || c.contains(hit)) }; });`;
async function homeRetap(name) {
  const HOME_TAB = 'a.tab[data-tab="home"]';
  await tap(HOME_TAB);
  await sleep(1200);
  await inApp(`const b = d.querySelector(".page.is-top .home")?.closest(".page-body"); if (b) b.scrollTop = 0;`);
  await sleep(300);
  const before = await inApp(HOME_ROWS);
  if (!check(Array.isArray(before) && before.length > 3, `${name}: Home draws its rows (${before?.length ?? "no Home"})`)) return;
  const pushed = await tap(".page.is-top .home .why:not([hidden]) a") ?? await tap(".page.is-top .home .home-links a.cell-inner");
  await sleep(1200);
  const away = await inApp("return w.location.hash");
  check(pushed && away.startsWith("#/home/"), `${name}: Home pushed "${pushed}" (${away})`);
  await tap(HOME_TAB);
  await sleep(1200);
  const after = await inApp(HOME_ROWS);
  const lost = (before ?? []).filter((b) => !after?.some((a) => a.cls === b.cls)).map((b) => b.cls);
  const flat = (after ?? []).filter((a) => !a.h).map((a) => a.cls);
  const blank = (after ?? []).filter((a) => !a.painted).map((a) => a.cls);  check(Array.isArray(after) && after.length === before.length && !lost.length && !flat.length && !blank.length,
    `${name}: Home tab from "${pushed}" draws all ${before.length} rows again (${after?.length ?? "no Home"}` +
    (lost.length ? `; missing ${lost.join(", ")}` : "") + (flat.length ? `; no height ${flat.join(", ")}` : "") +
    (blank.length ? `; covered ${blank.join(", ")}` : "") + ")");
}
async function set(control, value) {
  await ev(`(() => { const s = document.getElementById(${JSON.stringify(control)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change")); })()`);
}

// ---- the mouse as a finger (tools/concept/touch.js)
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
// The list showing in the phone and a pressable row in its middle, in page coordinates (through the phone's scale).
const FIND = `const f = document.getElementById("app"), d = f.contentDocument, w = f.contentWindow;
  const fr = f.getBoundingClientRect(), k = fr.width / f.offsetWidth;
  const sc = d.elementFromPoint(f.offsetWidth / 2, f.offsetHeight / 2)?.closest(".page-body");
  const toPage = (x, y) => ({ x: fr.left + x * k, y: fr.top + y * k });`;
async function fingerChecks(name) {
  await inApp(`w.location.hash = ${JSON.stringify(DRAG)}`);
  await sleep(1500);
  const at = await ev(`(() => { ${FIND}
    if (!sc) return null;
    const r = sc.getBoundingClientRect(), mid = r.top + r.height / 2;
    const row = [...sc.querySelectorAll("a.cell-inner, button.cell-inner")].map((e) => [e, e.getBoundingClientRect()])
      .filter(([, b]) => b.height && b.top > r.top + 40 && b.bottom < r.bottom - 40).sort((a, b) => Math.abs(a[1].top - mid) - Math.abs(b[1].top - mid))[0];
    if (!row) return null;
    row[0].setAttribute("data-concept-check", "");
    sc.setAttribute("data-concept-check-list", "");
    sc.scrollTop = 0;
    w.__seen = [];
    for (const t of ["pointerdown", "touchstart", "pointercancel", "click"]) d.addEventListener(t, (e) => w.__seen.push(t + ":" + (e.pointerType ?? "")), { capture: true, once: true });
    return { ...toPage(row[1].left + row[1].width / 2, row[1].top + row[1].height / 2), range: sc.scrollHeight - sc.clientHeight, hash: w.location.hash };
  })()`);
  if (!check(at && at.range > 20, `${name}: ${DRAG} has a list that scrolls (${at ? at.range + " px" : "none found"})`)) return;
  const state = () => inApp(`const row = d.querySelector("[data-concept-check]"), sc = d.querySelector("[data-concept-check-list]");
    const kid = sc.firstElementChild, m = kid ? new DOMMatrixReadOnly(getComputedStyle(kid).transform) : null;
    return { pressed: row.classList.contains("is-pressed"), active: row.classList.contains("concept-active"), top: sc.scrollTop,
      band: m ? Math.round(m.m42) : 0, seen: w.__seen.slice(), hash: w.location.hash, anyPressed: d.querySelectorAll(".is-pressed:not(.sel-ghost), .concept-active").length }`);

  // a press: the row goes down, the app saw a touch
  await mouse("mousePressed", at.x, at.y);
  await sleep(120);
  const held = await state();
  check(held.pressed && held.active, `${name}: pressing a row shows its pressed state (is-pressed ${held.pressed}, :active ${held.active})`);
  check(held.seen.includes("pointerdown:touch") && held.seen.includes("touchstart:"), `${name}: the app saw a touch (${held.seen.join(" ")})`);
  // a quick drag up: the list follows, the press lets go, and it glides on after the release
  for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", at.x, at.y - i * 12); await sleep(10); }
  await mouse("mouseReleased", at.x, at.y - 72);
  const let_ = await state();
  await sleep(900);
  const glide = await state();
  check(let_.top > 10, `${name}: the list followed the drag (scrollTop ${let_.top})`);
  check(glide.top > let_.top, `${name}: the list kept going after the release (${let_.top} -> ${glide.top})`);
  check(!let_.pressed && !let_.active && glide.anyPressed === 0, `${name}: the drag let go of the press`);
  check(glide.seen.includes("pointercancel:touch") && !glide.seen.some((s) => s.startsWith("click")) && glide.hash === at.hash,
    `${name}: a drag is no tap (${glide.seen.join(" ")}; ${glide.hash})`);
  // pulling down past the top: the content follows less and less, then springs back
  await inApp(`d.querySelector("[data-concept-check-list]").scrollTop = 0`);
  await sleep(100);
  await mouse("mousePressed", at.x, at.y);
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", at.x, at.y + i * 15); await sleep(16); }
  await sleep(100);
  const pulled = await state();
  await mouse("mouseReleased", at.x, at.y + 120);
  await sleep(1200);
  const back = await state();
  check(pulled.band > 5 && pulled.band < 120, `${name}: pulling past the top rubber-bands (${pulled.band} px for a 120 px pull)`);
  check(Math.abs(back.band) < 1 && back.hash === at.hash, `${name}: and springs back (${back.band} px)`);
  // a drag from the left edge swipes the page back (nav/swipe.js, pointer events with touch-action: none); the
  // website leaves that to Safari's own swipe (app.js webBack: the edge strip is off)
  const edge = await ev(`(() => { ${FIND} const r = sc.getBoundingClientRect(), strip = d.querySelector(".edge-swipe");
    return strip && !strip.classList.contains("off") ? toPage(r.left + 4, r.top + r.height / 2) : null; })()`);
  if (!edge) { console.log(`ok   ${name}: no edge swipe here (the website's back swipe is Safari's)`); return; }
  await mouse("mousePressed", edge.x, edge.y);
  for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", edge.x + i * 25, edge.y + i); await sleep(16); }
  await mouse("mouseReleased", edge.x + 250, edge.y + 10);
  await sleep(1000);
  const popped = await inApp("return w.location.hash");
  check(popped !== at.hash, `${name}: dragging from the left edge went back (${at.hash} -> ${popped})`);
}
// On Sources, by the era's Delete (iOS 6's red button, or the full-row swipe of FULL_SWIPE_ERAS), then holding a row
// shows the Copy URL menu (nav/menu.js longPress).
async function rowChecks(name) {
  await inApp(`w.location.hash = "#/sources"`);
  await sleep(1500);
  const rows = await ev(`(() => { ${FIND} if (!sc) return [];
    return [...sc.querySelectorAll(".source-row[data-url]")].slice(0, 3).map((li, i) => { li.setAttribute("data-concept-row", i);
      const b = li.getBoundingClientRect(); return { ...toPage(b.left + b.width * 0.6, b.top + b.height / 2), left: toPage(b.left, 0).x, right: toPage(b.right, 0).x }; }); })()`);
  if (rows.length < 3) { console.log(`ok   ${name}: no source rows to swipe here (${rows.length})`); return; }
  const row = (i, expr) => inApp(`const li = d.querySelector('[data-concept-row="${i}"]'); return ${expr}`);
  const hash = await inApp("return w.location.hash");
  if (FULL_SWIPE_ERAS.includes(await inApp(`return d.documentElement.getAttribute("data-style")`))) await fullSwipeChecks(name, rows[1], row, hash);
  else await redDeleteChecks(name, rows[1], row, hash);
  await mouse("mousePressed", rows[2].x, rows[2].y);
  await sleep(900);
  const menu = await inApp(`const m = d.querySelector(".menu"); return Boolean(m && m.getClientRects().length)`);
  await mouse("mouseReleased", rows[2].x, rows[2].y);
  await sleep(300);
  check(menu && (await inApp("return w.location.hash")) === hash, `${name}: holding a row shows its menu (and opens nothing)`);
}
// iOS 6: a left drag on a row shows its Delete (screens/sources.js), a tap on another row only puts the Delete away.
async function redDeleteChecks(name, at, row, hash) {
  await mouse("mousePressed", at.x, at.y);
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", at.x - i * 15, at.y); await sleep(16); }
  await mouse("mouseReleased", at.x - 120, at.y);
  await sleep(600);
  check(await row(1, `li.classList.contains("armed")`), `${name}: a left drag on a source row shows its Delete`);
  await tap('[data-concept-row="2"]');
  await sleep(600);
  check(!(await row(1, `li.classList.contains("armed")`)) && (await inApp("return w.location.hash")) === hash,
    `${name}: a tap on another row only puts the Delete away`);
}
// B356's full-row swipe: past half the row the red Delete strip is armed; dragged back and let go, the row springs
// back. It never lets go armed: that would remove the source, and the later runs use the same sources.
async function fullSwipeChecks(name, at, row, hash) {
  const look = () => row(1, `(() => { const back = li.querySelector(":scope > .row-swipe"), inner = li.querySelector(":scope > .cell-inner");
    return { kind: back?.dataset.kind ?? "", shown: Boolean(back?.getClientRects().length), armed: Boolean(back?.classList.contains("armed")),
      x: Math.round(new w.DOMMatrixReadOnly(w.getComputedStyle(inner).transform).m41), width: li.clientWidth }; })()`);
  const start = await look();
  const steps = 12, far = (at.right - at.left) * 0.8;
  // from near the row's right edge, so the far end stays inside the phone
  const x0 = at.left + (at.right - at.left) * 0.9;
  await mouse("mousePressed", x0, at.y);
  for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", x0 - far * i / steps, at.y); await sleep(16); }
  await sleep(100);
  const out = await look();
  check(!start.shown && out.shown && out.kind === "remove" && out.armed && out.x < -out.width / 2,
    `${name}: a left drag on a source row shows its Delete, armed past half the row (${out.x} of ${out.width} px, ${out.kind || "no strip"}${out.armed ? ", armed" : ""})`);
  for (let i = steps - 1; i >= 0; i--) { await mouse("mouseMoved", x0 - far * i / steps, at.y); await sleep(16); }
  await mouse("mouseReleased", x0, at.y);
  await sleep(800);
  const back = await look();
  check(!back.shown && back.x === 0 && (await inApp("return w.location.hash")) === hash,
    `${name}: dragged back and let go, the row springs back (${back.x} px) and opens nothing`);
}
// The device changes size with the app running, and back (frame.html loads a fresh app at the new size; resizing
// the running one set off ResizeObserver's loop warning).
async function liveResize(device) {
  const other = await ev(`[...document.getElementById("device").options].map((o) => o.value).find((v) => v !== ${JSON.stringify(device)} && !/ipad/.test(v))`);
  for (const d of [other, device]) {
    await set("device", d);
    await sleep(300);
    check(await until(`return d.querySelector(".page") && !d.getElementById("boot")`, 15000), `the app came up again after changing the device to ${d}`);
    await sleep(1000);
  }
}

const top = await ev(`({ title: document.title, theme: document.getElementById("theme").value, hasDevice: !!document.getElementById("device").options.length,
  modes: [...document.querySelectorAll("#mode button")].map((b) => b.textContent) })`);
check(top.theme.startsWith("light:"), `the page opens light (${top.theme})`);
check(top.hasDevice && top.modes.length === 3, `device and mode controls (${top.modes.join(", ")})`);
if (VERSION === "before") await ev(`document.getElementById("version-before")?.click()`);

for (const mode of MODES) {
  await ev(`document.getElementById("mode-${mode}").click()`);
  for (const device of DEVICES) {
    for (const theme of THEMES) {
      // C69: the website is iOS 6; an era theme is the apps' (jailbreak and sideload modes, the fake bridge) only
      if (mode === "site" && theme.split(":").length === 3 && !theme.startsWith("ios6:")) { console.log(`ok   ${mode}: ${theme} skipped (the website has no eras)`); continue; }
      errors = [];
      stray.length = 0;
      await set("device", device);
      // the default era's menu values have no era in front: "ios6:light:classic" is the menu's "light:classic"; a
      // value the menu hasn't got fails here rather than testing the theme the frame falls back to
      const value = await ev(`(() => { const o = [...document.getElementById("theme").options].map((x) => x.value), v = ${JSON.stringify(theme)};
        const short = v.split(":").slice(1).join(":"), def = (JSON.parse(document.getElementById("concept-meta").textContent).palettes.styles || []).find((x) => x.default);
        return o.includes(v) ? v : def && v.startsWith(def.value + ":") && o.includes(short) ? short : null; })()`);
      if (!check(value, `the Theme menu has ${theme}`)) continue;
      await set("theme", value); // reloads the app
      await ev(`document.getElementById("startpage").click()`); // from the concept's start page
      await sleep(300);
      const name = `${mode}-${device}-${theme.replaceAll(":", "-")}${VERSION === "before" ? "-before" : ""}`;
      const up = await until(`return d.querySelector(".page") && !d.getElementById("boot")`, 15000);
      check(up, `${name}: the app came up`);
      // "tone:theme" is the default era's (frame.html themeParts), "era:tone:theme" another's: the app shows the era
      // on html data-style as theme-boot.js and screens/settings.js put it there
      const want = await ev(`(() => { const v = ${JSON.stringify(theme)}.split(":"), s = (meta => (meta.palettes.styles || []).find((x) => x.default))(JSON.parse(document.getElementById("concept-meta").textContent));
        return (v.length === 2 ? (s ? s.value : "ios6") : v.shift()) + "/" + v.join(":"); })()`);
      const t = await inApp(`const e = d.documentElement; return e.getAttribute("data-style") + "/" + e.getAttribute("data-theme") + ":" + e.getAttribute("data-palette")`);
      check(t === want, `${name}: the app's style/theme is ${t}` + (t === want ? "" : ` (asked ${want})`));
      await sleep(1200);
      if (ROUTE) {
        await inApp(`w.location.hash = ${JSON.stringify(ROUTE)}`);
        await sleep(1500);
      } else {
        const before = await inApp("return w.location.hash");
        const tabs = await inApp(`return [...d.querySelectorAll(${JSON.stringify(TAP)})].length`);
        const which = await tap(`${TAP.split(",").map((s) => s.trim() + ":nth-last-child(2)").join(",")}`);
        await sleep(1500);
        const after = await inApp("return w.location.hash");
        check(tabs > 0 && which && after !== before, `${name}: tapping "${which}" in the tab bar went ${before} -> ${after}`);
      }
      await homeRetap(name);
      if (DRAG !== "none") { await fingerChecks(name); await rowChecks(name); }
      await liveResize(device);
      if (PROBE) console.log(`     probe: ${JSON.stringify(await inApp(PROBE))}`);
      for (const m of (await ev("window.__conceptErrors.splice(0)")) ?? []) errors.push("page: " + m);
      for (const m of (await inApp("return (w.__conceptErrors || []).splice(0)")) ?? []) errors.push("phone: " + m);
      if (SHOTS) {
        await mkdir(SHOTS, { recursive: true });
        const r = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
      }
      const own = await ev(`document.getElementById("errors").textContent`);
      if (own) errors.push("shell: " + own);
      check(!errors.length, `${name}: no errors` + (errors.length ? "\n      " + [...new Set(errors)].slice(0, 8).join("\n      ") : ""));
      check(!stray.length, `${name}: no requests besides the page` + (stray.length ? ": " + stray.slice(0, 5).join(" ") : ""));
    }
  }
}
// Once more in an opaque origin (/sandboxed), one run per mode at the first device and the default theme: the app
// still keeps its sources (IndexedDB refused there: B210 saw "IDBFactory.open() called in an invalid security
// context" on Sources and Add a Source on Home's tile).
topFrame = (await send("Page.getFrameTree")).result.frameTree.frame.id;
sandboxed = true;
await send("Page.navigate", { url: base + "sandboxed" });
await sleep(800);
for (const mode of MODES) {
  errors = [];
  stray.length = 0;
  const name = `sandboxed-${mode}-${DEVICES[0]}`;
  await ev(`document.getElementById("mode-${mode}").click()`);
  await set("device", DEVICES[0]);
  await ev(`document.getElementById("startpage").click()`);
  await sleep(300);
  if (!check(await until(`return d.querySelector(".page") && !d.getElementById("boot")`, 15000), `${name}: the app came up`)) continue;
  const origin = await inApp("return w.origin");
  check(origin === "null", `${name}: the phone runs in an opaque origin (${origin})`);
  const memory = await inApp("return w.indexedDB.memory");
  check(memory === true, `${name}: the shell's in-memory IndexedDB answers (${memory})`);
  await sleep(1200);
  await inApp(`w.location.hash = "#/sources"`);
  const rows = await until(`return d.querySelectorAll(".page.is-top .source-row[data-url]").length`, 10000);
  const seen = await inApp(`const t = d.querySelector(".page.is-top")?.textContent ?? ""; return { rows: d.querySelectorAll(".page.is-top .source-row[data-url]").length,
    refused: /security context|IndexedDB|IDBFactory/i.test(t) }`);
  check(rows && !seen.refused, `${name}: Sources lists its sources (${seen.rows} rows${seen.refused ? "; shows an IndexedDB refusal" : ""})`);
  await inApp(`w.location.hash = "#/home"`);
  await sleep(1500);
  const tile = await inApp(`return [...d.querySelectorAll(".page.is-top .home a, .page.is-top .home button")].map((e) => e.textContent.trim()).find((t) => /^Add a Source$/.test(t)) ?? null`);
  check(!tile, `${name}: Home's tile isn't Add a Source`);
  for (const m of (await ev("window.__conceptErrors.splice(0)")) ?? []) errors.push("page: " + m);
  for (const m of (await inApp("return (w.__conceptErrors || []).splice(0)")) ?? []) errors.push("phone: " + m);
  const own = await ev(`document.getElementById("errors").textContent`);
  if (own) errors.push("shell: " + own);
  check(!errors.length, `${name}: no errors` + (errors.length ? "\n      " + [...new Set(errors)].slice(0, 8).join("\n      ") : ""));
  check(!stray.length, `${name}: no requests besides the page` + (stray.length ? ": " + stray.slice(0, 5).join(" ") : ""));
}
await cleanup();
console.log(failures.length ? `concept check: ${failures.length} failed` : "concept check: all clean");
process.exit(failures.length ? 1 : 0);
