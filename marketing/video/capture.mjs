// The showcase video's recordings: one continuous scripted session of web/app in headless Chromium, as the sideload
// build (--mode sideload) or the jailbreak build (--mode jailbreak), at 60 fps under a virtual clock (clock.js), with
// a fake native bridge answered from a made-up world (make_state.py). Touches no phone and no network.
//
//   node capture.mjs <base url> <outdir> <script.json> --state <make_state.py dir> [--mode sideload|jailbreak]
//                    [--shots] [--upto <mark>]
//
// Writes <outdir>/<name>.mp4 (402x874 CSS px at $DPR, 2), <outdir>/<name>.json (the marks, the status bar and the
// page's look through time, the touches) and <outdir>/<name>.txt (the words on screen at every mark).
// --shots records no video: one PNG per mark and "shot" step, quickly. --upto stops after that mark.
//
// The script: { "name", "storage": {localStorage…}, "override": {module path: stubs/ file}, "liveKeyboard": true (the keyboard follows the page's focus through pauses and waits, not only after a touch), "steps": [ … ] }. Steps before { "record": true } are off the record.
//   { "mark": "name" }                 a named moment in <name>.json
//   { "pause": ms }                    the page runs, nothing is touched
//   { "until": "js", "max": ms }       the page runs until the expression is true (fails after max virtual ms)
//   { "tap": target, "hold": ms }      a finger taps it. target: a CSS selector, "text=Exact words", or [x, y];
//                                      "nth": n picks the nth visible match (-1: the last)
//   { "type": "words", "cps": n, "go": "Return key's label" }   the keyboard is up already (a tapped field raises it)
//   { "key": "return" }                taps the keyboard's return key
//   { "swipe": [[x, y], [x, y]], "ms": n, "rest": ms }   a drag; lifted moving unless rest holds it still first
//   { "world": "update" }              make_state.py's www-update is laid over www from now on
//   { "phone": "fresh" | "aging" }    the phone's Keychain starts without a certificate / Kiteline was signed 6 days ago
//   { "eval": "js" }                   off the record, logged
//   { "shot": "name" }                 with --shots: a PNG
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAME, BUNDLE_ID } from "../../web/app/brand.js";
import { bridgeSource, createShell } from "./shell.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const flag = (name) => { const i = args.indexOf(name); return i >= 0 && Boolean(args.splice(i, 1)); };
const state = opt("--state"), mode = opt("--mode", "sideload"), upto = opt("--upto"), stills = flag("--shots");
const [base, outdir, scriptFile] = args;
if (!base || !outdir || !scriptFile || !state) { console.error("node capture.mjs <base url> <outdir> <script.json> --state <dir> [--mode sideload|jailbreak] [--shots] [--upto mark]"); process.exit(2); }
const script = JSON.parse(await readFile(scriptFile, "utf8"));
const DPR = Number(process.env.DPR || 2), W = 402, H = 874, FRAME = 1000 / 60, KEYBOARD = 300;
await mkdir(outdir, { recursive: true });

// ---- Chromium over CDP
const prof = await mkdtemp(join(process.cwd(), "prof-"));
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${prof}`, "--disable-smooth-scrolling", "about:blank"], { stdio: "ignore" });
let encoder = null;
const cleanup = () => { try { chrome.kill(); } catch {} try { encoder?.kill(); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(1));
const die = (e) => { console.error(e?.stack || e); cleanup(); process.exit(1); };
process.on("uncaughtException", die);
process.on("unhandledRejection", die);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port = null;
for (let i = 0; i < 100 && !port; i++) { try { port = (await readFile(join(prof, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { await sleep(100); } }
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await once(ws, "open");
let cdp = 0;
const pend = new Map(), handlers = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pend.get(m.id)?.(m); pend.delete(m.id); } else handlers.get(m.method)?.(m.params);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++cdp; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.error || r.result.exceptionDetails) throw new Error((r.error?.message ?? r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text) + "\n  in " + expression.slice(0, 200));
  return r.result.result.value;
};

// ---- the virtual clock, one frame at a time
let now = 0, recording = false, frames = 0, encoderError = "";
const waits = [];
const vsleep = (ms) => new Promise((r) => waits.push({ at: now + ms, r }));
const log = { name: script.name, mode, fps: 60, width: W * DPR, height: H * DPR, dpr: DPR, marks: [], looks: [], touches: [] };
const at = () => Number((frames / 60).toFixed(3));
let look = "";
async function tick(dt = FRAME) {
  now += dt;
  for (const w of waits.filter((x) => x.at <= now)) { waits.splice(waits.indexOf(w), 1); w.r(); }
  // the page's style (an era, light or dark) and the words its status bar needs to be seen on
  const l = await ev(`__clock.tick(${dt}).then(() => { const d = document.documentElement; return JSON.stringify({ style: d.dataset.style ?? "ios6", theme: d.dataset.theme ?? "light" }); })`);
  if (!recording) return;
  if (l !== look) { look = l; log.looks.push({ t: at(), ...JSON.parse(l) }); }
  if (!stills) {
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 97, optimizeForSpeed: true });
    if (!encoder.stdin.write(Buffer.from(r.result.data, "base64"))) await once(encoder.stdin, "drain");
  }
  frames++;
}
async function run(ms) {
  if (stills || !recording) { for (let t = 0; t < ms; t += 50) await tick(50); return; }
  for (let n = Math.round(ms / FRAME); n > 0; n--) await tick();
}
const png = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64")); console.log("shot", name); };

// ---- the finger (finger.js draws it, tools/concept/touch.js turns the mouse into the page's touches)
const ease = (k) => k * k * (3 - 2 * k);
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? (down ? "left" : "none") : "left", buttons: down || type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "mouse" });
let down = false;
const finger = (x, y, k) => ev(`__finger.at(${x}, ${y}, ${k})`);
async function land(x, y) { for (const k of stills ? [1] : [0.2, 0.5, 0.8, 1]) { await finger(x, y, k); await tick(); } }
async function lift(x, y) { for (const k of stills ? [0] : [0.8, 0.6, 0.4, 0.2, 0.1, 0]) { await finger(x, y, k); await tick(); } }
async function press(x, y, hold) {
  log.touches.push({ t: at(), x: Math.round(x), y: Math.round(y) });
  await land(x, y);
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y); down = true;
  await run(hold);
  await mouse("mouseReleased", x, y); down = false;
  await ev("__clock.hold()");
  await lift(x, y);
}
async function drag(points, ms, rest = 0) {
  const [a, b] = points;
  log.touches.push({ t: at(), x: a[0], y: a[1], to: b });
  await land(a[0], a[1]);
  await mouse("mousePressed", a[0], a[1]); down = true;
  await tick();
  const n = Math.max(8, Math.round(ms / FRAME));
  for (let i = 1; i <= n; i++) {
    // a finger starts gently; it slows down at the end only when it is going to rest there
    const k = rest ? ease(i / n) : (i / n) ** 1.35;
    const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
    await mouse("mouseMoved", x, y); await finger(x, y, 1);
    await tick();
  }
  if (rest) await run(rest);
  await mouse("mouseReleased", b[0], b[1]); down = false;
  await ev("__clock.hold()");
  await lift(b[0], b[1]);
}

// where a target is: the nth match that can be seen and is what a finger there would touch
const FIND = (sel, nth) => `(() => {
  const sel = ${JSON.stringify(sel)}, text = sel.startsWith("text=") ? sel.slice(5) : null;
  const els = text == null ? [...document.querySelectorAll(sel)]
    : [...document.querySelectorAll("body *")].filter((e) => e.textContent.trim() === text && ![...e.children].some((c) => c.textContent.trim() === text));
  const ok = [];
  for (const e of els) {
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const x = Math.min(r.right, innerWidth) / 2 + Math.max(r.left, 0) / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    const top = document.elementFromPoint(x, y);
    if (top && (e === top || e.contains(top) || top.contains(e))) ok.push({ x, y, field: Boolean(e.closest("input, textarea") ?? e.querySelector?.("input:not([type=checkbox]), textarea")) });
  }
  return ok.at(${nth}) ?? null; })()`;
async function find(sel, nth = 0) {
  if (Array.isArray(sel)) return { x: sel[0], y: sel[1] };
  for (let i = 0; i < 90; i++) { // up to 1.5 s of the page's time: it may still be sliding in
    const p = await ev(FIND(sel, nth));
    if (p) return p;
    await tick();
  }
  await png("failed");
  throw new Error(`nothing to touch for ${JSON.stringify(sel)}; on screen:\n${await words()}`);
}
const words = () => ev(`[...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && e.offsetParent !== null).filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).map((e) => e.textContent.trim()).filter(Boolean).join(" | ")`);

// ---- the keyboard: up while a field has the focus
let kb = 0, goKey = "return", kind = "";
const typing = () => ev(`(() => { const e = document.activeElement; return Boolean(e?.matches?.("input:not([type=checkbox]):not([type=range]), textarea")); })()`);
async function keyboard() {
  const want = (await typing()) ? 1 : 0;
  if (want && kb) { // already up: the field changed (email, password, code), so the keys do
    const k = await ev(`(() => { const t = document.activeElement.type; return t === "email" ? "email" : t === "tel" ? "tel" : ""; })()`);
    if (k !== kind) { kind = k; await ev(`__finger.keyboard(1, document.documentElement.dataset.theme === "dark", ${JSON.stringify(goKey)}, ${JSON.stringify(kind)})`); }
  }
  if (want) kind = await ev(`(() => { const t = document.activeElement.type; return t === "email" ? "email" : t === "tel" ? "tel" : ""; })()`);
  if (want === kb) return;
  const n = stills ? 1 : 17;
  for (let i = 1; i <= n; i++) {
    const k = 1 - (1 - i / n) ** 3;
    await ev(`__finger.keyboard(${want ? k : 1 - k}, document.documentElement.dataset.theme === "dark", ${JSON.stringify(goKey)}, ${JSON.stringify(kind)})`);
    await tick();
  }
  kb = want;
}
async function key(c, hold = 60) {
  const p = await ev(`__finger.key(${JSON.stringify(c)})`);
  if (!p) throw new Error("no key " + c);
  const jx = (frames * 7) % 5 - 2, jy = (frames * 11) % 7 - 3; // a thumb never lands on the same spot twice
  log.touches.push({ t: at(), x: Math.round(p.x + jx), y: Math.round(p.y + jy), key: c });
  for (const k of stills ? [1] : [0.4, 0.8, 1]) { await finger(p.x + jx, p.y + jy, k); await tick(); }
  await ev(`__finger.press(${JSON.stringify(c)}, true)`);
  await run(hold);
  if (c === "return") await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }));
  else await send("Input.insertText", { text: c });
  await ev(`__finger.press(${JSON.stringify(c)}, false)`);
  for (const k of stills ? [0] : [0.5, 0.2, 0]) { await finger(p.x + jx, p.y + jy, k); await tick(); }
}
async function type(text, cps) {
  for (const [i, c] of [...text].entries()) {
    await key(c, 40);
    const gap = 1000 / cps - 40 - 6 * FRAME;
    await run(Math.max(17, gap * (0.7 + 0.15 * ((i * 5) % 5)) + (/[./]/.test(c) ? 90 : 0)));
  }
}

// ---- the page
// an icon's SVG as PNG bytes, as the phone's net.icon gives them
const raster = (svg) => ev(`new Promise((ok, no) => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 256; c.getContext("2d").drawImage(i, 0, 0, 256, 256); ok(c.toDataURL("image/png").split(",")[1]); }; i.onerror = no; i.src = ${JSON.stringify("data:image/svg+xml;base64,")} + ${JSON.stringify(Buffer.from(svg).toString("base64"))}; })`);
const shell = await createShell({ raster, state, mode, name: NAME, bundleId: BUNDLE_ID, version: process.env.APP_VERSION || "0.0", vsleep, wall: () => ev("Date.now()") });
handlers.set("Runtime.bindingCalled", async ({ name, payload }) => {
  if (name !== "__nat") return;
  const { id, method, params, stream } = JSON.parse(payload);
  const emit = (event) => (stream ? send("Runtime.evaluate", { expression: `ifizboxNative.emit(${id}, ${JSON.stringify([event])})` }) : null);
  let ok = true, value = null;
  try { value = await shell.call(method, params, emit); } catch (e) { ok = false; value = typeof e === "string" ? e : "network: " + (e?.message || e); console.log("native:", method, value); }
  send("Runtime.evaluate", { expression: `__natReply(${id}, ${ok}, ${JSON.stringify(value ?? null)})` });
});
handlers.set("Runtime.exceptionThrown", (p) => console.log("page exception:", p.exceptionDetails?.exception?.description?.split("\n").slice(0, 3).join(" ")));
handlers.set("Runtime.consoleAPICalled", (p) => { if (p.type === "error") console.log("page error:", p.args.map((a) => a.description ?? a.value).join(" ").slice(0, 300)); });
// The stylesheets get the touch look build.py's touch_css gives a concept (the same rules: :active is touch.js's
// finger, no hover, a phone's media queries); the made-up hosts are answered from the state; nothing else gets out.
const touchCss = (t) => t.replace(/:active(?![\w-])/g, ".concept-active").replace(/:hover(?![\w-])/g, ":not(*)")
  .replace(/\(\s*(?:any-)?(?:hover\s*:\s*hover|pointer\s*:\s*fine)\s*\)/g, "(max-width: 0px)")
  .replace(/\(\s*(?:any-)?(?:hover\s*:\s*none|pointer\s*:\s*coarse|hover|pointer)\s*\)/g, "(min-width: 0px)");
handlers.set("Fetch.requestPaused", async ({ requestId, request }) => {
  const u = new URL(request.url);
  const answer = (status, type, body) => send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: type }, { name: "access-control-allow-origin", value: "*" }], body: Buffer.from(body).toString("base64") });
  if (request.url.startsWith(base)) {
    if (u.pathname.endsWith(".css")) return answer(200, "text/css", touchCss(await (await fetch(request.url)).text()));
    // stand-ins for what the phone's Apple would answer: the script's "override" ({"/core/gsa.js": "gsa.js"}) serves stubs/<file> in place of a
    // module (which re-exports the real one from <path>?real), and /__video/<file> serves stubs/<file> as it is
    const stub = script.override?.[u.pathname] ?? (u.pathname.startsWith("/__video/") ? u.pathname.slice(9) : null);
    if (stub && u.search !== "?real") return answer(200, "text/javascript", await readFile(join(here, "stubs", stub)));
    if (u.pathname === "/tweak-sources.json") return answer(200, "application/json", "[]"); // a fresh install's tweak source is someone's real repo
    const thumb = /^\/appicon\/([\w-]+\.png)$/.exec(u.pathname); // what the native shell serves beside web/app
    if (thumb) { try { return await answer(200, "image/png", await readFile(join(state, "appicon", thumb[1]))); } catch { return answer(404, "text/plain", ""); } }
    return send("Fetch.continueRequest", { requestId });
  }
  if (/^(data|blob):/.test(request.url)) return send("Fetch.continueRequest", { requestId });
  const a = await shell.get(request.url);
  if (a.status === 404) console.log("not in the made-up world:", request.url);
  return answer(a.status, a.type, a.body);
});
await send("Page.enable"); await send("Runtime.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 62, bottom: 34, left: 0, right: 0 } });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await send("Runtime.addBinding", { name: "__nat" });
const inject = async (source) => send("Page.addScriptToEvaluateOnNewDocument", { source });
await inject(`try { if (!sessionStorage.getItem("rec-seeded")) { sessionStorage.setItem("rec-seeded", "1"); for (const [k, v] of Object.entries(${JSON.stringify(script.storage ?? {})})) localStorage.setItem(k, v); } } catch {}`);
await inject(await readFile(join(here, "clock.js"), "utf8"));
// (touch.js's own cursor dot is left out: there is no <head> yet, and finger.js draws the finger)
const touch = await readFile(join(here, "../../tools/concept/touch.js"), "utf8");
const DOT = "(doc.head || doc.documentElement).appendChild(style);";
if (!touch.includes(DOT)) throw new Error("tools/concept/touch.js changed: its cursor style isn't where this expects it");
await inject(touch.replace(DOT, ""));
await inject(bridgeSource(mode));
await inject(await readFile(join(here, "finger.js"), "utf8"));
await inject(await readFile(join(here, "stubs/pick.js"), "utf8"));
await send("Page.navigate", { url: base });
for (let i = 0; i < 200; i++) { await sleep(100); try { if (await ev("Boolean(globalThis.__clock && document.body)")) break; } catch {} }
// the app starts on the virtual clock, off the record
for (let i = 0; i < 240; i++) { await tick(33); if (i < 60) await sleep(20); }

async function finishVideo() {
  if (!encoder) return;
  encoder.stdin.end();
  const [code] = await once(encoder, "close");
  encoder = null;
  if (code) throw new Error("ffmpeg " + code + "\n" + encoderError);
}
const texts = [];
try {
  for (const s of script.steps) {
    if (s.record) {
      recording = true;
      if (!stills) {
        encoder = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "60", "-c:v", "mjpeg", "-i", "-",
          "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-g", "30",
          "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart",
          join(outdir, `${script.name}.mp4`)], { stdio: ["pipe", "ignore", "pipe"] });
        encoder.stderr.on("data", (d) => { encoderError += d; });
      }
    } else if (s.mark) {
      const t = await words();
      log.marks.push({ name: s.mark, t: at() });
      texts.push(`${String(at()).padStart(7)}  ${s.mark}\n         ${t}`);
      console.log("mark", s.mark, at());
      if (stills) await png(`${script.name}-${s.mark}`);
      if (upto === s.mark) break;
    } else if (s.pause) { await run(s.pause); if (script.liveKeyboard) await keyboard(); }
    else if (s.until) {
      const t0 = now;
      while (!(await ev(`Boolean(${s.until})`))) {
        if (now - t0 > (s.max ?? 15000)) { await png("failed"); throw new Error("never: " + s.until + "\n" + (await words())); }
        await (stills || !recording ? tick(50) : tick());
        if (!recording || stills) await sleep(5);
      }
      if (script.liveKeyboard) await keyboard();
    } else if (s.tap) { const p = await find(s.tap, s.nth ?? 0); await press(p.x + (s.dx ?? 0), p.y + (s.dy ?? 0), s.hold ?? 90); if (s.go) goKey = s.go; await keyboard(); }
    else if (s.type) { if (!kb) throw new Error("no field has the focus for " + s.type); await type(s.type, s.cps ?? 7); }
    else if (s.key) { await key(s.key, 90); await run(60); await keyboard(); }
    else if (s.swipe) { await drag(s.swipe, s.ms ?? 320, s.rest ?? 0); await keyboard(); }
    else if (s.world) shell.world = s.world;
    else if (s.phone) shell.phone(s.phone);
    else if (s.eval) console.log("eval:", String(JSON.stringify(await ev(s.eval))).slice(0, 3000));
    else if (s.shot) { if (stills) await png(`${script.name}-${s.shot}`); }
    else throw new Error("unknown step " + JSON.stringify(s));
  }
} finally {
  await finishVideo().catch((e) => console.error(e.message));
  log.frames = frames; log.duration = at();
  if (recording) { await writeFile(join(outdir, `${script.name}.json`), JSON.stringify(log, null, 1)); await writeFile(join(outdir, `${script.name}.txt`), texts.join("\n") + "\n"); }
}
console.log(`${script.name}: ${frames} frames, ${log.duration} s`);
ws.close(); chrome.kill(); await once(chrome, "close").catch(() => {});
await rm(prof, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
process.exit(0);
