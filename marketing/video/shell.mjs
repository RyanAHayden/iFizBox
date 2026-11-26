// The fake native shell of the recordings (capture.mjs): native/bridge.js's shape in the page, its calls answered
// here in Node from make_state.py's made-up world, like the Swift shell does. Every wait is on the recording's
// virtual clock (vsleep). A call it has no answer for answers null, and is logged once.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const bridgeSource = (mode) => `(() => {
  const waiting = new Map(), streams = new Map(); let next = 1;
  const root = () => document.documentElement?.setAttribute("data-shell", "app"); // App.swift, in both builds
  root(); new MutationObserver((_, o) => { if (document.documentElement) { root(); o.disconnect(); } }).observe(document, { childList: true });
  globalThis.__natReply = (id, ok, value) => { const w = waiting.get(id); if (!w) return; waiting.delete(id); streams.delete(id);
    if (ok) w.res(value === undefined ? null : value); else { const m = /^([a-z_]+): ([\\s\\S]*)$/.exec(value); const e = new Error(m ? m[2] : value); if (m) e.code = m[1]; w.rej(e); } };
  const call = (method, params, onEvent) => new Promise((res, rej) => { const id = next++; waiting.set(id, { res, rej });
    if (onEvent) streams.set(id, onEvent); globalThis.__nat(JSON.stringify({ id, method, params: params || {}, stream: Boolean(onEvent) })); });
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { call, jailbreak: ${JSON.stringify(mode === "jailbreak" ? "rootless" : null)}, mode: ${JSON.stringify(mode)},
    emit(id, events) { const f = streams.get(id); if (f) for (const e of events) { try { f(e); } catch (x) { console.error(x); } } },
    helper: (words, onEvent) => call("helper.run", { words: [...words].map(String), stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: () => call("apt.dpkgStatus") };
})();`;

const TYPES = { json: "application/json", svg: "image/svg+xml", png: "image/png" };

export async function createShell({ raster, state, mode, name, bundleId, version, vsleep, wall }) {
  const b64 = (x) => Buffer.from(x).toString("base64");
  const readText = async (p) => { try { return await readFile(join(state, p), "utf8"); } catch { return null; } };
  const shell = { world: "" };
  shell.get = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/sign/status") return { status: 200, type: "application/json", body: Buffer.from('{"ok":true,"ttl":600,"worker":true,"zsign":false}') };
    if (u.pathname === "/api/tweaks.json") return { status: 200, type: "application/json", body: Buffer.from('{}') };
    if (u.hostname === "api.canister.me" || u.hostname === "itunes.apple.com") return { status: 200, type: "application/json", body: Buffer.from('{"status":200,"refs":{"nextPage":null},"count":0,"data":[],"resultCount":0,"results":[]}') };
    // the app's own AltStore source (the Worker serves the released web/app/source.json there) and its icons
    if (u.pathname === "/repo/source.json") return { status: 200, type: "application/json", body: await readFile(new URL("../../web/app/source.json", import.meta.url)) };
    if (u.pathname === "/repo/Packages") return { status: 200, type: "text/plain", body: Buffer.from(`Package: ${bundleId}\nName: ${name}\nVersion: ${version}\nArchitecture: iphoneos-arm64\nSection: Packaging\nMaintainer: ${name}\nDescription: Packages and apps with the iOS 6 look\nFilename: ./x.deb\nSize: 2600000\n`) };
    if (/^\/repo\/\w+Icon(@\dx)?\.png$/.test(u.pathname)) return { status: 200, type: "image/png", body: await readFile(new URL("../../web/app/icons/icon-180.png", import.meta.url)) };
    const own = /\/(icons\/[\w-]+\.png)$/.exec(u.pathname);
    if (own && !u.hostname.endsWith(".example")) { try { return { status: 200, type: "image/png", body: await readFile(new URL("../../web/app/" + own[1], import.meta.url)) }; } catch {} }
    for (const top of shell.world ? [`www-${shell.world}`, "www"] : ["www"]) {
      for (const p of [u.pathname, u.pathname + ".svg", ...(u.pathname.endsWith("/") ? [u.pathname + "apps.json"] : []), ...(u.pathname === "/" || u.pathname === "" ? ["/apps.json"] : [])]) {
        try { const body = await readFile(join(state, top, u.hostname, p)); return { status: 200, type: TYPES[p.split(".").pop()] ?? "text/plain", body }; } catch {}
      }
    }
    return { status: 404, type: "text/plain", body: Buffer.from("") };
  };
  const inDays = async (n) => new Date((await wall()) + n * 86400e3).toISOString();
  // ---- the Lite phone: a certificate, This iPhone paired, nothing installed yet
  const signed = new Map();
  const prepared = new Map();
  const NAMES = { tidewell: "Tidewell", kiteline: "Kiteline" };
  // the promo clip's world ({"world": "aging"}): a free certificate signs for 7 days, and Kiteline was signed 6 days ago
  const aging = () => { if (shell.world === "aging" && !signed.has("example.demo.kiteline")) signed.set("example.demo.kiteline", { name: "Kiteline", bundleId: "example.demo.kiteline", version: "1.8", expires: 1 }); };
  const days = () => (shell.world === "aging" ? 7 : 300);
  const steps = async (emit, phase, ms, from = 0) => { for (let t = 0; t <= ms; t += 100) { emit?.({ phase, progress: from + (1 - from) * Math.min(1, t / ms) }); await vsleep(100); } };
  // ---- the jailbroken phone
  let status = null;
  const dpkg = async () => (status ??= (await readText("var/lib/dpkg/status")) ?? "");
  const added = []; // sources.list.d files written since
  const field = (s, k) => new RegExp(`^${k}: (.+)$`, "m").exec(s)?.[1];
  async function available() {
    const out = new Map();
    for (const host of await readdir(join(state, "www"))) for (const s of ((await readText(`www/${host}/Packages`)) ?? "").split("\n\n")) if (field(s, "Package")) out.set(field(s, "Package"), s.trim());
    return out;
  }
  async function helper(words, emit) {
    const [verb, ...items] = words;
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (verb === "addsource") { // <uri> <suite> [component...]
      added.push({ path: "/var/jb/etc/apt/sources.list.d/ifizbox.sources", text: `Types: deb\nURIs: ${items[0]}\nSuites: ${items[1]}\n${items.length > 2 ? `Components: ${items.slice(2).join(" ")}\n` : ""}` });
      return ok();
    }
    if (verb === "update" || verb === "update-source") { await vsleep(900); return ok(); }
    const all = await available(), have = new Map((await dpkg()).split("\n\n").map((s) => [field(s, "Package"), field(s, "Version")]));
    const plan = items.filter((w) => !w.startsWith("--")).map((w) => { const [id] = w.split("="); return { id, s: all.get(id), v: field(all.get(id) ?? "", "Version") ?? "1.0", had: have.get(id) }; });
    if (verb === "simulate") return ok(plan.map((p) => (p.had ? `Inst ${p.id} [${p.had}] (${p.v} Lamplight [iphoneos-arm64])` : `Inst ${p.id} (${p.v} Lamplight [iphoneos-arm64])`)).join("\n") + `\nNeed to get ${(plan.length * 48).toFixed(1)} kB of archives.\n`);
    if (verb === "showhold") return ok();
    console.log("helper: no fake for", words.join(" "));
    return ok();
  }
  // dpkg's lines for one .deb, as ifizbox-helper install-deb-ask streams them
  async function installDeb(file, emit) {
    const s = (await available()).get(file), name = field(s, "Name"), v = field(s, "Version");
    const line = async (fd, text, ms) => { emit?.({ fd, line: text }); await vsleep(ms); };
    await line("out", `Selecting previously unselected package ${file}.`, 150);
    await line("out", `Preparing to unpack ${file}_${v}_iphoneos-arm64.deb ...`, 200);
    await line("status", `pmstatus:${file}:33.3333:Unpacking ${name}`, 350);
    await line("out", `Unpacking ${file} (${v}) ...`, 250);
    await line("status", `pmstatus:${file}:66.6667:Configuring ${name}`, 300);
    await line("out", `Setting up ${file} (${v}) ...`, 300);
    await line("status", `pmstatus:${file}:100.0000:Installed ${name}`, 200);
    status = (await dpkg()).trimEnd() + "\n\n" + s.replace("\n", "\nStatus: install ok installed\n") + "\n";
    return { code: 0, stdout: "", stderr: "" };
  }
  const native = {
    async "share.debFetch"({ url }, emit) {
      for (let t = 0; t <= 900; t += 60) { emit?.({ progress: t / 900 }); await vsleep(60); }
      return { file: /\/([^/_]+)_[^/]*$/.exec(url)[1] };
    },
    "share.debInstall": ({ file }, emit) => installDeb(file, emit),
    "share.discard": () => null,
    async "net.icon"({ url }) {
      const r = await shell.get(url);
      if (r.status !== 200) throw "not_found: HTTP 404";
      return { type: "image/png", body: r.type === "image/png" ? b64(r.body) : await raster(r.body.toString("utf8")) };
    },
    "app.info": () => ({ version, build: "", ios: mode === "jailbreak" ? "16.5" : "26.0", jailbreak: mode === "jailbreak" ? "rootless" : null, mode,
      machine: mode === "jailbreak" ? "iPhone14,7" : "iPhone17,1", cf: 2000, markers: [] }),
    async "net.fetch"({ url }) { const r = await shell.get(url); await vsleep(350); if (r.status === 404) console.log("not in the made-up world:", url); return { status: r.status, headers: { "content-type": r.type }, body: b64(r.body) }; },
    "net.request": (p) => native["net.fetch"](p),
    async "net.packages"({ dir }) {
      const r = await shell.get(dir + "Packages"); await vsleep(350);
      if (r.status !== 200) throw "not_found: no Packages index in " + dir;
      return { text: r.body.toString("utf8"), source: dir + "Packages" };
    },
    // the Lite build
    "signing.status": async () => (mode === "jailbreak" ? null : { mode: "sideload", identity: { name: "Apple Development: Demo Team (DEMO123456)", team: "DEMO123456", expires: await inDays(300),
      profile: { name: "Demo Wildcard", team: "Demo Team", appId: "DEMO123456.*", devices: 3, wildcard: true, expires: await inDays(300), device: { listed: true } } } }),
    "signing.installed": async () => (aging(), { apps: await Promise.all([...signed.values()].map(async (a) => ({ ...a, expires: await inDays(a.expires) }))) }),
    "signing.checkCertificate": () => ({ status: "good" }),
    "signing.remind": () => ({ ok: true }),
    async "signing.prepare"({ url, record, tweaks }, emit) {
      if (record) { // a Re-sign from the phone's record: the same app, a fresh signature, the tweaks it now has
        const a = signed.get(record);
        await steps(emit, "signing", 700);
        prepared.set("t-" + record, { ...a, expires: days(), tweaks: tweaks?.names ?? a.tweaks });
        return { token: "t-" + record, bundleId: a.bundleId, name: a.name, version: a.version, expires: await inDays(days()) };
      }
      const [, slug, v] = /\/([a-z]+)-([\d.]+)\.ipa/.exec(url ?? "") ?? [];
      const total = v === "2.4.0" ? 18_900_000 : 18_400_000; // make_state.py's sizes
      for (let t = 0; t <= 1200; t += 100) { emit?.({ phase: "downloading", progress: t / 1200, bytes: Math.round(total * t / 1200), total, rate: 10_200_000 }); await vsleep(100); }
      await steps(emit, "signing", 700);
      const id = `example.demo.${slug}`, name = NAMES[slug] ?? slug;
      prepared.set("t-" + slug, { name, bundleId: id, version: v, expires: days(), ...(tweaks?.names ? { tweaks: tweaks.names } : {}) });
      return { token: "t-" + slug, bundleId: id, name, version: v, expires: await inDays(days()) };
    },
    "idevice.status": () => ({ paired: "rp", vpn: { available: true, tested: true } }),
    "idevice.pairing": () => ({ paired: "rp" }),
    "idevice.verify": () => ({ ok: true, paired: "rp" }),
    async "signing.open"({ token }, emit) {
      await steps(emit, "copying", 700);
      await steps(emit, "installing", 1000);
      const a = prepared.get(token);
      signed.set(a.bundleId, a);
      return { installed: true, bundleId: a.bundleId, name: a.name };
    },
    "signing.cancel": () => null,
    "apps.isInstalled": ({ bundleIds }) => ({ installed: Object.fromEntries((bundleIds ?? []).map((b) => [b, signed.has(b)])) }),
    "push.status": () => ({ mode: "sideload", bundleId, environment: "production", authorization: "denied" }),
    "app.notifyStatus": () => ({ backgroundOn: true, badges: true, alerts: true, backgroundRefresh: true }),
    "updates.watch": () => ({ ok: true }),
    "library.list": () => ({ identity: mode !== "jailbreak", ipas: [] }),
    // the jailbreak build
    async "apt.sources"() {
      const d = "etc/apt/sources.list.d", out = [];
      for (const n of (await readdir(join(state, d))).sort()) out.push({ path: `/var/jb/${d}/${n}`, text: await readText(`${d}/${n}`) });
      return out.concat(added);
    },
    "apt.list": () => null,
    "apt.dpkgStatus": dpkg,
    "apt.installDates": () => ({}),
    "apt.autoInstalled": () => [],
    "malware.scan": () => ({ packages: [], files: [] }),
    "helper.run": ({ words }, emit) => helper(words, emit),
  };
  if (mode !== "jailbreak") for (const k of Object.keys(native)) if (/^(apt\.|helper\.|malware)/.test(k)) delete native[k];
  const unknown = new Set();
  shell.call = async (method, params, emit) => {
    if (native[method]) return native[method](params ?? {}, emit);
    if (!unknown.has(method)) { unknown.add(method); console.log("native: no fake for", method, JSON.stringify(params).slice(0, 160)); }
    return null;
  };
  return shell;
}
