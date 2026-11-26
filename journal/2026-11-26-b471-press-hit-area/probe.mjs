#!/usr/bin/env node
// B471 probe: Home in headless Chromium as the jailbreak app (fake bridge), each era. For every pixel of the nav
// bar's About and of each Home tile, 15 px around included, it compares the control iOS's WebKit would click there
// with the one app.js marks pressed for a touch pointerdown there; with --touch it also holds real CDP touches at
// each control's corners, edge midpoints and just outside, and reads whether .is-pressed is on it while held.
//
//   node journal/2026-11-26-b471-press-hit-area/probe.mjs [web/app dir] [--touch]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const TOUCH = args.includes("--touch");
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(args.find((a) => !a.startsWith("--")) ?? join(here, "../../web/app"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2" };
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
const prof = await mkdtemp(join(tmpdir(), "ifizbox-b471-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++nextId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });

// The controls: About (the nav bar's left button) and every Home tile, with the box a person sees as the control:
// the bar button's own box, and for a tile the box of its table (or its cell in a split pair).
const CONTROLS = `(() => {
  const page = document.querySelector('.page.is-top') ?? document;
  const out = [];
  const about = [...document.querySelectorAll('.bar-button')].find((b) => b.textContent.trim() === 'About' && b.getClientRects().length);
  if (about) out.push({ name: 'About', sel: 'about', box: about.getBoundingClientRect().toJSON() });
  page.querySelectorAll('a.home-tile').forEach((a, i) => {
    if (!a.getClientRects().length || a.closest('[hidden]')) return;
    const vis = a.closest('.home-pair') ? a.closest('li') : a.closest('ul');
    out.push({ name: a.textContent.trim().slice(0, 24), sel: i, box: vis.getBoundingClientRect().toJSON(), own: a.getBoundingClientRect().toJSON() });
  });
  return out;
})()`;
const PRESSABLE = /const PRESSABLE = "([^"]+)"/.exec(await readFile(join(ROOT, "app.js"), "utf8"))[1];

const eras = ["ios6", "ios7", "ios13", "ios26"];
let gaps = 0, unmarked = 0;
for (const era of eras) {
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("ifizbox.style", ${JSON.stringify(era)}); window.ifizboxNative = { jailbreak: "rootless", call: async () => null };` });
  await send("Page.navigate", { url: base + "?era=" + era + "#/home" }); // a new query: a hash-only change doesn't reload
  await sleep(2500);
  await ev("setInterval(() => document.querySelectorAll('.banner').forEach((b) => b.remove()), 200), 1");
  const style = await ev("document.documentElement.dataset.style");
  const controls = await ev(CONTROLS);
  console.log(`\n== ${era} (data-style ${style}): ${controls.length} controls`);
  for (const c of controls) {
    // Every point of the control's box and 15 px around it: the control iOS's WebKit clicks there (written here from
    // WebCore's LocalFrame::qualifyingNodeAtViewportLocation, on its own: the document listens for clicks, so the
    // element under the finger qualifies as the document unless a link/button holds it, and then the diagonal steps
    // run), against what app.js marks for a touch pointerdown there (a synthetic PointerEvent at the same point).
    // "opens, unmarked" is the bug; "marked, opens other" would be a wrong look.
    const cmp = await ev(`(() => {
      const PRESS = ${JSON.stringify(PRESSABLE)}, CLICK = "a[href], button, input, select, textarea, label";
      const qual = (n) => n?.closest(CLICK) ?? document;
      const pick = (x, y) => {
        const q = qual(document.elementFromPoint(x, y));
        if (q !== document) return q;
        for (const [dx, dy] of [[-.3, -.3], [-.6, -.6], [.3, .3], [-.9, -.9]]) {
          const t = document.elementFromPoint(x + Math.trunc(dx * 15), y + Math.trunc(dy * 15));
          if (t && qual(t) !== document) return qual(t);
        }
        return null;
      };
      const b = ${JSON.stringify(c.box)};
      const ctl = ${c.sel === "about" ? `[...document.querySelectorAll('.bar-button')].find((x) => x.textContent.trim() === 'About')` : `(document.querySelector('.page.is-top') ?? document).querySelectorAll('a.home-tile')[${c.sel}]`};
      const out = { opens: 0, unmarked: [], wrong: [] };
      for (let y = Math.ceil(b.top - 15); y < b.bottom + 15; y++) for (let x = Math.ceil(b.left - 15); x < b.right + 15; x++) {
        const opens = pick(x, y);
        const t = document.elementFromPoint(x, y);
        if (!t) continue;
        t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerType: "touch", isPrimary: true, pointerId: 7 }));
        const marked = document.querySelector(".is-pressed:not(.sel-ghost)");
        t.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch", isPrimary: true, pointerId: 7 }));
        document.querySelectorAll(".is-pressed:not(.sel-ghost)").forEach((e) => e.classList.remove("is-pressed"));
        if (opens === ctl) { out.opens++; if (marked !== ctl) out.unmarked.push([x, y]); }
        else if (marked === ctl) out.wrong.push([x, y]);
      }
      const few = (a) => ({ n: a.length, at: a.filter((_, i) => i % Math.max(1, Math.floor(a.length / 4)) === 0).slice(0, 4) });
      return { opens: out.opens, unmarked: few(out.unmarked), wrong: few(out.wrong) };
    })()`);
    if (cmp.unmarked.n || cmp.wrong.n) gaps++;
    const box = (r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    console.log(`${cmp.unmarked.n || cmp.wrong.n ? "BAD " : "ok  "} ${c.name.padEnd(24)} box ${box(c.box)}  opens at ${cmp.opens} px; opens unmarked ${JSON.stringify(cmp.unmarked)}; marked, opens other ${JSON.stringify(cmp.wrong)}`);
    if (!TOUCH) continue;
    // Real CDP touches, held: 2 px in from each corner and edge midpoint, then 3 px below and right of its middle
    // (the first diagonal step brings both back inside, so WebKit opens it there too).
    const b = c.box, xs = [b.left + 2, (b.left + b.right) / 2, b.right - 2], ys = [b.top + 2, (b.top + b.bottom) / 2, b.bottom - 2];
    const pts = [...ys.flatMap((y) => xs.map((x) => [x, y])), [(b.left + b.right) / 2, b.bottom + 3], [b.right + 3, (b.top + b.bottom) / 2]];
    const bad = [];
    for (const [x, y] of pts) {
      if (x >= 390 || y >= 844) continue;
      await touch("touchStart", x, y);
      await sleep(40);
      const held = await ev(`(() => { const p = document.querySelector('.is-pressed'); return p ? p.className : null; })()`);
      await send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await sleep(200);
      if (!held) bad.push([Math.round(x), Math.round(y)]);
    }
    if (bad.length) unmarked++;
    console.log(`     held touch at corners/edges and just outside: ${bad.length ? "NOT PRESSED at " + JSON.stringify(bad) : `pressed at all ${pts.length}`}`);
  }
}
console.log(`\n${gaps} control(s) where the pressed look and WebKit's pick differ${TOUCH ? `, ${unmarked} with an unpressed held touch` : ""}`);
chrome.kill(); server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(gaps || unmarked ? 1 : 0);
