// B409 shots: the shared .deb's Cannot Comply when the helper refuses, per era; from B404's probe.
//   node shots.mjs <web/app dir> <outdir>
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
  ["com.ex.violaWhite", "Viola White with quite a long theme name", "1.8"], ["com.ex.new", "New Tweak", "2.0"], ["com.ex.new", "New Tweak", "1.0"],
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
  "helper.run": async ({ words }) => {
    calls.push(words.join(" "));
    if (words[0] !== "simulate") return { code: 0, stdout: "", stderr: "" };
    if (MODE === "asking") await sleep(60000);
    const bad = words.some((w) => w.startsWith("com.ex.violaWhite"));
    if (MODE === "helper" && bad) return { code: 64, stdout: "", stderr: "ifizbox-helper: bad package name (allowed: [a-z0-9][a-z0-9.+-]+)\n" };
    if (MODE === "refused" && bad) return { code: 100, stdout: "The following packages have unmet dependencies:\n com.ex.violaWhite : Depends: com.ex.gone but it is not installable\n", stderr: "E: Unable to correct problems, you have held broken packages.\n" };
    return { code: 0, stdout: "Inst com.ex.new (2.0 Test [iphoneos-arm64])\n", stderr: "" };
  },
  "share.debSimulate": () => { throw new Error(MODE === "missing" ? "ifizbox-helper is not installed at /var/jb/usr/libexec/ifizbox-helper" : "ifizbox-helper: the calling process isn't the installed app"); },
  "apps.isInstalled": ({ bundleIds }) => ({ installed: Object.fromEntries((bundleIds || []).map((b) => [b, false])) }),
  "app.info": () => ({ version: "0.9.8", build: "", ios: "26.0", jailbreak: "rootless", mode: "jailbreak", machine: "iPhone9,1", cf: 1856.105, markers: [] }),
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
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Runtime.addBinding", { name: "__nat" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const press = async (x, y, ms) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(ms);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

let MODE = "refused";
await send("Page.navigate", { url: base }); await sleep(2500);
for (const era of ["ios6", "ios7", "ios13", "ios26"]) for (const theme of ["light", "dark"]) for (const mode of ["refused", "missing"]) {
  MODE = mode;
  await ev(`localStorage.setItem("ifizbox.style", "${era}"); localStorage.setItem("ifizbox.appearance", "${theme}")`);
  await send("Page.navigate", { url: base + "?r=" + (++id) }); await sleep(3000);
  await ev(`(() => { import("./screens/sharedeb.js").then((m) => m.openDebConfirm({ file: "x.deb", name: "com.ex.quitelongtweak_1.2.3_iphoneos-arm64.deb" })); })()`);
  await sleep(1800);
  console.log(era, theme, mode, await ev(`(() => { const s = document.querySelector(".confirm-sheet"); const d = s.querySelector(".pkg-description"); return s.innerText.replace(/\\n+/g, " | ") + " cut=" + (d.scrollWidth > d.clientWidth + 1) + " style=" + document.documentElement.dataset.style; })()`));
  await shot(`${era}-${theme}-${mode}`);
}
console.log("page errors:", errors);
await done(0);
