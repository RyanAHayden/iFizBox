// The Swift side of the bridge (native/Sources/Apt.swift) in node, over a fixture tree instead of a phone, for tests
// without a device (N3; N4's queue and console reuse it). It answers the same methods with the same shapes and
// error strings, and runs native/fake/ifizbox-helper where the app runs the real helper as root.
//
//   const fx = makeFixture();                       // a scratch copy of native/fake/fixture/
//   const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: { "https://r/x": "body" } });
//   globalThis.ifizboxNative = native;                // what native/bridge.js would have set up
//   ...                                              fx.cleanup()
//
// `net`: URL -> string | { status, body, headers } for net.fetch / net.packages (a missing URL answers 404;
// net: null means offline, every request fails with "network: ..."). `env` goes to the helper (FAKE_FAIL=update).
// F63: helper.run of apply-ask gives the helper a stdin pipe, which helper.answer { answer: keep | new } writes to.
// F64: helper.cancel stops the running apply-ask (SIGKILL to its process group; exit 130 like the real helper's
// SIGINT to apt) until its first pmstatus: line.
// F59: ipa.install downloads into `ipaDir` (default: beside the prefix, ipa-cache/) and runs install-ipa there.
// F57: paid packages (native/Sources/Paid.swift): `vendors` (native/fake/fake-vendor.mjs) answer net.request,
// auth.session and paid.install's download; `device` is device.info's answer (null: MobileGestalt can't read the UDID;
// `phoneUdid` is then PhoneID's fallback, B183);
// keychain.* keep secrets in `keychain` (a Map the test can look at); paid.install downloads into `paidDir`
// (default: beside the prefix, paid-cache/) and runs install-paid there.
// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// F64/T62: SIGKILL to a detached helper's whole process group; a group already empty is fine.
function killGroup(pid) {
  try { process.kill(-pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const FAKE_HELPER = join(HERE, "ifizbox-helper");
export const FIXTURE = join(HERE, "fixture");

export function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "ifizbox-fake-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return { dir, prefix: join(dir, "prefix"), remote: join(dir, "remote"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

// F308: Paid.swift's PaidTweaks.file name, or null for a name or version it refuses.
function paidTweakFile(pkg, version) {
  if (typeof pkg !== "string" || pkg.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9+.-]*$/.test(pkg)) return null;
  if (typeof version !== "string" || version.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9.+~:_-]*$/.test(version)) return null;
  return `${pkg}_${version.replaceAll(":", "%3A")}.deb`;
}

export function createFakeNative({ prefix, remote, net = {}, env = {}, helper = FAKE_HELPER, mode = "jailbreak",
  ipaDir = join(dirname(prefix ?? "."), "ipa-cache"), vendors = [],
  device = { udid: "00008110-000A1B2C3D4E5F60", model: "iPhone14,2" }, phoneUdid = null,
  paidDir = join(dirname(prefix ?? "."), "paid-cache"), paidTweakDir = join(dirname(prefix ?? "."), "paid-tweaks") } = {}) {
  const calls = [];
  const keychain = new Map(); // F57
  let answerTo = null; // F63: the running apply-ask's stdin
  let running = null;  // F64: the running apply-ask: { child, dpkg } (dpkg: a pmstatus: line was seen)
  const fail = (msg) => Promise.reject(new Error(msg));

  function netGet(url) {
    if (net === null) return null;
    const hit = net[url];
    if (hit === undefined) return { status: 404, body: "" };
    return typeof hit === "string" ? { status: 200, body: hit } : { status: 200, body: "", ...hit };
  }

  const methods = {
    "apt.sources"() {
      const etc = join(prefix, "etc/apt");
      const out = [];
      const main = read(join(etc, "sources.list"));
      if (main != null) out.push({ path: join(etc, "sources.list"), text: main });
      const d = join(etc, "sources.list.d");
      if (existsSync(d)) {
        for (const name of readdirSync(d).sort()) {
          if (/\.(list|sources)$/.test(name)) out.push({ path: join(d, name), text: read(join(d, name)) });
        }
      }
      return out;
    },
    "apt.list"({ name }) {
      if (typeof name !== "string" || !name || name.includes("/") || name.startsWith(".")) return fail("bad_url: bad list name");
      return read(join(prefix, "var/lib/apt/lists", name));
    },
    "apt.dpkgStatus": () => read(join(prefix, "var/lib/dpkg/status")),
    // F350: Apt.swift packageFiles: the paths var/lib/dpkg/info/<id>[:arch].list names, "/." left out; null without one.
    "apt.files"({ id }) {
      if (typeof id !== "string" || !id || id.includes("/") || id.startsWith(".")) return fail("bad_url: bad package id");
      const dir = join(prefix, "var/lib/dpkg/info");
      let text = read(join(dir, `${id}.list`));
      if (text == null && existsSync(dir)) {
        const name = readdirSync(dir).find((n) => n.startsWith(`${id}:`) && n.endsWith(".list"));
        if (name) text = read(join(dir, name));
      }
      return text == null ? null : text.split("\n").filter((l) => l && l !== "/.");
    },
    // F104: Apt.swift installDates: { package: mtime seconds } of var/lib/dpkg/info/<pkg>[:arch].list.
    "apt.installDates"() {
      const dir = join(prefix, "var/lib/dpkg/info");
      const out = {};
      if (!existsSync(dir)) return out;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".list")) continue;
        const pkg = name.slice(0, -5).split(":")[0];
        if (pkg) out[pkg] = Math.max(out[pkg] ?? 0, Math.round(statSync(join(dir, name)).mtimeMs / 1000));
      }
      return out;
    },
    // F130: Apt.swift autoInstalled: the names var/lib/apt/extended_states marks Auto-Installed: 1, sorted; null
    // without the file.
    "apt.autoInstalled"() {
      const text = read(join(prefix, "var/lib/apt/extended_states"));
      if (text == null) return null;
      const out = new Set();
      for (const stanza of text.replace(/\r\n/g, "\n").split("\n\n")) {
        let pkg = "", auto = false;
        for (const line of stanza.split("\n")) {
          const i = line.indexOf(":");
          if (i < 0) continue;
          const key = line.slice(0, i).trim().toLowerCase(), value = line.slice(i + 1).trim();
          if (key === "package") pkg = value; else if (key === "auto-installed") auto = value === "1";
        }
        if (auto && pkg) out.add(pkg);
      }
      return [...out].sort();
    },
    "net.fetch"({ url }) {
      if (!/^https?:\/\//i.test(url ?? "")) return fail("bad_url: not an http(s) URL");
      const r = netGet(url);
      if (!r) return fail("network: The Internet connection appears to be offline.");
      return { status: r.status, headers: r.headers ?? {}, body: Buffer.from(r.body).toString("base64") };
    },
    "net.packages"({ dir }) {
      for (const name of ["Packages.xz", "Packages.gz", "Packages"]) {
        const r = netGet(dir + name);
        if (!r) return fail("network: The Internet connection appears to be offline.");
        if (r.status < 400 && name === "Packages") return { text: r.body, source: dir + name };
      }
      return fail(`not_found: no Packages index in ${dir}`);
    },
    "helper.run"({ words, stream }, onEvent) {
      // Like Helper.run in Apt.swift: no helper at its path, or one that can't start, is a "helper:" error.
      if (!existsSync(helper)) return fail(`helper: ifizbox-helper is not installed at ${helper}`);
      return new Promise((resolve, reject) => {
        const child = spawn(helper, words, {
          env: { PATH: process.env.PATH, IFIZBOX_PREFIX: prefix, FAKE_REMOTE: remote, IFIZBOX_IPA_DIR: ipaDir,
            IFIZBOX_PAID_DIR: paidDir, ...env },
          // F63: apply-ask gets a stdin pipe for helper.answer, as Helper.run in Apt.swift gives it.
          stdio: [words[0] === "apply-ask" ? "pipe" : "ignore", "pipe", "pipe", "pipe"],
          detached: true, // F64: its own process group, so Cancel's signal reaches a sleep in the fake too
        });
        const run = words[0] === "apply-ask" ? { child, dpkg: false } : null;
        if (run) running = run;
        if (child.stdin) {
          child.stdin.on("error", () => {}); // an answer after the helper ended
          answerTo = child.stdin;
        }
        const text = { out: "", err: "" };
        const pending = { out: "", err: "", status: "" };
        const feed = (fd) => (chunk) => {
          const s = chunk.toString("utf8");
          if (fd !== "status") text[fd] += s;
          if (!stream || !onEvent) return;
          const lines = (pending[fd] + s).split("\n");
          pending[fd] = lines.pop();
          if (run && fd === "status" && lines.some((l) => /^pm(status|conffile|error):/.test(l))) run.dpkg = true;
          for (const line of lines) onEvent({ fd, line });
        };
        child.stdout.on("data", feed("out"));
        child.stderr.on("data", feed("err"));
        child.stdio[3].on("data", feed("status"));
        child.on("error", (e) => reject(new Error(`helper: can't start ifizbox-helper: ${e.message}`)));
        child.on("close", (code, signal) => {
          if (child.stdin) { if (answerTo === child.stdin) answerTo = null; child.stdin.destroy(); }
          if (running === run) running = null;
          // A helper killed by a signal: 128 + its number, as Helper.run reports it.
          // F64: a cancelled run is 130, apt-get's 128 + SIGINT through the real helper.
          if (code == null && signal) code = run?.cancelled ? 130 : 128 + (osConstants.signals[signal] ?? 0);
          if (stream && onEvent) for (const fd of ["out", "err", "status"]) if (pending[fd]) onEvent({ fd, line: pending[fd] });
          resolve({ code: code ?? 128, stdout: text.out, stderr: text.err });
        });
      });
    },
    // F63: like Helper.answer in Apt.swift: keep -> "N", new -> "Y" on the running apply-ask's stdin.
    "helper.answer"({ answer }) {
      const line = { keep: "N\n", new: "Y\n" }[answer];
      if (!line) return fail("helper: answer is keep or new");
      if (!answerTo) return fail("helper: no install is waiting for an answer");
      answerTo.write(line);
      return true;
    },
    // F64: like Helper.cancel in Apt.swift, while apt still downloads. The real helper turns the "C" line into SIGINT
    // for apt-get (after resetting every signal to its default); here the fake helper's process group gets SIGKILL,
    // since a test runner started in the background leaves SIGINT ignored in its children, and SIGTERM (which a
    // process can block, catch or ignore) once let the fake's sleep outlive its shell under load (T62).
    "helper.cancel"() {
      if (!running) return fail("helper: no install is running");
      if (running.dpkg) return fail("helper: dpkg is already installing; it can't be stopped halfway");
      running.cancelled = true;
      killGroup(running.child.pid);
      return true;
    },
    // F59: like IPAInstall.run in Apt.swift: download as <UUID>.ipa into ipaDir, ifizbox-helper install-ipa, remove
    // the download; the helper's exit code picks the error code.
    // B113: an http link fetches its https twin instead (port 80 dropped), and with none answers "insecure: …";
    // insecure: true (Install Anyway) fetches the http link itself, as IPAInstall.fetchHTTP does.
    async "ipa.install"({ url, stream, insecure }, onEvent) {
      if (mode !== "jailbreak") return fail("sideload: the sideload build installs IPAs through signing.install");
      if (!/^https?:\/\//i.test(url ?? "")) return fail("bad_url: not an http(s) URL");
      mkdirSync(ipaDir, { recursive: true, mode: 0o700 });
      if (stream && onEvent) onEvent({ fd: "status", line: "dlstatus:ipa:0:Downloading" });
      let r;
      if (/^http:/i.test(url) && insecure !== true) {
        const twin = new URL(url);
        twin.protocol = "https:";
        if (twin.port === "80") twin.port = "";
        r = netGet(twin.href);
        if (!r) return fail("network: The Internet connection appears to be offline.");
        if (r.status >= 400) return fail(`insecure: ${twin.hostname} offers this IPA only over plain http, without encryption`);
      }
      r ??= netGet(url);
      if (!r) return fail("network: The Internet connection appears to be offline.");
      if (r.status >= 400) return fail(`not_found: HTTP ${r.status} for ${url}`);
      const path = join(ipaDir, `${randomUUID().toUpperCase()}.ipa`);
      writeFileSync(path, Buffer.from(r.body));
      let res;
      try {
        res = await call("helper.run", { words: ["install-ipa", path], stream }, onEvent);
      } finally {
        rmSync(path, { force: true });
      }
      if (res.code === 0) {
        const id = res.stdout.split("\n").filter((l) => l.startsWith("Installed ")).pop();
        return { code: 0, stdout: res.stdout, stderr: res.stderr, bundleId: id ? id.slice(10) : "" };
      }
      const why = res.stderr.split("\n").filter((l) => l.startsWith("ifizbox-helper: ")).pop();
      const kind = { 64: "bad_ipa", 69: "no_adhoc", 77: "helper" }[res.code] ?? "install";
      return fail(`${kind}: ${why ? why.slice(16) : `ifizbox-helper exited with ${res.code}`}`);
    },
    // F57: like Paid.swift. net.request: https only, GET or POST, body a string; the answer's body is base64.
    "net.request"({ method = "GET", url, headers, body }) {
      if (!/^https:\/\//i.test(url ?? "")) return fail("bad_url: not an https URL");
      const m = String(method).toUpperCase();
      if (m !== "GET" && m !== "POST") return fail(`bad_url: method ${m}`);
      if (net === null) return fail("network: The Internet connection appears to be offline.");
      let r;
      for (const v of vendors) if ((r = v.handle({ method: m, url, headers: headers ?? {}, body: m === "POST" ? body ?? null : null }))) break;
      r ??= m === "GET" ? netGet(url) : { status: 404, body: "" };
      return { status: r.status, headers: r.headers ?? {}, body: Buffer.from(r.body ?? "").toString("base64") };
    },
    "device.info"() {
      // B183: MobileGestalt (`device.udid`) first, then PhoneID's UDID (`phoneUdid`: pairing or the embedded profile's
      // single device), as Paid.deviceUDID does.
      const udid = device?.udid || phoneUdid;
      if (!udid) {
        return fail(mode === "jailbreak" ? "device: can't read this iPhone's UDID (MobileGestalt refused UniqueDeviceID)"
          : "device: this iPhone's UDID isn't known: pair this iPhone (Settings > Installation & Signing > This iPhone > Pairing) and try again");
      }
      return { udid, model: device?.model ?? "iPhone14,2" };
    },
    "keychain.get"({ key }) {
      if (!key) return fail("keychain: no key");
      return keychain.get(key) ?? null;
    },
    "keychain.set"({ key, value }) {
      if (!key) return fail("keychain: no key");
      if (typeof value === "string") keychain.set(key, value); else keychain.delete(key);
      return true;
    },
    "keychain.remove"({ key }) {
      if (!key) return fail("keychain: no key");
      keychain.delete(key);
      return true;
    },
    // The sheet "loads" the URL: a vendor's sign-in page or payment page ends at its callback; null is the user
    // closing the sheet (ASWebAuthenticationSessionError.canceledLogin).
    "auth.session"({ url, callbackScheme = "sileo" }) {
      if (!/^https:\/\//i.test(url ?? "")) return fail("bad_url: not an https URL");
      if (!/^[a-z][a-z0-9+.-]*$/.test(callbackScheme) || ["http", "https", "file", "ifizbox"].includes(callbackScheme)) {
        return fail("bad_url: bad callback scheme");
      }
      for (const v of vendors) {
        const cb = v.authenticate(url) ?? v.completePayment?.(url);
        if (cb) return cb.startsWith(callbackScheme + ":") ? cb : null;
      }
      return null;
    },
    // F308: like Paid.swift's PaidTweaks: the one-time .deb kept in `paidTweakDir` as <package>_<version>.deb (older
    // versions of that package go), in both builds.
    "paid.download"({ url, package: pkg, version }) {
      if (!/^https:\/\//i.test(url ?? "")) return fail("bad_url: not an https URL");
      const file = paidTweakFile(pkg, version);
      if (!file) return fail("bad_url: not a package name or version");
      if (net === null) return fail("network: The Internet connection appears to be offline.");
      let r;
      for (const v of vendors) if ((r = v.download(url))) break;
      r ??= netGet(url);
      if (r.status >= 400) return fail(`not_found: HTTP ${r.status} for the download`);
      const data = Buffer.from(r.body ?? "");
      if (data.length > 64 << 20) return fail("too_large: more than 64 MB");
      if (!data.subarray(0, 8).equals(Buffer.from("!<arch>\n"))) return fail("not_found: the vendor's download is not a .deb");
      mkdirSync(paidTweakDir, { recursive: true });
      for (const old of readdirSync(paidTweakDir)) if (old.startsWith(`${pkg}_`)) rmSync(join(paidTweakDir, old), { force: true });
      writeFileSync(join(paidTweakDir, file), data);
      return { body: data.toString("base64") };
    },
    "paid.cached"({ package: pkg, version }) {
      const file = paidTweakFile(pkg, version);
      if (!file) return fail("bad_url: not a package name or version");
      const data = existsSync(join(paidTweakDir, file)) ? readFileSync(join(paidTweakDir, file)) : null;
      return data && data.subarray(0, 8).equals(Buffer.from("!<arch>\n")) ? { body: data.toString("base64") } : null;
    },
    async "paid.install"({ url, package: pkg, version, stream }, onEvent) {
      if (mode !== "jailbreak") return fail("sideload: paid packages install with the jailbreak build");
      if (!/^https:\/\//i.test(url ?? "")) return fail("bad_url: not an https URL");
      if (!pkg || !version) return fail("helper: no package or version");
      if (net === null) return fail("network: The Internet connection appears to be offline.");
      mkdirSync(paidDir, { recursive: true, mode: 0o700 });
      if (stream && onEvent) onEvent({ fd: "status", line: `dlstatus:${pkg}:0:Downloading` });
      let r;
      for (const v of vendors) if ((r = v.download(url))) break;
      r ??= netGet(url);
      if (r.status >= 400) return fail(`not_found: HTTP ${r.status} for the download`);
      if (!String(r.body).startsWith("!<arch>\n")) return fail("not_found: the vendor's download is not a .deb");
      const path = join(paidDir, `${randomUUID().toUpperCase()}.deb`);
      writeFileSync(path, Buffer.from(r.body));
      try {
        return await call("helper.run", { words: ["install-paid", path, pkg, version], stream }, onEvent);
      } finally {
        rmSync(path, { force: true });
      }
    },
  };

  async function call(method, params = {}, onEvent) {
    // F287: the screen's keep-awake switch (native/Sources/KeepAwake.swift) goes to `awake`, not `calls`, so tests
    // that list a run's calls see only the work
    if (method === "app.keepAwake") { awake.push(Boolean(params?.on)); return null; }
    calls.push({ method, params });
    const m = methods[method];
    if (!m) throw new Error(`unknown method ${method}`);
    const v = await m(params, onEvent);
    return v === undefined ? null : v;
  }

  const awake = []; // F287: each app.keepAwake { on } in order
  return {
    calls,
    awake,
    keychain,
    call,
    emit() {},
    helper: (words, onEvent) => call("helper.run", { words, stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: () => call("apt.dpkgStatus"),
  };
}
