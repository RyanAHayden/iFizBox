// B446 check: the real web/app in Chromium as the jailbreak app, over native/fake (whose helper refuses a package apt
// has no lists for). Adds a source in Sources > Add, then opens its package, Install, and confirms: no Refresh.
//   node journal/2026-11-24-b446-added-apt-source/check.mjs [web/app dir]      SPDX-License-Identifier: GPL-3.0-or-later
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";

const ROOT = resolve(process.argv[2] ?? "web/app") + "/";
const CHROME = process.env.CHROMIUM ?? "chromium";
const PKG = "Package: com.one.tweak\nVersion: 1\nName: One Tweak\nSection: Tweaks\nArchitecture: iphoneos-arm64\nFilename: a.deb\nSize: 1\nDescription: x\n";
const fx = makeFixture();
process.on("exit", fx.cleanup);
const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: { "https://one.test/Packages": PKG,
  "https://one.test/Release": "Origin: One\nArchitectures: iphoneos-arm64\n" } });

const SHIM = `<script>
(function (g) {
  function withCode(msg) { const m = /^([a-z_]+): ([\\s\\S]*)$/.exec(msg); const e = new Error(m ? m[2] : msg); if (m) e.code = m[1]; return e; }
  async function call(method, params, onEvent) {
    const r = await fetch("/call", { method: "POST", body: JSON.stringify({ method, params: params || {}, stream: Boolean(onEvent) }) });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.event) { try { onEvent && onEvent(m.event); } catch (e) { console.error(e); } }
        else if ("result" in m) return m.result;
        else if (m.error) throw withCode(m.error);
      }
      if (done) throw new Error("network: bridge closed");
    }
  }
  g.ifizboxApp = true;
  g.ifizboxNative = { call, emit() {}, mode: "jailbreak", jailbreak: "rootless",
    helper: (words, onEvent) => call("helper.run", { words: [...words].map(String), stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: () => call("apt.dpkgStatus") };
})(globalThis);
</script>`;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    const { method, params, stream } = JSON.parse(body);
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    try {
      const result = await native.call(method, params, stream ? (event) => res.write(JSON.stringify({ event }) + "\n") : undefined);
      res.end(JSON.stringify({ result: result ?? null }) + "\n");
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }) + "\n");
    }
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
  if (!path || path.endsWith("/")) path += "index.html";
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let data = readFileSync(file);
  if (path === "index.html") data = data.toString().replace("<head>", "<head>" + SHIM);
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(data);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// --- Chromium over CDP ---------------------------------------------------------------------------------------------
const prof = await mkdtemp(join(tmpdir(), "ifizbox-b446-"));
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


await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", platform: "iPhone" });
const runs = () => native.calls.filter((c) => c.method === "helper.run").map((c) => c.params.words.join(" "));
const clickText = (text, scope = "body") => ev(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(scope)})].flatMap((s) => [...s.querySelectorAll("button, a, [role=button]")])
  .filter((b) => b.offsetParent && b.textContent.trim().startsWith(${JSON.stringify(text)})); const b = all.pop(); b?.click(); return Boolean(b); })()`);
const seen = () => ev(`[...new Set([...document.querySelectorAll("button, a, .alert, .sheet")].filter((b) => b.offsetParent).map((b) => b.textContent.trim().slice(0, 70)))].join(" | ")`);
const shot = async (name) => { const r = await send("Page.captureScreenshot"); writeFileSync(join(process.env.SHOTS ?? tmpdir(), `b446-${name}.png`), Buffer.from(r.result.data, "base64")); };
const say = async (name) => { console.log(`== ${name}\n   helper: ${runs().join("; ") || "-"}`); if (process.env.SHOTS) await shot(name); if (process.env.V) console.log("   " + await seen()); };
const until = async (f, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await f()) return true; return false; };

await send("Page.navigate", { url: base + "#/sources" });
await sleep(3500);
await ev(`document.querySelectorAll(".banner").forEach((b) => b.remove())`);
// Launch refresh (if any) is over before the add
await until(async () => !(await ev("globalThis.ifizboxRefreshing")));
// only now: the fake launch update copies every remote list
writeFileSync(join(fx.remote, "lists", "one.test_._Packages"), PKG);
const before = runs().length;
await say("start");
console.log("Add:", await clickText("Add", ".navbar, .nav-bar, header, body"));
await sleep(700);
await ev(`(() => { const i = document.querySelector(".alert input"); i.value = "https://one.test/"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
console.log("Add Source:", await clickText("Add Source", ".alert"));
await sleep(900);
console.log("Unknown Source sheet, Add Source:", await clickText("Add Source"));
await until(() => runs().slice(before).some((w) => w.startsWith("update")), 5000);
await sleep(1500);
await say("added");
await ev(`location.hash = "#/sources/" + encodeURIComponent("deb:https://one.test/:./") + "/" + encodeURIComponent("package:com.one.tweak")`);
await sleep(2500);
await say("package");
console.log("Install:", await clickText("Install", ".page.is-top, .navbar, .nav-bar, body"));
await sleep(2500);
await say("confirm");
console.log(await ev("document.body.innerText.match(/Cannot Comply|doesn.t know [^ ]+ yet|Confirm/g)?.join(', ')"));
console.log("Confirm:", await clickText("Confirm"));
await sleep(4000);
await say("done");
const ok = /Package: com\.one\.tweak/.test(await native.call("apt.dpkgStatus"));
console.log(ok ? "PASS: installed, no Refresh" : "FAIL: not installed");
if (pageErrors.length) console.log("page errors:", pageErrors);
await cleanup();
process.exit(ok ? 0 : 1);
