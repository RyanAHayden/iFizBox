#!/usr/bin/env node
// B387 on the iPhone 15 Pro: the native iOS 26 tab bar still shrinks after a cancelled swipe back. Run from the repo root,
// as phone.mjs: node .../tabbar.mjs <cdp port> <base|lock>; shots go to ref/15/screens/b387-*.
const [port, mode] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const p = list.find((t) => /ifizbox:/.test(t.url)) ?? list[0];
if (!p) { console.error("no page", list); process.exit(1); }
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const ev = (expression) => new Promise((r, j) => { const i = ++id; const t = setTimeout(() => j(new Error("eval timed out")), 15000); pend.set(i, (d) => { clearTimeout(t); d.result?.wasThrown || d.result?.exceptionDetails ? j(new Error(JSON.stringify(d))) : r(d.result?.result?.value); }); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true } })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = "http://127.0.0.1:8100";
let sid = (await (await fetch(W + "/status")).json()).sessionId;
if (!sid) sid = (await (await fetch(W + "/session", { method: "POST", body: '{"capabilities":{}}' })).json()).value.sessionId;
// path: [[x, y, ms], ...] in points
const finger = (idn, path) => ({ type: "pointer", id: idn, parameters: { pointerType: "touch" }, actions: path.flatMap(([x, y, ms], i) => (i ? [{ type: "pointerMove", duration: ms, x, y }] : [{ type: "pointerMove", duration: 0, x, y }, { type: "pointerDown" }])).concat({ type: "pointerUp" }) });
const go = async (...fs) => { const r = await (await fetch(`${W}/session/${sid}/actions`, { method: "POST", body: JSON.stringify({ actions: fs }) })).json(); if (r.value?.error) console.error(r.value.error, r.value.message); };

const TOP = `[...document.querySelectorAll(".tab-stack.is-active > .page")].slice(-2)`;
const bodies = `${TOP}.map((p) => p.querySelector(".page-body"))`;
await ev(`(() => { location.hash = "#/home/settings"; })()`); await sleep(1500);
await ev(`(() => { location.hash = "#/home/settings/logs"; })()`); await sleep(1800);
console.log("at", await ev("location.hash"), await ev("navigator.userAgent"), await ev(`document.documentElement.className`));
await ev(`(() => {
  if (window.__b387) window.__b387.stop = true;
  const s = window.__b387 = { log: [], on: false, frames: [] };
  const b = ${bodies};
  window.__b = b;
  b.forEach((x) => { if (!x.querySelector(".b387")) { const d = document.createElement("div"); d.className = "b387"; d.style.cssText = "height:3000px;background:repeating-linear-gradient(#cde 0 50px,#fff 50px 100px)"; x.append(d); } x.scrollTop = 400; });
  const note = (e) => s.on && s.log.push([Math.round(e.timeStamp), e.type, e.cancelable, Math.round(e.changedTouches[0].clientX), Math.round(e.changedTouches[0].clientY)]);
  if (!window.__b387L) { window.__b387L = 1; for (const t of ["touchstart", "touchmove", "touchend", "touchcancel"]) document.addEventListener(t, (e) => window.__note(e), { passive: true, capture: true });
    new MutationObserver(() => window.__mut?.()).observe(document.getElementById("screens"), { subtree: true, attributes: true, attributeFilter: ["class"] }); }
  window.__note = note;
  window.__mut = () => {
    const mv = !!document.querySelector(".page.is-moving");
    if (mv === s.mv) return;
    s.mv = mv; s.log.push([Math.round(performance.now()), mv ? "BEGIN" : "REST"]);
    if (${JSON.stringify(mode)} === "lock") b.forEach((x) => { x.style.overflowY = mv ? "hidden" : ""; });
  };
  let last = performance.now();
  const f = (now) => { if (s.stop) return; if (s.on) s.frames.push([Math.round(now - last), ...b.map((x) => Math.round(x.scrollTop * 10) / 10)]); last = now; requestAnimationFrame(f); };
  requestAnimationFrame(f);
})()`);
const run = async (name, ...fs) => {
  await ev(`window.__b.forEach((x) => { x.scrollTop = 400; })`); await sleep(400);
  await ev(`(() => { const s = window.__b387; s.log = []; s.frames = []; s.on = true; })()`);
  await go(...fs);
  await sleep(1500);
  const r = JSON.parse(await ev(`(() => { const s = window.__b387; s.on = false; return JSON.stringify({ log: s.log, frames: s.frames, hash: location.hash, tops: window.__b.map((x) => x.scrollTop) }); })()`));
  const a = r.frames.map((f) => f[1]), b = r.frames.map((f) => f[2]), dt = r.frames.map((f) => f[0]);
  const kinds = r.log.reduce((m, l) => ((m[l[1]] = (m[l[1]] ?? 0) + 1), m), {});
  const cancelable = r.log.filter((l) => l[1] === "touchmove").map((l) => +l[2]).join("");
  console.log(`\n${mode} ${name}: ${r.hash}\n  below scrollTop ${Math.min(...a)}..${Math.max(...a)}, top ${Math.min(...b)}..${Math.max(...b)}, end ${r.tops}\n  events ${JSON.stringify(kinds)} cancelable ${cancelable.slice(0, 40)}\n  frames ${dt.length}, slowest ${[...dt].sort((x, y) => y - x).slice(0, 4)} ms, median ${[...dt].sort((x, y) => x - y)[dt.length >> 1]}`);
  const bi = r.log.findIndex((l) => l[1] === "BEGIN");
  if (bi >= 0) console.log("  begin after", JSON.stringify(r.log.slice(Math.max(0, bi - 2), bi + 2)));
  if (!r.hash.endsWith("/logs")) { await ev(`location.hash = "#/home/settings/logs"`); await sleep(1500); }
};
// after a cancelled diagonal swipe, does the iOS 26 tab bar still shrink as the page scrolls? (shots by the caller's command)
const { execSync } = await import("node:child_process");
const shot = (n) => console.log(execSync(`tools/ui-15.sh B387 shot b387-${mode}-${n}`, { encoding: "utf8" }).trim());
const flick = (y0, y1) => finger("a", [[200, y0, 0], [205, y1, 250]]);
console.log("style", await ev("localStorage.getItem('ifizbox.style')"));
shot("rest"); await run("flick first", flick(650, 350)); shot("scrolled-before");
await run("flick up", flick(350, 650)); shot("back-up");
await run("diagonal, cancelled", finger("a", [[120, 300, 0], [240, 400, 400], [130, 480, 500], [130, 480, 200]]));
shot("after-cancel"); await run("flick after", flick(650, 350)); shot("scrolled-after");
// committed: the page below's scroller is followed too
await ev(`window.__b.forEach((x) => { x.scrollTop = 400; })`); await go(flick(350, 450)); await sleep(800);
await go(finger("a", [[120, 300, 0], [380, 500, 300]])); await sleep(1500);
console.log("committed:", await ev("location.hash")); await go(flick(650, 350)); await sleep(1200); shot("committed-scrolled");
await ev(`(() => { window.__b387.stop = true; window.__mut = null; window.__note = () => {}; for (const x of document.querySelectorAll(".b387")) x.remove(); window.__b.forEach((x) => { x.style.overflowY = ""; x.scrollTop = 0; }); })()`);
process.exit(0);
