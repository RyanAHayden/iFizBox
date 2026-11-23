// B356 (from B332's probe): web/app as the jailbreak app in headless Chromium with a fake shell (two made-up apt
// sources, one in apt's own file, one in ifizbox.sources; two wished packages), driven with CDP touch events: the
// full-row Delete swipe on Sources and the Wish List; `myipas` runs the website (no shell) with two IPA links in
// Install IPAs. Per era and tone. Shots go to <outdir>.
//
//   node probe.mjs <web/app dir> <outdir> [ios6|ios7|ios13|ios26] [light|dark] [sources|wish|myipas]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";

const [dir, outdir, era = "ios7", tone = "light", what = "sources"] = process.argv.slice(2);
const ROOT = resolve(dir);
await mkdir(outdir, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) return res.writeHead(403).end();
  try { const body = await readFile(path); res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const prof = await mkdtemp(join(tmpdir(), "b332-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = l.find((t) => t.type === "page" && t.url === "about:blank");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
if (!ws) { console.error("no chromium"); await cleanup(); process.exit(2); }
let id = 0; const pend = new Map(); const handlers = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) for (const h of handlers) h(m); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };

// ---- the fake shell
const BRIDGE = `(() => {
  const waiting = new Map(); let next = 1;
  globalThis.__natReply = (id, ok, value) => { const w = waiting.get(id); if (!w) return; waiting.delete(id);
    if (ok) w.res(value === undefined ? null : value); else { const m = /^([a-z_]+): ([\\s\\S]*)$/.exec(value); const e = new Error(m ? m[2] : value); if (m) e.code = m[1]; w.rej(e); } };
  const call = (method, params) => new Promise((res, rej) => { const id = next++; waiting.set(id, { res, rej });
    globalThis.__nat(JSON.stringify({ id, method, params: params || {} })); });
  if (${JSON.stringify(what !== "myipas")}) {
    globalThis.ifizboxApp = true;
    globalThis.ifizboxNative = { call, jailbreak: "rootless", mode: "jailbreak",
      helper: (words) => call("helper.run", { words: [...words].map(String) }), dpkgStatus: () => call("apt.dpkgStatus") };
  }
  try {
    if (!localStorage.getItem("ifizbox.b356seeded")) {
      localStorage.setItem("ifizbox.b356seeded", "1");
      localStorage.setItem("ifizbox.wishlist", JSON.stringify(["com.test.alpha", "com.test.bravo", "com.test.delta"]));
      localStorage.setItem("ifizbox.myIpas", JSON.stringify([
        { file: "Alpha.ipa", url: "https://ipa.test.invalid/Alpha.ipa", added: 1 },
        { file: "Bravo.ipa", url: "https://ipa.test.invalid/Bravo.ipa", added: 2 }]));
    }
    localStorage.setItem("ifizbox.firstVisit", "later");
    localStorage.setItem("ifizbox.swipeHint", "1");
    localStorage.setItem("ifizbox.style", ${JSON.stringify(era)});
    localStorage.setItem("ifizbox.appearance", ${JSON.stringify(tone)});
  } catch {}
})();`;
const pkg = (p, name, ver, section = "Tweaks") => `Package: ${p}\nName: ${name}\nVersion: ${ver}\nArchitecture: iphoneos-arm64\nSection: ${section}\nDescription: ${name} for testing\nFilename: debs/${p}.deb\nSize: 1000\n`;
const PACKAGES = [pkg("com.test.alpha", "Alpha", "1.0"), pkg("com.test.bravo", "Bravo", "2.0"), pkg("com.test.charlie", "Charlie", "1.1"),
  pkg("com.test.delta", "Delta", "3.0"), pkg("com.test.echo", "Echo", "1.0")].join("\n");
const STATUS = `Package: com.test.charlie\nStatus: install ok installed\nName: Charlie\nVersion: 1.0\nArchitecture: iphoneos-arm64\nSection: Tweaks\n\n`
  + `Package: com.test.echo\nStatus: install ok installed\nName: Echo\nVersion: 1.0\nArchitecture: iphoneos-arm64\nSection: Tweaks\n`;
let removed = false;
const native = {
  "apt.sources": () => [{ path: "/var/jb/etc/apt/sources.list.d/test.list", text: "deb https://repo.test.invalid/ ./\n" },
    ...(removed ? [] : [{ path: "/var/jb/etc/apt/sources.list.d/ifizbox.sources", text: "Types: deb\nURIs: https://other.test.invalid/\nSuites: ./\n" }])],
  "apt.list": ({ name }) => (/Packages$/.test(name) ? PACKAGES : /Release$/.test(name) ? "Origin: Test Repo\nLabel: Test Repo\nSuite: stable\n" : null),
  "apt.dpkgStatus": () => STATUS,
  "apt.installDates": () => ({}),
  "apt.autoInstalled": () => [],
  "malware.scan": () => ({ packages: [], files: [] }),
  "helper.run": ({ words }) => (words[0] === "app-versions"
    ? { code: 0, stdout: "com.test.delete\t2.0\t1\t\ncom.test.keep\t1.0\t1\t\n", stderr: "" }
    : words[0] === "removesource" ? ((removed = true), { code: 0, stdout: "", stderr: "" })
    : words[0] === "uninstall-app" ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "no\n" }),
  "app.info": () => ({ version: "99.0", build: "", ios: "15.8.8", jailbreak: "rootless", mode: "jailbreak", machine: "iPhone9,1", cf: 1856.105, markers: [] }),
};
handlers.push(async (m) => {
  if (m.method === "Runtime.exceptionThrown") console.log("page exception:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]);
  if (m.method !== "Runtime.bindingCalled" || m.params.name !== "__nat") return;
  const { id: cid, method, params } = JSON.parse(m.params.payload);
  let ok = true, value = null;
  try { const h = native[method]; if (h) value = await h(params); else if (/^net\./.test(method)) throw "network: offline"; }
  catch (e) { ok = false; value = typeof e === "string" ? e : String(e); }
  await send("Runtime.evaluate", { expression: `__natReply(${cid}, ${ok}, ${JSON.stringify(value ?? null)})` });
});

await send("Page.enable"); await send("Runtime.enable");
await send("Runtime.addBinding", { name: "__nat" });
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });
await send("Page.navigate", { url: base + "#/home" });

const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(outdir, `${era}-${tone}-${n}.png`), Buffer.from(r.result.data, "base64")); };
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
const rectOf = (css, text = "") => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.offsetParent
  && x.textContent.includes(${JSON.stringify(text)}) && !x.closest('.page:not(.is-top)')).at(0); if (!e) return null; e.scrollIntoView({ block: "center" });
  const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
// A finger from the row's right part leftwards by `dist` px; `shotAt` shoots mid-drag; `lift` false keeps it down.
async function swipe(css, text, dist, { name = null, lift = true } = {}) {
  const r = await rectOf(css, text);
  if (!r) { console.log("no row", css, text); return false; }
  const y = r[1] + r[3] / 2, x0 = r[0] + r[2] - 40;
  await touch("touchStart", x0, y);
  for (let d = 6; d <= dist; d += 12) { await sleep(16); await touch("touchMove", x0 - d, y); }
  await sleep(120);
  if (name) await shot(name);
  if (lift) { await touch("touchEnd", x0 - dist, y); }
  return true;
}
const log = (...a) => console.log(`[${era} ${tone}]`, ...a);

try {
  log("home", await until("document.querySelector('#tabbar .tab') && document.querySelector('.page.is-top')", 15000));
  log("style", await ev("document.documentElement.dataset.style + ' ' + document.documentElement.dataset.theme"));
  const tapAt = async (at) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", buttons: 1, clickCount: 1 });
    await sleep(60);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", buttons: 0, clickCount: 1 });
  };
  const rowsText = (css) => ev(`[...document.querySelectorAll(${JSON.stringify(css)})].filter((x) => !x.closest('.page:not(.is-top)')).map((x) => x.querySelector('.cell-label, .pkg-name')?.textContent.trim()).join(', ')`);
  // a long swipe, then what the row shows: still there (and at rest) or gone
  const restOf = (css, text) => ev(`(() => { const r = [...document.querySelectorAll(${JSON.stringify(css)})].find((x) => !x.closest('.page:not(.is-top)') && x.textContent.includes(${JSON.stringify(text)}));
    if (!r) return 'gone'; const i = r.querySelector(':scope > .cell-inner'); return 'there transform=' + (i.style.transform || 'none') + ' swiping=' + r.classList.contains('swiping') + ' armed=' + r.classList.contains('armed'); })()`);
  async function fullSwipeChecks(css, keep, take, { failText = null } = {}) {
    await shot("list");
    await swipe(css, keep, 80, { name: "short" });
    await sleep(600);
    log("short swipe:", keep, await restOf(css, keep));
    if (failText) { // a removal the backend refuses: its alert, then the row back
      await swipe(css, failText, 280, { name: "fail-armed" });
      await sleep(900);
      await shot("fail-alert");
      log("alert", await ev("document.querySelector('.alert')?.innerText.replace(/\\n/g, ' | ') ?? 'none'"));
      const ok = await ev("(() => { const b = [...document.querySelectorAll('.alert button')].find((b) => /OK/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()");
      if (ok) await tapAt(ok);
      await sleep(900);
      log("after a refused removal:", failText, await restOf(css, failText));
    }
    await swipe(css, take, 280, { name: "armed" });
    await sleep(140); await shot("off");
    await sleep(1600);
    log("long swipe:", take, await restOf(css, take));
    log("rows now:", await rowsText(css));
    await shot("after");
  }
  if (what === "sources") {
    await ev("location.hash = '#/sources'");
    log("sources", await until("document.querySelectorAll('.page.is-top .source-row').length >= 2", 15000));
    await sleep(1200);
    log("rows:", await rowsText(".page.is-top .source-row"));
    await fullSwipeChecks(".page.is-top .source-row", "repo.test.invalid", "other.test.invalid", { failText: "repo.test.invalid" });
  }
  if (what === "wish") {
    await ev("location.hash = '#/installed/wishlist'");
    log("wish", await until("document.querySelectorAll('.page.is-top .wish-row').length >= 3", 15000));
    await sleep(1000);
    log("rows:", await rowsText(".page.is-top .wish-row"));
    await fullSwipeChecks(".page.is-top .wish-row", "Alpha", "Bravo");
    log("stored", await ev("localStorage.getItem('ifizbox.wishlist')"));
  }
  if (what === "myipas") {
    await ev("location.hash = '#/installed/myipas'");
    log("myipas", await until("document.querySelectorAll('.page.is-top .myipa-row').length >= 2", 15000));
    await sleep(1000);
    log("rows:", await rowsText(".page.is-top .myipa-row"));
    await fullSwipeChecks(".page.is-top .myipa-row", "Alpha", "Bravo");
    log("stored", await ev("localStorage.getItem('ifizbox.myIpas')"));
  }
  if (what === "all" || what === "installed") {
    await ev(`(async () => { const m = await import(${JSON.stringify(base + "core/installed.js")}); const s = await m.apps();
      await m.recordInstall(s, { id: "com.test.delete", name: "Deletable", version: "2.0" });
      await m.recordInstall(s, { id: "com.test.gone", name: "Gone App", version: "1.0" });
      await m.recordInstall(s, { id: "com.test.keep", name: "Keeper", version: "1.0" }); return "ok"; })()`);
    await ev("location.hash = '#/installed'");
    await sleep(1500);
    await ev("location.hash = document.querySelector('.page.is-top .installed-apps-row a, .page.is-top a.installed-apps-row, .page.is-top .installed-apps-row')?.getAttribute('href') ?? document.querySelector('.page.is-top .installed-apps-row a')?.getAttribute('href') ?? '#/installed/apps'");
    log("installed", await until("[...document.querySelectorAll('.page.is-top .installed-app')].length >= 3", 10000));
    await sleep(800);
    await shot("installed");
    // Remove from List: a short swipe springs back; a long one takes the row off.
    await swipe(".page.is-top .installed-app", "Gone App", 80, { name: "remove-short" });
    await sleep(500);
    log("short swipe keeps the row", await ev("!!document.querySelector('.page.is-top .installed-app[data-id=\"com.test.gone\"]')"));
    await swipe(".page.is-top .installed-app", "Gone App", 260, { name: "remove-armed" });
    await sleep(120); await shot("remove-off");
    await sleep(1200);
    log("long swipe removed Gone App", await ev("!document.querySelector('.page.is-top .installed-app[data-id=\"com.test.gone\"]')"));
    await shot("removed");
    // Delete (uninstalls): the sheet; Cancel brings the row back.
    await swipe(".page.is-top .installed-app", "Deletable", 260, { name: "delete-armed" });
    await sleep(900);
    await shot("delete-sheet");
    log("sheet", await ev("document.querySelector('.action-sheet, .action-menu')?.innerText.replace(/\\n/g,' | ') ?? 'none'"));
    log("cancel", await ev("(() => { const b = [...document.querySelectorAll('.action-button.cancel, .action-sheet button')].find(b => /Cancel/.test(b.textContent)); if (!b) return 'no cancel'; const r = b.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()").then(async (at) => {
      if (!Array.isArray(at)) return at;
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", buttons: 1, clickCount: 1 });
      await sleep(60);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", buttons: 0, clickCount: 1 });
      return "tapped";
    }));
    await sleep(900);
    log("row back after Cancel", await ev("(() => { const i = document.querySelector('.page.is-top .installed-app[data-id=\"com.test.delete\"] > .cell-inner'); return i ? (i.style.transform || 'none') + ' swiping=' + i.parentNode.classList.contains('swiping') : 'gone'; })()"));
    await shot("delete-cancelled");
  }
  if (what === "all" || what === "queue") {
    // Installed's package rows: Echo's swipe is Remove (red), Changes' Charlie row is an Upgrade (add).
    await ev("location.hash = '#/installed'");
    log("rows", await until("document.querySelectorAll('.page.is-top .pkg-row').length >= 2", 10000));
    await sleep(800);
    await swipe(".page.is-top .pkg-row", "Echo", 150, { name: "queue-remove", lift: false });
    await touch("touchCancel", 0, 0); await sleep(600);
    await ev("location.hash = '#/changes'");
    log("changes", await until("document.querySelectorAll('.page.is-top .pkg-row').length >= 1", 10000));
    await sleep(800);
    await shot("changes");
    await swipe(".page.is-top .pkg-row", "Charlie", 150, { name: "queue-add" });
    await sleep(700);
    log("undo bar", await ev("document.querySelector('.undo-bar.shown')?.innerText ?? 'none'"));
    await shot("queue-undo");
    log("undo", await ev("(() => { const b = document.querySelector('.undo-bar.shown .undo-bar-button'); if (!b) return 'none'; b.click(); return 'clicked'; })()"));
    await sleep(500);
    log("queue after undo", await ev("document.querySelector('#tabbar .tab .badge, .tab .badge')?.textContent ?? 'no badge'"));
    await swipe(".page.is-top .pkg-row", "Charlie", 150); await sleep(800);
    await swipe(".page.is-top .pkg-row", "Charlie", 150, { name: "queue-cancel", lift: false });
    await touch("touchCancel", 0, 0); await sleep(600);
  }
} finally {
  await cleanup();
}
