// The sideload app's (and the website's) install queue (F80): Cydia's queue and Confirm sheet for AltStore apps,
// where there is no apt. Pure JS, no DOM: the store the screens share is app-queue.js, the Confirm sheet and the run
// are screens/queue.js (openAppConfirm, runAppQueue), the app page's button altstore.js, Changes' Upgrade (N)
// changes.js. The jailbreak build keeps core/queue.js (apt's queue); this one hands each app to the phone's signer.
//
//   const q = createAppQueue();
//   q.add(job, { quiet })  (B71a: quiet, a row's swipe: listeners don't open Confirm)
//   q.add({ op: "remove", id, name, installed })  B71a: the jailbreak app's Remove (the helper uninstalls it), mode "remove"
//   q.add(job)  q.get(id)  q.list()  q.size  q.clear(id)  q.clearAll()  q.subscribe(fn) -> unsubscribe
//   job: { op: "install", id, name, version, installed, mode, url, size, icon, key, source, sourceName, deps }
//       mode (core/queue.js modeOf): install | reinstall | upgrade | downgrade
//       deps: what a tweak needs installed with it (none yet: Confirm lists them under Install when there are)
//       options (F84): Custom Install's, kept per job: { token, at, edits: { name?, bundleId?, icon?, removeExtensions? },
//                name, signsAs } (token/at: signing.inspect's look, good for 15 minutes); null for a plain Install
//   customParams(job, now) -> signing.install's params for a job with options: its token while fresh, else its url,
//                        with the edits either way (null for a plain job)
//   appJob(pkg, { installed, version, source })  -> a job for a catalog package whose stanza is an app, or null
//                                                   (no IPA to sign, or a source-signed itms-services link)
//   job.library (F241): a My IPAs file instead of a url (add({ library: file })), signed from the shell's library
//   libraryJob(entry, { installed }) -> such a job for a My IPAs entry, its Sign Options as options.edits
//   appPlan(jobs)     -> core/queue.js parseSimulation's shape: { installs, reinstalls, upgrades, downgrades, removes,
//                        essential, download }, so Confirm draws apps with the jailbreak queue's own groups
//   jobDownloads(job) -> B282: whether the run downloads it (it has a url and is not a My IPAs file):
//                        only those count toward download
//   runOrder(jobs)    -> the order Confirm installs in: as queued, iFizBox itself last (installing it closes the app)
//   appNavLabel({ queued, installed, newest }) -> the app page's nav button: Modify while the app is queued (Cydia),
//                        else Install, Upgrade or Reinstall
//   modifyActions({ queued, installed, newest }) -> the Modify sheet's buttons: Clear first (Cydia's), then the rest
// F91: re-signs go through the same queue.
//   job mode "resign": { op: "resign", id, name, version, installed, mode: "resign", url: null }: signing.resign {bundleId}
//       signs the app again from the phone's record (native Sideload.swift), no IPA url of its own
//   resignJob({ bundleId, name, version }) -> such a job, from a signing.installed record or a Needs Re-sign row
//   APP_MODES, APP_MODE_LABEL -> Confirm's Modifications for apps: core/queue.js's modes, Remove out, Re-sign in
//   modifyActions({ ..., signed }) -> "Re-sign" last for an app iFizBox signed
// F221: a marked app (installed record, no signature) whose installed version is still on its source re-signs too:
//   modifyActions({ ..., onSource: true, build: "sideload" | "site" }) -> "Re-sign"
//   markedVersionOnSource(pkg, installed) -> that version's entry, or null
//   markedResignJob(pkg, installed, { source }) -> a resign job with that version's IPA url (downloaded and signed anew)
//   markedResignProblem(pkg, installed) -> B66: why it can't be (no source, version gone, ...) and the newest instead
// F94: Modify's last button for an installed app, per build (user 2026-11-18):
//   modifyActions({ ..., build }) -> build "sideload" or "site": "Mark as Not Installed" (the phone can't remove apps:
//       it forgets core/installed.js's record, as the Installed section's row does); "jailbreak": "Remove" (apt's
//       queued remove); none given: neither
//   MARK_NOT_INSTALLED, destructiveOf(buttons) -> that button's index for showActionSheet's `destructive` (red), or -1
// F379: a Custom Install saves its IPA in My IPAs (customInstallSave), and a Re-sign signs that saved IPA
//   (savedResignJob, withSavedIpa; the queue keeps a resign job's `library` and options)
// SPDX-License-Identifier: GPL-3.0-or-later
import { modeOf } from "./queue.js";
import { compareVersions } from "./apt.js";
import { installOptions, signableDownload } from "./altstore.js";

export const SELF_ID = "com.ryha.ifizbox";

// A download or installed size in Cydia's words ("109 kB", "4.7 MB"), for the Queue and the package and app pages.
export function sizeText(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function createAppQueue() {
  const jobs = new Map();
  const listeners = new Set();
  const emit = (event) => { for (const f of [...listeners]) { try { f(event); } catch { /* a listener's bug isn't the queue's */ } } };
  return {
    // An app is queued once: queuing it again replaces it (Cydia's marks work the same).
    // B71a: `quiet` (a row's swipe in the jailbreak app) tells listeners not to open Confirm for it.
    add({ id, op = null, app = null, name = null, version = null, installed = null, url, library = null, size = null, icon = null, key = null, source = null, sourceName = null, deps = [], options = null, mode = null },
      { quiet = false } = {}) {
      if (!id) throw new Error("no app id");
      const emit1 = (job) => emit(quiet ? { type: "add", job, quiet } : { type: "add", job });
      if (op === "remove" || app === "remove" || mode === "remove") { // B71a: the jailbreak app's helper uninstalls it
        const job = { op: "remove", id, name: name || null, version: null, installed: installed ?? null, mode: "remove", url: null, size: null,
          icon, key, source, sourceName, deps: [], options: null };
        jobs.set(id, job);
        emit1(job);
        return job;
      }
      if (mode === "resign") { // F91: signed again from the phone's record, nothing to download here
        // F221: a marked app's re-sign carries its installed version's IPA url (markedResignJob): that is downloaded
        const job = { op: "resign", id, name: name || null, version: version || installed || null, installed: installed || version || null,
          mode: "resign", url: url || null, size: url ? Number(size) || null : null, icon, key, source, sourceName, deps: [], options: null };
        // F379: a re-sign from the app's saved IPA in My IPAs (savedResignJob) keeps its file and Sign Options
        if (!url && typeof library === "string" && library) {
          job.library = library;
          job.options = options && typeof options === "object" ? options : null;
        }
        jobs.set(id, job);
        emit1(job);
        return job;
      }
      // F241: a My IPAs file (`library`: its name in the shell's library) instead of a url: signing.prepare {library}
      const file = typeof library === "string" && library ? library : null;
      if (!url && !file) throw new Error(`no IPA to install for ${name || id}`);
      const job = { op: "install", id, name: name || null, version: version || null, installed: installed || null,
        mode: modeOf({ op: "install", version, installed }), url: file ? null : url, size: Number(size) || null, icon, key, source, sourceName,
        deps: Array.isArray(deps) ? deps : [], options: options && typeof options === "object" ? options : null };
      if (file) job.library = file;
      jobs.set(id, job);
      emit1(job);
      return job;
    },
    get: (id) => jobs.get(id) ?? null,
    list: () => [...jobs.values()],
    get size() { return jobs.size; },
    clear(id) { if (jobs.delete(id)) emit({ type: "clear", id }); },
    clearAll() { if (!jobs.size) return; jobs.clear(); emit({ type: "clearAll" }); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

// A catalog package (catalog.package: { key, row, stanza: { kind: "ipa", ipa } }) as a queue job. `version`: one of
// the app's versions[] (its newest when left out); `installed`: the version on the phone (core/installed.js's record).
export function appJob(pkg, { installed = null, version = null, source = null } = {}) {
  const app = pkg?.stanza?.ipa;
  if (!app) return null;
  const v = (version && app.versions?.find((x) => x.version === version)) || app.versions?.[0];
  if (!v) return null;
  const o = installOptions(v, app.sourceUrl);
  if (!o.download || o.itms || !signableDownload(v.downloadURL).ok) return null; // B269: the lists' check too
  return {
    id: app.bundleIdentifier || pkg.row?.id, name: app.name || pkg.row?.name || null, version: v.version || null, installed,
    url: o.download, size: v.size ?? null, icon: app.iconURL ?? null, key: pkg.key ?? null, source: app.sourceUrl ?? null,
    sourceName: app.sourceName || source || null,
  };
}

// F241: a My IPAs entry (core/myipas.js: { file, name, bundleId, version, size, icon, options }) as a queue job that the
// run signs from the library file (signing-client.js prepareParams: signing.prepare {library, ...edits}). Its Sign
// Options go with it as the job's edits (signing.prepare signs a library file with the edits it is sent). The id is
// the bundle ID it installs as, so Installed records it (and a source's job for the same app is replaced). `installed`:
// whether that app is on the phone (Confirm lists it under Reinstall). Null for an unreadable entry.
export function libraryJob(entry, { installed = false } = {}) {
  if (!entry?.file || entry.error) return null;
  const o = entry.options ?? {};
  const t = (v) => (typeof v === "string" ? v.trim() : "");
  const edits = {};
  if (t(o.name)) edits.name = t(o.name);
  if (t(o.bundleId)) edits.bundleId = t(o.bundleId);
  if (t(o.icon)) edits.icon = t(o.icon);
  if (Array.isArray(o.removeExtensions) && o.removeExtensions.length) edits.removeExtensions = [...o.removeExtensions];
  if (typeof o.fixArm64e === "boolean") edits.fixArm64e = o.fixArm64e;
  // F237: Sign Options saved before Keep Bundle IDs signed the old way and say so (false); otherwise the global
  // setting decides (signing-client.js withKeep). F243: the Sign Options page's switch (true or false) goes as it is;
  // null (no Sign Options saved) leaves it to the global setting.
  if (typeof o.keepBundleId === "boolean") edits.keepBundleId = o.keepBundleId;
  const id = edits.bundleId || entry.bundleId || `library:${entry.file}`;
  const version = entry.version || null;
  const icon = edits.icon || entry.icon || null;
  return {
    id, name: edits.name || entry.name || entry.file.replace(/\.ipa$/i, ""), version, installed: installed ? version || "" : null,
    library: entry.file, size: entry.size ?? null, icon: icon ? `data:image/png;base64,${icon}` : null, key: null, source: null,
    sourceName: "My IPAs", options: Object.keys(edits).length ? { edits } : null,
  };
}

// B136: the installed version an app row goes by: Installed's record (`rec`, core/installed.js; "" when its version
// is unknown), unless the phone's own app list says the app isn't there (`onPhone`: apps.isInstalled's answer for its
// bundle ID, false). A record left by an install iOS never finished then doesn't block the row's Install swipe.
// true, null or undefined (iOS can't be asked) keep the record; iFizBox's own record (`self`) always stands.
export function installedOnPhone(rec, onPhone) {
  if (!rec) return null;
  if (onPhone === false && !rec.self) return null;
  return rec.version || "";
}

// B282: whether Confirm's run downloads this job's IPA, so its size counts toward Statistics' Downloading. A My IPAs
// file (job.library) is already on the phone; a Re-sign with no url signs from the phone's record (the IPA kept at
// install, else the record's own download, which the page can't size). A Re-sign with a url is a marked app's
// (markedResignJob): it has no signing record, so no IPA is kept for it and the url is downloaded. A Remove has no url.
// The test is the url alone, so a record's Re-sign that ever gets one counts.
export function jobDownloads(job) {
  return Boolean(job && job.url && !job.library);
}

// Confirm's Modifications and Statistics, from the queue alone: every app and what it needs, under its mode.
export function appPlan(jobs = []) {
  const out = { installs: [], reinstalls: [], upgrades: [], downgrades: [], removes: [], resigns: [], essential: [], download: null };
  const seen = new Set();
  let bytes = 0;
  const put = (e, mode, downloads) => {
    if (!e?.id || seen.has(e.id)) return;
    seen.add(e.id);
    out[`${mode}s`].push({ id: e.id, from: e.installed ?? null, to: e.version ?? null });
    if (downloads) bytes += Number(e.size) || 0;
  };
  const queued = new Set(jobs.map((j) => j.id)); // a dependency that is queued itself counts as its own job
  // a dependency (none are made yet) carries a size but no url of its own: it counts unless it is a My IPAs file
  for (const j of jobs) for (const d of j.deps ?? []) if (!queued.has(d?.id)) put(d, modeOf({ op: "install", version: d.version, installed: d.installed }), !d.library);
  for (const j of jobs) put(j, j.mode, jobDownloads(j));
  out.download = sizeText(bytes);
  return out;
}

export function runOrder(jobs = []) {
  return [...jobs].sort((a, b) => (a.id === SELF_ID) - (b.id === SELF_ID));
}

// What Install / Upgrade / Reinstall would do for this app now, as Cydia names it.
function verb({ installed, newest }) {
  if (installed == null) return "Install"; // "": installed, version unknown (Mark as Installed without one)
  return installed && newest && compareVersions(newest, installed) > 0 ? "Upgrade" : "Reinstall";
}

// Cydia's nav button: Install when the app isn't installed, Modify once it is or while it's queued (its sheet then
// says what to do: ref/4s/screens/queue-82.png, queue-84.png).
export function appNavLabel({ queued = false, installed = null, newest = null } = {}) {
  return queued || installed != null ? "Modify" : verb({ installed, newest });
}

// Modify's sheet. Queued: Clear, or queue it again. Installed: Upgrade (a newer one is out) or Reinstall, and
// Downgrade when the source has an older version than the installed one (`older`). F94: then, for an installed app,
// Mark as Not Installed where the phone can't remove apps (the sideload app, the website), Remove in the jailbreak build.
export const MARK_NOT_INSTALLED = "Mark as Not Installed";
// F221: `onSource` (a marked app, iFizBox holds no signature for it, whose installed version its source still has)
// offers Re-sign too, where the phone or the browser signs (sideload, site): markedResignJob downloads that version.
export function modifyActions({ queued = false, installed = null, newest = null, older = false, signed = false, onSource = false, build = null } = {}) {
  const marked = onSource && installed && (build === "sideload" || build === "site");
  const resign = signed || marked ? ["Re-sign"] : []; // F91: an app iFizBox signed can be signed again, as it is
  const last = installed == null ? [] : build === "jailbreak" ? ["Remove"] : build === "sideload" || build === "site" ? [MARK_NOT_INSTALLED] : [];
  if (queued) return ["Clear", verb({ installed, newest }), ...resign, ...last];
  if (installed == null) return [verb({ installed, newest }), ...resign];
  return [verb({ installed, newest }), ...(older ? ["Downgrade"] : []), ...resign, ...last];
}

// F94: the red (destructive) button of a Modify sheet: Mark as Not Installed or Remove.
export function destructiveOf(buttons = []) {
  return buttons.findIndex((b) => b === MARK_NOT_INSTALLED || b === "Remove");
}

// ---- F91: re-signs ------------------------------------------------------------------------------------------------

export const APP_MODES = ["install", "reinstall", "upgrade", "downgrade", "resign"];
export const APP_MODE_LABEL = { install: "Install", reinstall: "Reinstall", upgrade: "Upgrade", downgrade: "Downgrade", resign: "Re-sign" };

export function resignJob(app) {
  const id = app?.bundleId ?? app?.id;
  if (!id) return null;
  // a Needs Re-sign row (core/signing.js needsResign) shows the days left as its version: the app's own is `installed`
  const v = app.change === "resign" ? app.installed ?? null : app.version ?? app.installed ?? null;
  return { id, name: app.name || app.label || id, version: v || null, installed: v || null, mode: "resign", icon: app.icon ?? null };
}

// F221: Re-sign for an app marked as installed (core/installed.js's record, no signing.installed one): the version on
// the phone, downloaded from its source, signed with the user's certificate and installed over the app (iOS keeps its
// data). A resign job with the IPA's url (screens/queue.js resignApp installs it as an Install would), or null when
// the source no longer has that version (or only a source-signed link). `pkg`: the catalog package, as appJob's.
export function markedVersionOnSource(pkg, installed) {
  const app = pkg?.stanza?.ipa;
  if (!app || !installed) return null;
  const v = app.versions?.find((x) => x.version === installed);
  if (!v) return null;
  const o = installOptions(v, app.sourceUrl);
  return o.download && !o.itms ? v : null;
}
export function markedResignJob(pkg, installed, { source = null } = {}) {
  if (!markedVersionOnSource(pkg, installed)) return null;
  const job = appJob(pkg, { installed, version: installed, source });
  return job ? { ...job, mode: "resign" } : null;
}

// B66: why a marked app can't be re-signed (markedResignJob gave null), and the newest version that can be installed
// over it instead (keeps its data): { why: "no-source" | "no-version" | "unknown-version" | "no-download", newest }
// (newest: a version string, or null when the source has nothing to download either), or null when it can be re-signed.
export function markedResignProblem(pkg, installed) {
  if (markedVersionOnSource(pkg, installed)) return null;
  const app = pkg?.stanza?.ipa;
  const newest = appJob(pkg)?.version ?? null;
  if (!app) return { why: "no-source", newest: null };
  if (!installed) return { why: "unknown-version", newest };
  const has = app.versions?.some((x) => x.version === installed);
  return { why: has ? "no-download" : "no-version", newest };
}

// F84: signing.install's params for a Custom Install job. The look's token holds the downloaded IPA on the phone for
// 15 minutes (native Sideload.swift inspect) and goes with the first try; past 14 minutes, or once it was used (a
// failed run keeps the job queued), the url downloads it again. The edits go either way.
export const TOKEN_LIFE = 14 * 60 * 1000;
export function customParams(job, now = Date.now()) {
  const o = job?.options;
  if (!o) return null;
  const edits = { ...(o.edits ?? {}) };
  delete edits.token;
  delete edits.url;
  const fresh = o.token && Number.isFinite(o.at) && now - o.at < TOKEN_LIFE;
  return fresh ? { token: o.token, ...edits } : { url: job.url, ...edits };
}

// ---- F379: a custom install's saved IPA (core/myipas.js saveInstalledIpa) ------------------------------------------
//
//   customInstallSave(job) -> saveInstalledIpa's first argument for a Custom Install job (it has options and a url),
//                        with the edits it was signed with; null for anything else (a source's plain Install, a My IPAs
//                        file, iFizBox itself, a Remove)
//   savedResignJob(job, entries, { match }) -> a Re-sign with no url of its own, signed from the app's saved IPA when
//                        My IPAs has that app at the installed version (`match`: core/myipas.js savedIpa; its file and
//                        Sign Options, as libraryJob's); else the job
//   await withSavedIpa(job, { call }) -> savedResignJob over library.list (the job as it is when the list fails);
//                        core/myipas.js is loaded only then, so it stays out of the app's startup modules
export function customInstallSave(job) {
  if (!job || job.op === "remove" || job.library || job.id === SELF_ID || !job.url || !job.options) return null;
  const edits = { ...(job.options.edits ?? {}) };
  delete edits.token;
  delete edits.url;
  const id = typeof job.id === "string" && !job.id.startsWith("library:") ? job.id : null;
  return { url: job.url, bundleId: id, version: job.version || null, edits };
}

export function savedResignJob(job, entries, { match } = {}) {
  if (job?.mode !== "resign" || job.url || job.library || typeof match !== "function") return job;
  const entry = match(entries, { bundleId: job.id, version: job.installed || job.version });
  const lj = entry ? libraryJob(entry, { installed: true }) : null;
  if (!lj) return job;
  return { ...job, library: entry.file, options: lj.options, size: lj.size ?? job.size ?? null };
}

export async function withSavedIpa(job, { call } = {}) {
  if (job?.mode !== "resign" || job.url || job.library || typeof call !== "function") return job;
  try {
    const { savedIpa } = await import("./myipas.js");
    return savedResignJob(job, (await call("library.list", {}))?.ipas, { match: savedIpa });
  } catch { return job; }
}
