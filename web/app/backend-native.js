// App backend (N3): the same calls as backend-http.js, answered by the Swift shell instead of the site's proxy.
// The shell injects `globalThis.ifizboxNative` before any module runs (native/bridge.js); this file only needs its
// `call(method, params, onEvent)`, which resolves with the Swift handler's reply (native/Sources/Apt.swift):
//
//   apt.sources                 -> [{ path, text }]  sources.list, sources.list.d/*.list and *.sources
//   apt.list { name }           -> text | null       a file in apt's lists directory (after apt-get update)
//   apt.dpkgStatus              -> text | null       dpkg's status file
//   apt.files { id }            -> [path] | null     an installed package's files, from dpkg's info/<id>.list (F350)
//   net.fetch { url }           -> { status, headers, body }   body base64; the shell fetches (no CORS, no proxy)
//   net.packages { dir }        -> { text, source }  Packages.xz, .gz or plain in dir, decompressed by the shell
//   helper.run { words, stream } -> { code, stdout, stderr }  ifizbox-helper <words> as root; stream events
//                                  { fd: "out" | "err" | "status", line } while it runs
//   apps.isInstalled { bundleIds } -> { installed: { id: bool | null } }  appsInstalled(ids), cached (F219)
//
// The install queue (N4, jailbreak build only: the sideload build has no helper): queue(job) marks a package in the
// app's one queue (queue.js), which opens the Confirm sheet (screens/queue.js); simulate(jobs) is `apt-get -s` over
// it, apply(jobs, onEvent) runs it with the console streaming, respring() restarts SpringBoard. All through
// ifizbox-helper's simulate | apply | respring verbs (native/helper/README.md).
// F64: cancelApply() stops a running apply before dpkg starts (helper.cancel).
// F131: a job with `debUrl` (its Filename is a full URL, which apt joins to the repo's URL and 404s on) is downloaded
// by the shell (share.debFetch) and run through ifizbox-helper simulate-deb / install-deb (share.debSimulate,
// share.debInstall: native/share/App/ShareBridge.swift), before apt's apply over the rest (linkedDebs below).
// F133: the job's debSha256 / debMd5 (its Packages stanza's, screens/queue.js) go to share.debFetch, which checks the
// download (apt would have); a mismatch is a Cannot Comply sentence, and nothing is installed.
//
// Roll Back (F71, jailbreak build): rollbacks(id) lists the .debs N7's daemon kept when automatic updates replaced
// a version (ifizbox-helper rollbacks), [{ version, file }] newest first; rollback(id, version, onEvent) installs one
// (ifizbox-helper rollback: apt-get install of the stored file, downgrades allowed), streaming like apply.
//
// I4 (jailbreak build): appVersions() is every installed app's real version, read by the helper from installd's
// containers (ifizbox-helper app-versions: Info.plist, App Store apps' iTunesMetadata), [{ id, version, build, store }],
// or null when it can't be read (no helper, an older one). installedApps(records) is the apps iFizBox remembers
// (core/installed.js) with that version in place of the remembered one, and a note where the two disagree
// (withRealVersions). The sideload build has neither: no helper, so the remembered version stays.
//
// Errors from the shell come as "<code>: <message>" (bridge.js turns them into errors with a `code`); here they
// become BackendError with the same codes the proxy uses (network, timeout, too_large, upstream, not_found, ...).
//
// Sources: the list is apt's (core/aptsources.js), so what the app shows is what apt installs from. Refresh runs
// `apt-get update` through the helper first, then reads each source's Release and Packages from apt's lists
// directory, falling back to the network for anything apt has no list for. A source added in iFizBox is checked
// like on the site, then written into apt's own sources through the helper (F33: `ifizbox-helper addsource`, which
// edits only sources.list.d/ifizbox.sources), so apt-get update and installs use it too. Only where the helper
// can't be run (not installed) is it kept on the device alone (IndexedDB, `added: true`); refreshSources moves such
// records into ifizbox.sources once it can. Removing works for ifizbox.sources' sources; apt's other files are left
// to the user. Counts, origin and refresh times of every source are kept in IndexedDB.
import { freshUrl } from "./core/sources.js";
import { BackendError } from "./backend-http.js";
import { verifySource, refreshSource, openSourceStore, sortSources, loadTweakSources } from "./core/sources.js";
import { sourceCalls, loadInjectSources } from "./core/sources.js"; // F302
import { countInjectable } from "./core/tweakfields.js"; // F302; C32: the small module, not core/tweaks.js
import { parseAptSources, listNamesFor } from "./core/aptsources.js";
import { healthFields } from "./core/health.js";
import { DEFAULT_ARCH, compareVersions } from "./core/apt.js";
import { withAltSources } from "./core/altstore.js";
import { detectMode } from "./core/settings.js";
import { queueWords, parseSimulation, mergePlans } from "./core/queue.js";
import { installQueue } from "./queue.js";
import { NAME } from "./brand.js";
import { encodeUrl } from "./core/urlencode.js";
import { reviewsApi, reviewsBase } from "./core/reviews.js";
import { updateFailures, failureFor, liveUpdate } from "./core/aptupdate.js";
import { createKeepAwake } from "./core/keepawake.js";

// F287: the shell calls that are work the screen must stay on for: a streamed helper run (apt-get update, an apply,
// a rollback, an uninstall with its console), a .deb's download and install, an IPA or paid package's install.
// A quick helper call (simulate, auto, app-versions) has no stream and lets the screen be.
const LONG_CALLS = new Set(["share.debFetch", "share.debInstall", "ipa.install", "paid.install"]);
export const longCall = (method, params) => LONG_CALLS.has(method) || (method === "helper.run" && Boolean(params?.stream));

// The one apt source file iFizBox writes (ifizbox-helper addsource/removesource, F33).
const IFIZBOX_SOURCES = /(^|\/)sources\.list\.d\/ifizbox\.sources$/;

const CODES = new Set(["bad_url", "refused", "too_large", "timeout", "upstream", "not_found", "network", "helper"]);

function backendError(e) {
  if (e instanceof BackendError) return e;
  let msg = e?.message || String(e);
  // bridge.js splits the shell's "bad_hash: …" into e.code and the rest; a code the proxy doesn't share (bad_hash,
  // not_deb, gone, cancelled, …) stays in front of the message, where the share.* callers look for it (F234).
  if (typeof e?.code === "string" && /^[a-z_]+$/.test(e.code) && !CODES.has(e.code) && !msg.startsWith(`${e.code}: `)) msg = `${e.code}: ${msg}`;
  const m = msg.match(/^([a-z_]+): ([\s\S]*)$/);
  const code = e?.code && CODES.has(e.code) ? e.code : m && CODES.has(m[1]) ? m[1] : "network";
  return new BackendError(code, m && CODES.has(m[1]) ? m[2] : msg, e?.status);
}

function fromBase64(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The last non-empty line of apt's stderr: "E: Could not get lock /var/lib/apt/lists/lock" and the like.
const lastLine = (s) => String(s ?? "").trim().split("\n").filter(Boolean).pop() ?? "";

// `native`: the bridge (globalThis.ifizboxNative). `sourceOptions`: { indexedDB, arch: () => string, count, name }
// as for core/sources.js sourceCalls; `name` is the IndexedDB database the source records live in.
export function createNativeBackend({ native = globalThis.ifizboxNative, sourceOptions = {} } = {}) {
  if (!native?.call) throw new Error("no native bridge (ifizboxNative.call)");
  // F287: the screen stays on while a long call runs (longCall: an apt run, a .deb's download or install) and from a
  // job runner's keepAwake(true) to its keepAwake(false) (core/apprun.js); the shell's app.keepAwake
  // (native/Sources/KeepAwake.swift) sets iOS's idle timer. Counted, so overlapping jobs share it.
  const awake = createKeepAwake((on) => native.call("app.keepAwake", { on }));
  const raw = (method, params, onEvent) => native.call(method, params, onEvent).catch((e) => { throw backendError(e); });
  const call = (method, params, onEvent) => (longCall(method, params) ? awake.during(raw(method, params, onEvent)) : raw(method, params, onEvent));

  // A file in apt's lists directory for an index URL, or null when apt has none (not refreshed, or not a source).
  async function localList(url) {
    for (const name of listNamesFor(url)) {
      const text = await call("apt.list", { name });
      if (typeof text === "string") return { text, name };
    }
    return null;
  }

  async function fetchUrl(url) {
    if (!/^https?:\/\//i.test(String(url))) throw new BackendError("bad_url", `not an http(s) URL: ${url}`);
    const r = await call("net.fetch", { url: freshUrl(url) });
    if (r.status >= 400) throw new BackendError("upstream", `the repo answered HTTP ${r.status}`, r.status);
    const empty = [101, 204, 205, 304].includes(r.status);
    return new Response(empty ? null : fromBase64(r.body), { status: r.status, headers: r.headers ?? {} });
  }

  // B177: Packages.bz2, then Packages.zst in repoDir, fetched by the shell (net.fetch) and unpacked here. The first
  // one the repo serves and that unpacks wins; null when neither does (net.packages' not_found stands then).
  async function packagesInJs(repoDir) {
    for (const name of ["Packages.bz2", "Packages.zst"]) {
      let bytes;
      try { bytes = new Uint8Array(await (await fetchUrl(repoDir + name)).arrayBuffer()); } catch (e) {
        if (e?.code === "upstream" || e?.code === "not_found") continue; // not served: the next name
        throw e;
      }
      if (!bytes.length || bytes[0] === 0x3c) continue; // an HTML page some hosts send for every path
      const { decompress } = await import("./core/unpack.js"); // C32: loaded here, not at startup
      let plain;
      try { plain = decompress(name, bytes); } catch { continue; }
      return { text: new TextDecoder().decode(plain), source: repoDir + name, cached: false };
    }
    return null;
  }

  const appsSeen = new Map(); // bundleId -> true | false | null, the session's answers (F219)
  async function appsInstalled(bundleIds) {
    const ids = [...new Set((bundleIds ?? []).map(String).filter(Boolean))];
    const ask = ids.filter((id) => !appsSeen.has(id));
    if (ask.length) {
      let res = null;
      try { res = await native.call("apps.isInstalled", { bundleIds: ask }); } catch { /* an older shell: unknown */ }
      const got = res?.installed ?? {};
      // Only real answers are kept; a failed call asks again next time.
      if (res) for (const id of ask) appsSeen.set(id, typeof got[id] === "boolean" ? got[id] : null);
      else return Object.fromEntries(ids.map((id) => [id, appsSeen.get(id) ?? null]));
    }
    return Object.fromEntries(ids.map((id) => [id, appsSeen.get(id)]));
  }

  const backend = {
    kind: "native",
    fetch: fetchUrl,
    // Images load straight from the repo: the page's origin is ifizbox://app, which <img> may load http(s) from.
    assetUrl: (url) => url,
    // B58: a source icon's bytes through the shell (net.icon, native/Sources/Icons.swift): ATS keeps the web view
    // off plain http, so an <img src=http://…> (BigBoss) never loads. -> { type, bytes } (PNG or JPEG, at most
    // 256 KB, checked by the shell); errors keep the shell's code (not_found, upstream, bad_type, too_large: the
    // repo answered; network, timeout: it didn't), which source-icon.js's cache tells apart.
    async iconBytes(raw) {
      const url = encodeUrl(String(raw ?? "")); // B149: a raw space fails the shell's URL(string:) before iOS 17
      if (!/^https?:\/\//i.test(url)) throw new BackendError("bad_url", `not an http(s) URL: ${raw}`);
      let r;
      try { r = await native.call("net.icon", { url }); } catch (e) {
        const m = String(e?.message ?? e).match(/^([a-z_]+): /);
        throw Object.assign(new Error(e?.message ?? String(e)), { code: e?.code ?? m?.[1] ?? "network" });
      }
      return { type: r?.type, bytes: fromBase64(r?.body) };
    },
    async text(url) {
      if (/\/(In)?Release$/.test(url)) {
        const hit = await localList(url);
        if (hit) return hit.text;
        // apt keeps one of the two: when it has the other, this one isn't there (and needs no network).
        const other = url.endsWith("/InRelease") ? url.replace(/InRelease$/, "Release") : url.replace(/Release$/, "InRelease");
        if (await localList(other)) throw new BackendError("not_found", `apt has no ${url.split("/").pop()} for this source`);
      }
      return (await fetchUrl(url)).text();
    },
    // `source` says where the text came from: "apt:<list file>" or the URL the shell fetched.
    async packages(repoDir) {
      const hit = await localList(repoDir + "Packages");
      if (hit) return { text: hit.text, source: `apt:${hit.name}`, cached: true };
      let r;
      try { r = await call("net.packages", { dir: repoDir }); } catch (e) {
        // B177: the shell tries Packages.xz, .gz and plain only. BigBoss serves Packages.bz2 alone (its plain
        // Packages redirects to an HTML page), so net.packages says not_found: fetch .bz2 (then .zst) here and
        // unpack it in JS (core/unpack.js), as the site's proxy does.
        if (e?.code !== "not_found") throw e;
        const got = await packagesInJs(repoDir);
        if (!got) throw e;
        return got;
      }
      // B177: and BigBoss's plain Packages redirects to an HTML page that starts with blank lines, which the shell's
      // first-byte "<" check lets through as the index (0 packages, no error): an HTML answer is no index either.
      if (/^\s*</.test(String(r?.text ?? "").slice(0, 512))) {
        const got = await packagesInJs(repoDir);
        if (got) return got;
        throw new BackendError("not_found", `no Packages index in ${repoDir} (the repo answered with a web page)`);
      }
      return { text: r.text, source: r.source || repoDir, cached: false };
    },
    // ifizbox-helper <words>; onEvent({ fd, line }) sees its output as it comes. Resolves { code, stdout, stderr }.
    helper: (words, onEvent) => call("helper.run", { words, stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: async () => (await call("apt.dpkgStatus")) ?? null,
    // F350: an installed package's files (Details > Filesystem Content), dpkg's list for it; null when it has none.
    // The jailbreak build only: the sideload build has no dpkg, and the site never has this call.
    ...((sourceOptions.mode ?? detectMode()) === "jailbreak" ? { packageFiles: async (id) => (await call("apt.files", { id })) ?? null } : {}),
    // F219: which of these apps iOS has (apps.isInstalled, native/Sources/Sideload.swift: LSApplicationWorkspace
    // applicationIsInstalled: as B46's signing.isInstalled, which the jailbreak build refuses)
    // -> { bundleId: true | false | null }, null where iOS can't be asked. Cached for the session: a package manager
    // is installed or removed with a respring at most, and the package page's Share asks on every open.
    appsInstalled: (bundleIds) => appsInstalled(bundleIds),
    // F19: apt's source files ([{ path, text }]): which jailbreak wrote them tells Recommended what to offer.
    aptSourceFiles: async () => (await call("apt.sources")) ?? [],
    // apt-get update through the helper; throws BackendError("helper") with apt's last error line when it fails.
    // B23: `failures` are the sources apt couldn't fetch (core/aptupdate.js). When apt failed only on those (exit
    // 100, "E: Some index files failed to download") it is no error: the rest updated, and refreshSources marks them.
    async update(onEvent) {
      const r = await backend.helper(["update"], onEvent);
      const failures = updateFailures(r.stdout, r.stderr);
      if (r.code !== 0 && !(r.code === 100 && failures.length)) {
        throw new BackendError("helper", `apt-get update failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
      }
      return { ...r, failures };
    },
    // F233: apt-get update for one source ({ uri, dist, components }), a failed row's retry: `ifizbox-helper
    // update-source <uri> <suite> [component...]`, which updates that source's lists only. A helper without the
    // verb (or one that refuses the words) answers 64: then the whole update runs, as before.
    async updateSource(source, onEvent) {
      const dist = source?.dist || "./";
      const words = ["update-source", source?.uri, dist, ...(dist.endsWith("/") ? [] : source?.components ?? [])];
      const r = await backend.helper(words, onEvent);
      if (r.code === 64) return backend.update(onEvent);
      const failures = updateFailures(r.stdout, r.stderr);
      if (r.code !== 0 && !(r.code === 100 && failures.length)) {
        throw new BackendError("helper", `apt-get update failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
      }
      return { ...r, failures };
    },
  };
  if ((sourceOptions.mode ?? detectMode()) === "jailbreak") Object.assign(backend, queueCalls(backend, sourceOptions.queue ?? installQueue, call));
  // AltStore sources (F9) stay on the device, never in apt's sources (core/altstore.js withAltSources).
  // F49: the phone's kCFCoreFoundationVersionNumber (Bridge.swift app.info `cf`) adds Telesphoreo's ios/<cf> suite
  // to the dists Add Source tries, unless sourceOptions brings its own coreFoundation.
  const cf = sourceOptions.coreFoundation ? null : coreFoundationOf(call);
  // F302 (was F144's: no APT sources at all): the sideload build has no apt, so its APT sources are Tweak Sources kept
  // on the device (core/sources.js sourceCalls in their own IndexedDB, Packages through the shell's net.packages),
  // seeded with tweak-sources.json's "inject" repos and counted by their injectable tweaks (core/tweaks.js).
  const sideload = (sourceOptions.mode ?? detectMode()) === "sideload";
  const opts = { ...sourceOptions, sort: sortSources, ...(cf ? { coreFoundation: cf.get } : {}) };
  const aptCalls = sideload
    ? sourceCalls(backend, { indexedDB: sourceOptions.indexedDB, name: sourceOptions.tweakName ?? "ifizbox-tweak-sources",
      tweakDefaults: sourceOptions.injectDefaults ?? (() => loadInjectSources({ remote: (url) => backend.text(url) })),
      count: async (text) => countInjectable(text), arch: "iphoneos-arm", github: true }) // github: F304
    : nativeSourceCalls(backend, call, sourceOptions);
  const sources = withAltSources(aptCalls, backend, opts);
  if (cf) {
    const add = sources.addSource;
    sources.addSource = async (input, opts) => { await cf.ready(); return add(input, opts); };
  }
  // F182: user reviews on the app's server (core/reviews.js), straight from the web view (CORS), as Account does.
  backend.reviews = reviewsApi({ base: reviewsBase("app") });
  backend.keepAwake = (on) => awake.set(on); // F287
  backend.awake = awake;
  return Object.assign(backend, sources);
}

// N4: the install queue's calls. A helper that can't be run, or refuses, is an error with its message (never
// silent, Zebra #2052); apt saying no is not: simulate resolves with ok false and apt's output for the Confirm sheet.
function queueCalls(backend, q, call) {
  const run = async (words, onEvent) => {
    const r = await backend.helper(words, onEvent);
    if (r.code === 64 || r.code === 77 || r.code === 126) {
      throw new BackendError("helper", `ifizbox-helper ${words[0]} failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    }
    return r;
  };
  const joinOut = (a, b) => [a, b].filter(Boolean).join(a?.endsWith("\n") ? "" : "\n");
  const links = linkedDebs(q, call);
  const aptSimulate = async (jobs) => {
    const r = await run(["simulate", ...queueWords(jobs)]);
    return { ok: r.code === 0, code: r.code, plan: parseSimulation(r.stdout), output: joinOut(r.stdout, r.stderr) };
  };
  const aptApply = (jobs, onEvent) => run([onEvent ? "apply-ask" : "apply", ...queueWords(jobs)], onEvent);
  return {
    // { op: "install" | "remove", id, version, installed, name }: browse.js's package page and Version History.
    queue: (job) => q.add(job),
    // -> { ok, code, plan (core/queue.js parseSimulation), output: apt's stdout then stderr }
    // F131: an install job with `debUrl` (its Filename is a full URL apt can't fetch; screens/queue.js sets it) is
    // downloaded by the shell and asked about with simulate-deb; apt's simulate takes the rest. `issues`: sentences
    // for the Cannot Comply sheet when a link couldn't be downloaded or gave another package.
    async simulate(jobs) {
      const linked = jobs.filter(isLinked);
      if (!linked.length) return aptSimulate(jobs);
      const rest = jobs.filter((j) => !isLinked(j));
      const parts = [];
      const issues = [];
      for (const j of linked) {
        const r = await links.simulate(j);
        if (r.issue) issues.push(r.issue);
        parts.push(r);
      }
      if (rest.length) parts.push(await aptSimulate(rest));
      const failed = parts.find((p) => !p.ok);
      return { ok: !failed, code: failed?.code ?? 0, plan: mergePlans(parts.map((p) => p.plan)),
        output: parts.map((p) => p.output).filter(Boolean).join("\n"), ...(issues.length ? { issues } : {}) };
    },
    // onEvent({ fd: "out" | "err" | "status", line }) as it runs. -> { code, stdout, stderr }
    // F63: with onEvent it is apply-ask: a conffile changed by both you and the package arrives as a pmconffile:
    // status line, and the run waits for answerConffile. Without one nobody could answer, so dpkg keeps your copy.
    // F131: linked jobs first, one install-deb each (anything queued may depend on them, and apt can't fetch them),
    // then apt's apply over the rest; the first that fails ends the run with its code.
    async apply(jobs, onEvent) {
      const linked = jobs.filter(isLinked);
      if (!linked.length) return aptApply(jobs, onEvent);
      const rest = jobs.filter((j) => !isLinked(j));
      let out = { code: 0, stdout: "", stderr: "" };
      const add = (r) => { out = { code: r.code, stdout: joinOut(out.stdout, r.stdout), stderr: joinOut(out.stderr, r.stderr) }; };
      for (const j of linked) {
        add(await links.install(j, onEvent));
        if (out.code !== 0) return out;
      }
      if (rest.length) add(await aptApply(rest, onEvent));
      return out;
    },
    // F234: the queue run (core/installrun.js, screens/queuerun.js), one package a call.
    // queueFetch(row, { signal, progress }) downloads a row's .deb through the shell (share.debFetch, checked against
    // its stanza's hash) -> { file } | { viaApt: true }. A bad hash or a file that isn't a .deb fails the row; any
    // other failure (a repo that wants apt's own headers, a mirror apt knows better) hands the download to apt in
    // the install step, except for a full-URL Filename (F131), which apt can't fetch. signal.onabort stops it.
    queueFetch: (row, hooks) => queueFetch(call, row, hooks),
    // queueInstall(row, { file, onEvent }) -> { code, stdout, stderr }: a fetched file through install-deb, a removal or
    // an apt-downloaded row through apply-ask (so dpkg can ask about a conffile, F63) for that one item. F239: with
    // onEvent the file goes through install-deb-ask ({ ask: true }), so its conffile question comes too.
    async queueInstall(row, { file = null, onEvent = null } = {}) {
      if (row.op === "remove") return aptApply([{ op: "remove", id: row.id }], onEvent);
      if (file) {
        const r = await call("share.debInstall", { file, stream: Boolean(onEvent), ask: Boolean(onEvent) }, onEvent);
        return { code: r?.code ?? -1, stdout: r?.stdout ?? "", stderr: r?.stderr ?? "" };
      }
      return aptApply([{ op: "install", id: row.id, version: row.to }], onEvent);
    },
    // The packages apt pulled in only for another get their Auto-Installed mark back (ifizbox-helper auto: each
    // one-package install marked them manual). Best effort: an older helper without the verb leaves them manual.
    async markAuto(ids) {
      if (!ids?.length) return false;
      try { return (await backend.helper(["auto", ...ids])).code === 0; } catch { return false; }
    },
    // A fetched file the run won't install (cancelled, skipped).
    queueDiscard: (file) => call("share.discard", { file, kind: "deb" }).catch(() => {}),
    // F63: the Configuration Upgrade answer for the running apply: "keep" (Keep My Old Copy) or "new".
    answerConffile: async (answer) => { await call("helper.answer", { answer }); },
    // F64: Cancel the running apply while apt is still downloading. Rejects BackendError("helper") once dpkg has
    // started (the console hides its Cancel there anyway) or when nothing runs. The run then resolves with code 130.
    cancelApply: async () => { await call("helper.cancel", {}); },
    // F71: [] when nothing is stored, or the helper can't list (not installed, or an older one without the verb).
    async rollbacks(id) {
      let r;
      try {
        r = await backend.helper(["rollbacks", id]);
      } catch {
        return [];
      }
      if (r.code !== 0) return [];
      return parseRollbacks(r.stdout);
    },
    // -> { code, stdout, stderr } like apply; a refusal (64: not stored, control doesn't match) is an error.
    rollback: (id, version, onEvent) => run(["rollback", id, version], onEvent),
    // I4: null (not []) when the helper can't list, so callers keep the remembered versions instead of "not installed".
    async appVersions() {
      let r;
      try {
        r = await backend.helper(["app-versions"]);
      } catch {
        return null;
      }
      return r.code === 0 ? parseAppVersions(r.stdout) : null;
    },
    // I4: core/installed.js records with the real versions (withRealVersions); as they were when those can't be read.
    async installedApps(records) {
      return withRealVersions(records, await backend.appVersions());
    },
    // B46: Installed's Delete. ifizbox-helper uninstall-app has installd take the app off the phone (only an app in
    // installd's containers: never a system app or iFizBox); onEvent sees its pmstatus lines for the progress.
    // Resolves once it is gone; any failure is a BackendError("helper") with the helper's last line.
    async uninstallApp(id, onEvent) {
      const r = await backend.helper(["uninstall-app", id], onEvent);
      if (r.code !== 0) throw new BackendError("helper", uninstallError(r));
    },
    // F232: Malware Found's Delete. ifizbox-helper remove-malware deletes known-malware dylibs no package owns (the
    // scan's orphan files), all in one run, then restarts SpringBoard, which ends this app too: a resolve is rare
    // (the respring command came back first). A refusal (owned, not on the list, gone) is a BackendError("helper").
    async removeMalware(paths) {
      const r = await backend.helper(["remove-malware", ...paths]);
      if (r.code !== 0) throw new BackendError("helper", removeMalwareError(r));
      return r;
    },
    async respring() {
      const r = await run(["respring"]);
      if (r.code !== 0) throw new BackendError("helper", `Couldn't restart SpringBoard (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    },
    // F151: the console's Reload Data (an app was installed): the helper's uicache verb rebuilds the home screen's
    // icon cache.
    async uicache() {
      const r = await run(["uicache"]);
      if (r.code !== 0) throw new BackendError("helper", `Couldn't reload the home screen (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    },
    // F151: the console's Reboot Device: launchctl reboot userspace (the helper's N8 verb), which keeps the jailbreak.
    async userspaceReboot() {
      const r = await run(["userspace-reboot"]);
      if (r.code !== 0) throw new BackendError("helper", `Couldn't reboot (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    },
  };
}

// F131: a queued install whose Filename is a full URL (core/queue.js debUrlOf), as the Confirm sheet marks it.
const isLinked = (j) => j?.op === "install" && typeof j.debUrl === "string" && /^https?:\/\//i.test(j.debUrl);

// F131: the links' downloads. share.debFetch puts each in the helper's .deb folder (native/share/App/ShareBridge.swift)
// once per job and link; simulate asks share.debSimulate (ifizbox-helper simulate-deb: apt-get -s install ./file.deb)
// and install runs share.debInstall (install-deb, which removes the file). A file that went (a day's sweep) is fetched
// again. Clearing a job, or the queue, discards what it had downloaded.
function linkedDebs(q, call) {
  const staged = new Map(); // job id -> { url, file }
  const discard = (id) => {
    const s = staged.get(id);
    if (!s) return;
    staged.delete(id);
    call("share.discard", { file: s.file, kind: "deb" }).catch(() => {});
  };
  q.subscribe?.((e) => {
    if (e.type === "clear") discard(e.id);
    else if (e.type === "clearAll") for (const id of [...staged.keys()]) discard(id);
    else if (e.type === "add" && staged.has(e.job.id)) discard(e.job.id); // queued for something else now
  });
  // F133: the stanza's hashes ride along; a file fetched for another hash is fetched again.
  const hashes = (j) => ({ ...(j.debSha256 ? { sha256: j.debSha256 } : {}), ...(j.debMd5 ? { md5: j.debMd5 } : {}) });
  const fetchKey = (j) => [j.debUrl, j.debSha256 ?? "", j.debMd5 ?? ""].join(" ");
  const fetchFor = async (j, again = false) => {
    const s = staged.get(j.id);
    if (s && s.url === fetchKey(j) && !again) return s.file;
    if (s) discard(j.id);
    const r = await call("share.debFetch", { url: j.debUrl, ...hashes(j) });
    if (!r?.file) throw new BackendError("network", `${j.debUrl} gave nothing to install`);
    staged.set(j.id, { url: fetchKey(j), file: r.file });
    return r.file;
  };
  const badHash = (e) => /^bad_hash:/.test(String(e?.message ?? e));
  const gone = (e) => /^gone:/.test(String(e?.message ?? e));
  const clean = (e) => String(e?.message ?? e).replace(/^[a-z_]+: /, "");
  const label = (j) => j.name || j.id;
  const empty = () => parseSimulation("");
  return {
    async simulate(j) {
      let r;
      try {
        let file = await fetchFor(j);
        try {
          r = await call("share.debSimulate", { file });
        } catch (e) {
          if (!gone(e)) throw e;
          file = await fetchFor(j, true);
          r = await call("share.debSimulate", { file });
        }
      } catch (e) {
        discard(j.id);
        const issue = badHash(e)
          ? `${label(j)} from ${j.debUrl} isn't the file its source lists (${clean(e)}), so ${NAME} won't install it.`
          : `Couldn't download ${label(j)} from ${j.debUrl}, where its source says it is: ${clean(e)}`;
        return { ok: false, code: -1, plan: empty(), output: `E: ${label(j)}: ${clean(e)} (${j.debUrl})`, issue };
      }
      if (r.package && r.package !== j.id) {
        discard(j.id);
        return { ok: false, code: -1, plan: empty(), output: r.output ?? "",
          issue: `The link ${j.debUrl} gave ${r.package}, not ${label(j)}, so ${NAME} won't install it.` };
      }
      return { ok: Boolean(r.ok), code: r.code ?? (r.ok ? 0 : -1), plan: parseSimulation(r.stdout), output: r.output ?? "" };
    },
    async install(j, onEvent) {
      onEvent?.({ fd: "status", line: `dlstatus:${j.id}:0:Downloading ${j.debUrl}` });
      let file = await fetchFor(j);
      const run = (f) => call("share.debInstall", { file: f, stream: Boolean(onEvent) }, onEvent);
      let r;
      try {
        r = await run(file);
      } catch (e) {
        if (!gone(e)) { staged.delete(j.id); throw e; }
        file = await fetchFor(j, true);
        r = await run(file);
      }
      staged.delete(j.id); // install-deb's file is removed once it ran
      return { code: r?.code ?? -1, stdout: r?.stdout ?? "", stderr: r?.stderr ?? "" };
    },
  };
}

// F234: a queue row's download (backend.queueFetch above).
let fetchTag = 0;
export async function queueFetch(call, row, { signal = null, progress = () => {} } = {}) {
  if (!row?.debUrl || !/^https?:\/\//i.test(row.debUrl)) return { viaApt: true };
  const tag = `q${Date.now().toString(36)}-${++fetchTag}`;
  signal?.onabort?.(() => { call("share.debCancel", { tag }).catch(() => {}); });
  const params = { url: row.debUrl, stream: true, tag, ...(row.sha256 ? { sha256: row.sha256 } : {}), ...(row.md5sum ? { md5: row.md5sum } : {}) };
  try {
    const r = await call("share.debFetch", params, (ev) => { if (typeof ev?.progress === "number") progress(ev.progress); });
    if (!r?.file) throw new BackendError("network", `${row.debUrl} gave nothing to install`);
    if (signal?.aborted) { call("share.discard", { file: r.file, kind: "deb" }).catch(() => {}); return {}; }
    return { file: r.file };
  } catch (e) {
    const msg = String(e?.message ?? e);
    const why = msg.replace(/^[a-z_]+: /, "");
    if (/^bad_hash:/.test(msg)) {
      // the row's line names the hash; the shell's whole sentence (both hashes) is the error's detail for the log
      const kind = why.match(/\b(SHA256|MD5)\b/i)?.[1]?.toUpperCase() ?? "checksum";
      throw Object.assign(new Error(`the download isn't the file its source lists (its ${kind} doesn't match)`), { detail: why });
    }
    if (/^not_deb:/.test(msg)) throw new Error(why);
    if (/^cancelled:/.test(msg) || signal?.aborted) throw new Error("Cancelled");
    if (row.linked) throw new Error(`couldn't download it from ${row.debUrl}: ${why}`);
    return { viaApt: true };
  }
}

// ifizbox-helper rollbacks' "<version> <file>" lines -> [{ version, file }], newest version first, each version once.
export function parseRollbacks(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = line.trim().match(/^(\d[A-Za-z0-9.+~:-]*) (\S+\.deb)$/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ version: m[1], file: m[2] });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

// B46: the sentence for a failed ifizbox-helper uninstall-app ({ code, stderr }): the helper's reason without its
// "ifizbox-helper: " prefix; an older helper without the verb says it needs updating.
export function uninstallError(r) {
  const why = lastLine(r?.stderr).replace(/^ifizbox-helper:\s*/, "");
  if (r?.code === 64 && /unknown verb/.test(why)) return "Update the helper (reinstall the package) to delete apps.";
  return why ? why.charAt(0).toUpperCase() + why.slice(1) + "." : `The app couldn't be deleted (${r?.code}).`;
}

// F232: the sentence for a failed ifizbox-helper remove-malware ({ code, stderr }), as uninstallError does it.
export function removeMalwareError(r) {
  const why = lastLine(r?.stderr).replace(/^ifizbox-helper:\s*/, "");
  if (r?.code === 64 && /unknown verb/.test(why)) return "Update the helper (reinstall the package) to delete these files.";
  return why ? why.charAt(0).toUpperCase() + why.slice(1) + "." : `The files couldn't be deleted (${r?.code}).`;
}

// I4: ifizbox-helper app-versions' "<id>\t<short>\t<build>\t<store>" lines -> [{ id, version, build, store }], each
// id once (the first). `version` is what the app shows: CFBundleShortVersionString, else the store's, else the build
// number; an app with none of them is left out. Empty fields are null.
export function parseAppVersions(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const [id, short, build, store] = line.replace(/\r$/, "").split("\t").map((v) => (v ?? "").trim() || null);
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(id) || seen.has(id)) continue;
    const version = short ?? store ?? build;
    if (!version) continue;
    seen.add(id);
    out.push({ id, version, build: build ?? null, store: store ?? null });
  }
  return out;
}

// I4: the remembered apps (core/installed.js records: { id, name, version, ... }) against what is really installed
// (parseAppVersions' list, or null when it couldn't be read: the records come back as they are). Each record gets
//   remembered  the version iFizBox recorded at Install
//   actual      the installed app's version, or null when no installed app has that id (removed outside iFizBox)
//   disagrees   true when both are known and the remembered one is none of the app's spellings (short version,
//               build number, store version), compared as written
//   note        what to say then: "Installed: 1.6 (iFizBox remembered 1.5)", or "Not installed (iFizBox remembered 1.5)"
// and `version` becomes the actual one where there is one, so upgrades are worked out from what's on the phone.
// iFizBox's own record (`self`) is dpkg's in jailbreak mode and is left as it is.
export function withRealVersions(records, actual) {
  if (!Array.isArray(actual)) return records ?? [];
  const byId = new Map(actual.map((a) => [a.id, a]));
  return (records ?? []).map((rec) => {
    if (!rec?.id || rec.self) return rec;
    const remembered = rec.version ?? null;
    const app = byId.get(rec.id) ?? null;
    if (!app) {
      return { ...rec, remembered, actual: null, disagrees: false, note: remembered ? `Not installed (${NAME} remembered ${remembered})` : "Not installed" };
    }
    const spellings = [app.version, app.build, app.store].filter(Boolean).map(String);
    const disagrees = Boolean(remembered) && !spellings.includes(String(remembered).trim());
    return { ...rec, version: app.version, remembered, actual: app.version, disagrees,
      note: disagrees ? `Installed: ${app.version} (${NAME} remembered ${remembered})` : null };
  });
}

// The app.info `cf` number, asked once when first needed: get() is it (or null: an older shell, or no answer) once
// ready() has resolved. ready() never rejects, so Add Source works without it.
function coreFoundationOf(call) {
  let value = null;
  let asked = null;
  return {
    get: () => value,
    ready: () => (asked ??= call("app.info", {}).then((info) => {
      const n = Number(info?.cf);
      value = Number.isFinite(n) && n > 0 ? n : null;
    }, () => {})),
  };
}

// The source-list calls (sources, addSource, removeSource, refreshSources) over apt's files plus the device store.
function nativeSourceCalls(backend, call, opts) {
  let opened = null;
  // The defaults core/sources.js seeds into a new store stay metadata only: just `added` records are listed.
  // F267: they're the site's tweak-sources.json (through the shell's net.fetch), else the bundled copy.
  const defaults = opts.tweakDefaults ?? (() => loadTweakSources({ remote: (url) => backend.text(url) }));
  const store = () => (opened ??= openSourceStore({ indexedDB: opts.indexedDB, name: opts.name ?? "ifizbox-native-sources", defaults }));
  const arch = () => (typeof opts.arch === "function" ? opts.arch() : opts.arch) || DEFAULT_ARCH;
  const count = opts.count;
  const aptSources = async () => parseAptSources((await call("apt.sources")) ?? []);

  // F33: ifizbox-helper addsource|removesource. Resolves true when it ran and succeeded, false when the helper
  // couldn't be run at all (no helper: the sideload build); a refusal or failed write is an error with its message.
  async function writeSource(verb, s) {
    const dist = s.dist || "./";
    const words = verb === "addsource" ? [verb, s.uri, dist, ...(dist.endsWith("/") ? [] : s.components ?? [])] : [verb, s.uri, dist];
    let r;
    try {
      r = await backend.helper(words);
    } catch (e) {
      if (e?.code === "helper") return false;
      throw e;
    }
    if (r.code !== 0) throw new BackendError("helper", `ifizbox-helper ${verb} failed (${r.code}): ${lastLine(r.stderr) || "no output"}`);
    return true;
  }

  // Records kept on the device only (`added: true`, from before F33 or without a helper) go into ifizbox.sources,
  // one at a time; one that can't be written stays as it is and is tried again on the next refresh.
  async function migrateAdded() {
    const db = await store();
    const added = (await db.list()).filter((s) => s.added);
    if (!added.length) return;
    const aptKeys = new Set((await aptSources()).map((s) => s.key));
    for (const s of added) {
      const { added: _, ...rest } = s;
      try {
        if (aptKeys.has(s.key) || (await writeSource("addsource", s))) await db.put(rest);
      } catch {
        // refused or not written: still listed from the device store, and the next refresh tries again
      }
    }
  }

  async function list() {
    const db = await store();
    const stored = new Map((await db.list()).map((s) => [s.key, s]));
    const apt = await aptSources();
    const aptKeys = new Set(apt.map((s) => s.key));
    const fromApt = apt.map((s) => {
      const { added, ...meta } = stored.get(s.key) ?? {};
      return { ...meta, ...s };
    });
    const added = [...stored.values()].filter((s) => s.added && !aptKeys.has(s.key));
    return sortSources([...fromApt, ...added]);
  }

  return {
    sources: list,
    // `input`: a URL, or a dist repo { uri, dist, components } (F48, Import's `deb` lines): verifySource checks its
    // Release under dists/<dist>/, and writeSource puts the suite and components on the ifizbox.sources line.
    async addSource(input) {
      const s = await verifySource(backend, input, { arch: arch(), count });
      const db = await store();
      const cur = await db.get(s.key);
      const inApt = (await aptSources()).some((a) => a.key === s.key);
      const written = !inApt && (await writeSource("addsource", s));
      const { added, ...rest } = { ...cur, ...s };
      return db.put(inApt || written ? rest : { ...rest, added: true });
    },
    async removeSource(key) {
      const apt = (await aptSources()).find((s) => s.key === key);
      if (apt && IFIZBOX_SOURCES.test(apt.file)) {
        if (!(await writeSource("removesource", apt))) throw new BackendError("helper", `ifizbox-helper is not installed, so ${NAME} can't change apt's sources.`);
      } else if (apt) {
        throw new Error(`This source is listed in ${apt.file}, which ${NAME} doesn't change. Remove it there (Filza or a terminal), then Refresh.`);
      }
      return (await store()).remove(key);
    },
    // F144: drops a record from the device store only (core/altstore.js withAltSources dropApt, the sideload build).
    forget: async (key) => (await store()).remove(key),
    // Device-only sources into ifizbox.sources, apt-get update, then every source's count and Release from apt's
    // lists (all at once), saved as each lands. `filter` (F41, C5): only the sources it keeps are read back and
    // saved (F99's Add Source & Install refreshes one); apt-get update itself still updates all of apt's sources.
    // F150: `signal` (the reload bar's Cancel): once aborted, apt-get update (already running) is left to end
    // and no list is read back.
    // B23: a source apt-get update couldn't fetch gets apt's reason as its `error` (its row says Not Responding, F19,
    // even when apt kept its old lists), and the answer's `failed` lists every such source, filtered out or not:
    // [{ key, uri, name, message }] (key null for a URI no listed source has), for the caller's banner.
    // F233: `onRow(key, state, reason)` follows apt-get update's lines live (core/aptupdate.js liveUpdate): a row
    // spins at apt's first line for it and goes red at its Err, before the lists are read back. `retry` with a filter
    // that keeps one source runs apt-get update for that source alone (backend.updateSource).
    async refreshSources(onEach = () => {}, { filter, signal, onRow, retry } = {}) {
      await migrateAdded();
      const wanted = onRow || retry ? (await list()).filter(filter ?? (() => true)) : [];
      const live = onRow ? liveUpdate(wanted, onRow) : null;
      const feed = live ? (ev) => live.feed(ev) : undefined;
      const one = retry && wanted.length === 1 ? wanted[0] : null;
      const { failures = [] } = (one ? await backend.updateSource(one, feed) : await backend.update(feed)) ?? {};
      live?.end();
      if (signal?.aborted) return Object.assign([], { failed: [] });
      const db = await store();
      const all = await list();
      const failed = failedSources(all, failures);
      const sources = all.filter(filter ?? (() => true));
      const rows = await Promise.all(sources.map(async (s) => {
        const fields = await refreshSource(backend, s, { arch: arch(), count });
        const apt = failureFor(s, failures);
        fields.aptError = apt ? apt.message : null;
        if (apt) fields.error = apt.message;
        const cur = await db.get(s.key);
        const { file, ...rest } = s;
        const next = { ...cur, ...rest, ...fields, ...healthFields(cur, fields) }; // F19: reachedAt, failures
        await db.put(next);
        const shown = file ? { ...next, file } : next;
        onEach(shown);
        return shown;
      }));
      return Object.assign(rows, { failed });
    },
  };
}

// B23: apt's failures as sources: one entry per listed source apt named, then any URI no listed source has.
function failedSources(sources, failures) {
  const out = new Map();
  for (const f of failures) {
    const s = sources.find((x) => failureFor(x, [f]));
    const k = s ? s.key : `uri:${f.uri}`;
    if (!out.has(k)) out.set(k, { key: s?.key ?? null, uri: s?.uri ?? f.uri, name: s?.name || s?.origin || null, message: f.message });
  }
  return [...out.values()];
}
