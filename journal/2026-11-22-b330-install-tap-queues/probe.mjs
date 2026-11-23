// B330 probe: web/app as the jailbreak app in headless Chromium with a fake bridge (one local source, two packages:
// com.ex.new not installed, com.ex.old installed). Checks the package page's nav button: tap and hold.
//   node probe.mjs <web/app dir> <outdir>
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, normalize, extname, resolve } from "node:path";

const [ROOTARG, OUT] = process.argv.slice(2);
const ROOT = resolve(ROOTARG);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const b = await readFile(path); res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(b); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const PACKAGES = [
  ["com.ex.new", "New Tweak", "2.0"], ["com.ex.new", "New Tweak", "1.0"],
  ["com.ex.old", "Old Tweak", "2.0"], ["com.ex.old", "Old Tweak", "1.0"],
].map(([p, n, v]) => `Package: ${p}\nName: ${n}\nVersion: ${v}\nArchitecture: iphoneos-arm64\nSection: Tweaks\nFilename: debs/${p}_${v}.deb\nSize: 1000\nDescription: test package\nAuthor: Test\n`).join("\n");
const STATUS = "Package: com.ex.old\nStatus: install ok installed\nName: Old Tweak\nVersion: 1.0\nArchitecture: iphoneos-arm64\nSection: Tweaks\nDescription: test package\n";
const RELEASE = "Origin: Test Repo\nLabel: Test Repo\nSuite: stable\n";

const prof = await mkdtemp(join(OUT, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = async (code) => { try { chrome.kill(); } catch {} server.close(); await sleep(300); await rm(prof, { recursive: true, force: true }); process.exit(code); };
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const handlers = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) for (const h of handlers) h(m); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

const BRIDGE = `(() => {
  const waiting = new Map(); let next = 1;
  globalThis.__natReply = (id, ok, value) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); if (ok) w.res(value ?? null); else w.rej(new Error(value)); };
  const call = (method, params) => new Promise((res, rej) => { const id = next++; waiting.set(id, { res, rej }); globalThis.__nat(JSON.stringify({ id, method, params: params || {} })); });
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { call, jailbreak: "rootless", mode: "jailbreak", emit() {},
    helper: (words) => call("helper.run", { words: [...words].map(String) }), dpkgStatus: () => call("apt.dpkgStatus") };
  try { localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}
})();`;
const calls = [];
const native = {
  "apt.sources": () => [{ path: "/var/jb/etc/apt/sources.list.d/test.list", text: "deb http://repo.test/ ./\n" }],
  "apt.list": ({ name }) => (name.endsWith("_Packages") ? PACKAGES : /Release$/.test(name) ? RELEASE : null),
  "apt.dpkgStatus": () => STATUS,
  "apt.installDates": () => ({}),
  "apt.autoInstalled": () => [],
  "malware.scan": () => ({ packages: [], files: [] }),
  "helper.run": ({ words }) => { calls.push(words.join(" ")); return { code: 0, stdout: "", stderr: "" }; },
  "apps.isInstalled": ({ bundleIds }) => ({ installed: Object.fromEntries((bundleIds || []).map((b) => [b, false])) }),
  "app.info": () => ({ version: "0.9.8", build: "", ios: "15.8.8", jailbreak: "rootless", mode: "jailbreak", machine: "iPhone9,1", cf: 1856.105, markers: [] }),
};
handlers.push(async (m) => {
  if (m.method !== "Runtime.bindingCalled" || m.params.name !== "__nat") return;
  const { id: cid, method, params } = JSON.parse(m.params.payload);
  let ok = true, value = null;
  try { const h = native[method]; if (h) value = await h(params); } catch (e) { ok = false; value = String(e?.message || e); }
  await send("Runtime.evaluate", { expression: `__natReply(${cid}, ${ok}, ${JSON.stringify(value ?? null)})` });
});
const errors = [];
handlers.push((m) => { if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description?.split("\n")[0]); });

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Runtime.addBinding", { name: "__nat" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const button = () => ev(`(() => { const bs = [...document.querySelectorAll(".nav-item button, button")].filter((b) => b.offsetParent && /^(Install|Modify)$/.test(b.textContent.trim()));
  const b = bs.at(-1); if (!b) return null; const r = b.getBoundingClientRect(); return { label: b.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const press = async (x, y, ms) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(ms);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
// What's open after the gesture: the action sheet's title/buttons, and whether the Confirm sheet is up.
const state = () => ev(`(() => {
  const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden";
  const sheetBtns = [...document.querySelectorAll(".action-sheet button, .actionsheet button, [class*=action-sheet] button")].filter(vis).map((b) => b.textContent.trim());
  const sheetTitle = [...document.querySelectorAll("[class*=action-sheet] [class*=title]")].filter(vis).map((e) => e.textContent.trim()).join(" ");
  const confirm = [...document.querySelectorAll("button, h1, h2, [class*=title]")].filter(vis).some((b) => b.textContent.trim() === "Confirm");
  return { sheetTitle, sheetBtns, confirm, hash: location.hash };
})()`);
const reset = async (hash) => { await send("Page.navigate", { url: base + "?r=" + (++id) + hash }); await sleep(5000); };

const results = [];
const check = (name, ok, got) => { results.push({ name, ok, got }); console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(got)); };

await send("Page.navigate", { url: base }); await sleep(4000);
const key = await ev(`(async () => { for (let i = 0; i < 40; i++) { const a = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") || ""); const h = a.find((x) => /sources\\/[^/]*repo\\.test/.test(x)); if (h) return h; if (i === 39) return a.join(" "); location.hash = "#/sources"; await new Promise((r) => setTimeout(r, 300)); } return null; })()`);
console.log("sources link:", key);
const srcKey = key ? decodeURIComponent(key.replace(/^#\/sources\//, "").split("/")[0]) : null;
const pageHash = (pkg) => `#/sources/${encodeURIComponent(srcKey)}/package:${pkg}`;

for (const [pkg, want] of [["com.ex.new", "Install"], ["com.ex.old", "Modify"]]) {
  for (const gesture of ["tap", "hold"]) {
    await reset(pageHash(pkg));
    const b = await button();
    if (!b) { check(`${pkg} ${gesture}: button found`, false, await ev("document.body.innerText.slice(0, 400)")); continue; }
    if (gesture === "tap") await shot(`${pkg}-page`);
    check(`${pkg}: button says ${want}`, b.label === want, b.label);
    const before = calls.length;
    await press(b.x, b.y, gesture === "tap" ? 80 : 900);
    await sleep(1500);
    const s = await state();
    await shot(`${pkg}-${gesture}`);
    if (want === "Install" && gesture === "tap") check("Install tap: Confirm opens, no options sheet", s.confirm && !s.sheetBtns.includes("Add to Wish List"), s);
    if (want === "Install" && gesture === "hold") check("Install hold: options sheet (Wish List, Other Versions), no Confirm", !s.confirm && s.sheetBtns.includes("Add to Wish List"), s);
    if (want === "Modify" && gesture === "tap") check("Modify tap: Modify sheet (Remove)", s.sheetBtns.includes("Remove") && !s.confirm, s);
    if (want === "Modify" && gesture === "hold") check("Modify hold: Install Which Version?", /Which Version/.test(s.sheetTitle + " " + s.sheetBtns.join(" ")) || s.sheetBtns.some((x) => /\(Installed\)/.test(x)), s);
    console.log("helper calls:", calls.slice(before));
  }
}
console.log("page errors:", errors);
await done(results.every((r) => r.ok) && results.length === 8 ? 0 : 1);
