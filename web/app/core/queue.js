// The install queue (N4), Cydia's model in pure JS (no DOM): what is queued, the words the root helper gets, what
// apt says it will change (`apt-get -s`), the console's lines and the finish button, and the kept console logs.
// The UI is screens/queue.js; the store the app shares is queue.js; the helper's verbs are native/helper/README.md.
//
//   const q = createQueue();
//   q.add({ op: "install", id, version, installed })  // installed: the version on the phone, or null
//   q.add({ op: "remove", id })
//   q.list() -> [job]   q.get(id)   q.clear(id)   q.clearAll()   q.subscribe(fn) -> unsubscribe
//   q.add(job, { quiet: true })   q.restore(id, job | null)   F193: a swipe's add and its Undo (no Confirm sheet)
//   job: { op, id, version, mode, name }   mode: install | reinstall | upgrade | downgrade | remove
//
//   queueWords(jobs)          -> ["com.a", "com.b=1.0", "-com.c"]   ifizbox-helper simulate|apply <words>
//   parseSimulation(text)     -> { installs, reinstalls, upgrades, downgrades, removes, essential, download }
//   parseStatusLine(line)     -> { type: "status" | "error" | "conffile" | "finish", ... } (apt's Status-Fd, $CYDIA)
//   finishOf(levels...)       -> the highest of return | uicache | reopen | restart | reload | reboot
//   CONFFILE_TITLE, CONFFILE_BUTTONS, conffileMessage(file), conffileAnswer(index), conffileLine(file, answer)
//                             F63: the Configuration Upgrade alert and the word it answers (keep | new)
//   createRunLog(storage)     -> the console logs Settings shows (F361: start() keeps a run as it goes)
//   runState(e), runStatusText(e)  an entry's running | done | failed | cancelled | stopped, and its words
//   createRepeatFilter()      -> (type, text) -> false for a status line the same as the one before (C6)
//   debUrlOf(history, version), isAbsoluteFilename(f), mergePlans(plans)
//                             F131: a Filename that is a full URL, fetched by the shell instead of apt
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { compareVersions, parseRelations } from "./apt.js";
import { NAME } from "../brand.js";

export const MODES = ["install", "reinstall", "upgrade", "downgrade", "remove"];
// Cydia's words for each mode (Localizable.strings INSTALL, REINSTALL, UPGRADE, DOWNGRADE, REMOVE).
export const MODE_LABEL = { install: "Install", reinstall: "Reinstall", upgrade: "Upgrade", downgrade: "Downgrade", remove: "Remove" };
// Cydia's QUEUED_FOR: "Queued for %@", over the mode's word.
export const queuedFor = (mode) => `Queued for ${MODE_LABEL[mode] ?? mode}`;

// What installing `version` does to a package with `installed` on the phone (null: not installed). No version
// means the newest a source has: an upgrade when it is installed.
export function modeOf({ op, version = null, installed = null }) {
  if (op === "remove") return "remove";
  if (!installed) return "install";
  if (!version) return "upgrade";
  const c = compareVersions(version, installed);
  return c === 0 ? "reinstall" : c > 0 ? "upgrade" : "downgrade";
}

export function createQueue() {
  const jobs = new Map();
  const listeners = new Set();
  const emit = (event) => { for (const f of [...listeners]) { try { f(event); } catch { /* a listener's bug isn't the queue's */ } } };
  return {
    // A package is queued once: queuing it again replaces what it was queued for (Cydia's marks work the same).
    // F193: `quiet` (a row's swipe) tells listeners not to open the Confirm sheet for it.
    add({ op, id, version = null, installed = null, name = null }, { quiet = false } = {}) {
      if (op !== "install" && op !== "remove") throw new Error(`unknown queue op ${op}`);
      if (!id) throw new Error("no package id");
      const job = { op, id, version: op === "remove" ? null : version || null, mode: modeOf({ op, version, installed }), name: name || null };
      jobs.set(id, job);
      emit(quiet ? { type: "add", job, quiet } : { type: "add", job });
      return job;
    },
    // F193's Undo: put a package back as it was, a job get() returned before (or null: not queued). Quiet.
    restore(id, job) {
      if (!job) return this.clear(id);
      jobs.set(id, { ...job });
      emit({ type: "add", job: jobs.get(id), quiet: true });
    },
    get: (id) => jobs.get(id) ?? null,
    list: () => [...jobs.values()],
    get size() { return jobs.size; },
    // The name, once the UI knows it (the Confirm sheet and the marks show names, the helper ids).
    name(id, name) { const j = jobs.get(id); if (j && name && j.name !== name) { j.name = name; emit({ type: "name", job: j }); } },
    clear(id) { if (jobs.delete(id)) emit({ type: "clear", id }); },
    clearAll() { if (!jobs.size) return; jobs.clear(); emit({ type: "clearAll" }); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

// The helper's items (ifizbox-helper simulate|apply): "id" installs the newest, "id=version" that version (Reinstall,
// Downgrade and the Version History pick one), "-id" removes.
export function queueWords(jobs) {
  return jobs.map((j) => (j.op === "remove" ? `-${j.id}` : j.version ? `${j.id}=${j.version}` : j.id));
}

// The helper's own rules for a queued package (native/helper/policy.c helper_name_ok and helper_version_ok: what dpkg
// installs), so one that can't go is said in plain words instead of the helper's exit 64. jobs -> [sentence].
export function jobIssues(jobs, label = (j) => j.name || j.id) {
  const out = [];
  const seen = new Map(); // lower case, as dpkg and apt know a name
  for (const j of jobs) {
    const key = lowerId(j.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{1,254}$/.test(j.id) || (j.op !== "remove" && j.id.endsWith("-"))) {
      out.push(`${label(j)} can't be ${j.op === "remove" ? "removed" : "installed"}: its source gives it a name dpkg doesn't take (${j.id}). Only the source can fix that.`);
    } else if (j.op !== "remove" && j.version && !/^[0-9](?:[A-Za-z0-9.+~:-]{0,253}[A-Za-z0-9.+~:])?$/.test(j.version)) {
      out.push(`${label(j)} can't be installed: its source gives it a version dpkg doesn't take (${j.version}). Only the source can fix that.`);
    } else if (seen.has(key)) {
      out.push(`${label(j)} is queued twice: ${seen.get(key)} and ${j.id} are one package to apt. Clear one of them.`);
    }
    if (!seen.has(key)) seen.set(key, j.id);
  }
  return out;
}

// dpkg's and apt's spelling of a package name: they know every name in lower case.
export const lowerId = (id) => String(id ?? "").replace(/[A-Z]+/g, (s) => s.toLowerCase());

// apt answers about Oreo as oreo: give the plan's entries the queued jobs' own ids back, which the catalog knows.
export function planForJobs(plan, jobs) {
  const ids = new Map(jobs.map((j) => [lowerId(j.id), j.id]));
  const own = (id) => ids.get(id) ?? id;
  const out = { ...plan, essential: plan.essential.map(own) };
  for (const m of MODES) out[`${m}s`] = plan[`${m}s`].map((e) => ({ ...e, id: own(e.id) }));
  return out;
}

// Packages Cydia never lets go: removing the iOS stand-ins (firmware, gsc.*, cy+*) is an issue, not a change.
const SYSTEM = (id) => id === "firmware" || id.startsWith("gsc.") || id.startsWith("cy+");

// apt-get -s's plan, as the Confirm sheet's Modifications (Cydia's cydiaConfirm.changes):
//   Inst foo [1.0] (1.1 Repo:1.0/stable [iphoneos-arm64])   an upgrade (a downgrade, or a reinstall when equal)
//   Inst bar (2.0 Repo [iphoneos-arm64])                     a new install
//   Remv baz [3.0]                                           a removal (Purg too)
// Each entry is { id, from, to }. `essential`: what apt warns are essential packages being removed, plus the
// system stand-ins. `download`: apt's "Need to get" size, when it says one.
export function parseSimulation(text) {
  const out = { installs: [], reinstalls: [], upgrades: [], downgrades: [], removes: [], essential: [], download: null };
  let inEssential = false;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (/^WARNING: The following essential packages will be removed/.test(line)) { inEssential = true; continue; }
    if (inEssential) {
      if (/^This should NOT be done/.test(line)) continue;
      if (/^\s+\S/.test(line)) {
        for (const id of line.replace(/\(due to [^)]*\)/g, " ").trim().split(/\s+/)) if (/^[a-z0-9][a-z0-9._+:-]*$/i.test(id)) out.essential.push(id.replace(/:.*$/, ""));
        continue;
      }
      inEssential = false;
    }
    const size = line.match(/^Need to get (?:[^/]+\/)?(.+?) of archives/);
    if (size) { out.download = size[1]; continue; }
    let m = line.match(/^Inst (\S+)(?: \[([^\]]*)\])? \((\S+)/);
    if (m) {
      const [, id, from = null, to] = m;
      const e = { id: id.replace(/:[a-z0-9-]+$/, ""), from, to };
      if (!from) out.installs.push(e);
      else {
        const c = compareVersions(to, from);
        (c === 0 ? out.reinstalls : c > 0 ? out.upgrades : out.downgrades).push(e);
      }
      continue;
    }
    m = line.match(/^(?:Remv|Purg) (\S+)(?: \[([^\]]*)\])?/);
    if (m) {
      const e = { id: m[1].replace(/:[a-z0-9-]+$/, ""), from: m[2] ?? null, to: null };
      out.removes.push(e);
      if (SYSTEM(e.id) && !out.essential.includes(e.id)) out.essential.push(e.id);
    }
  }
  return out;
}

export const changeCount = (plan) => MODES.reduce((n, m) => n + plan[`${m}s`].length, 0);

// The console's lines: apt's Status-Fd (pmstatus/dlstatus/pmerror/pmconffile), dpkg's "status:"/"processing:" and
// the finish word maintainer scripts write to $CYDIA. Anything else on that fd is plain information.
//   { type: "status", pkg, percent, text, download? }   white bold; the percent moves the progress bar
//   { type: "error", pkg, text }                        red
//   { type: "conffile", file, text }                    dpkg asks about a conffile both sides changed (F63:
//                                                       apply-ask waits for conffileAnswer's word; plain apply
//                                                       keeps the old copy, --force-confold)
//   { type: "finish", finish }                          raises the finish button
//   { type: "info", text }
export function parseStatusLine(line) {
  const s = String(line ?? "");
  let m = s.match(/^(pmstatus|dlstatus|pmerror|pmconffile):([^:]*):([0-9.]+):(.*)$/);
  if (m) {
    const [, kind, pkg, pct, text] = m;
    const percent = Math.max(0, Math.min(100, Number(pct) || 0));
    if (kind === "pmerror") return { type: "error", pkg, percent, text };
    if (kind === "pmconffile") return { type: "conffile", file: pkg, percent, text };
    return { type: "status", pkg, percent, text, ...(kind === "dlstatus" ? { download: true } : {}) };
  }
  m = s.match(/^finish:\s*(\S+)/);
  if (m) return FINISH.includes(m[1]) ? { type: "finish", finish: m[1] } : { type: "info", text: s };
  m = s.match(/^status:\s*([^:]+):\s*(.+)$/);
  if (m) {
    if (/conffile-prompt/.test(m[2])) return { type: "conffile", file: m[1].trim(), text: m[2].trim() };
    return { type: "status", pkg: m[1].trim(), text: `${m[1].trim()}: ${m[2].trim()}` };
  }
  m = s.match(/^processing:\s*([^:]+):\s*(.+)$/);
  if (m) return { type: "status", pkg: m[2].trim(), text: `${m[1].trim()} ${m[2].trim()}` };
  return { type: "info", text: s };
}

// F63: Cydia's Configuration Upgrade alert (CONFIGURATION_UPGRADE, CONFIGURATION_UPGRADE_EX, KEEP_OLD_COPY,
// ACCEPT_NEW_COPY). Keep is first and is the cancel button: dpkg's own default.
export const CONFFILE_TITLE = "Configuration Upgrade";
export const CONFFILE_BUTTONS = ["Keep My Old Copy", "Accept the New Copy"];
export const conffileMessage = (file) =>
  `The following file has been changed by both the package maintainer and by you (or for you by a script).\n\n${file}`;
// The alert's button index -> the word backend.answerConffile takes (anything but Accept keeps).
export const conffileAnswer = (index) => (index === 1 ? "new" : "keep");
// The console's line once answered.
export const conffileLine = (file, answer) =>
  answer === "new" ? `Configuration file ${file}: installing the package's new copy` : `Configuration file ${file}: keeping your copy`;

// Only the text after the last carriage return shows, so progress-bar lines collapse into one (Cydia's console).
export const consoleText = (line) => String(line ?? "").split("\r").filter((p) => p !== "").pop() ?? "";

// C6: apt's download status repeats itself ("Retrieving file 1 of 3" once per percent step), so a status line the
// same as the one just before it is shown once. Only status lines: plain output can repeat on purpose.
//   const keep = createRepeatFilter();  keep(type, text) -> false when it repeats the last status line
export function createRepeatFilter() {
  let last = null;
  return (type, text) => {
    const key = type === "status" ? String(text ?? "") : null;
    const repeat = key !== null && key === last;
    last = key;
    return !repeat;
  };
}

// Cydia's finish levels, lowest first; the button shows the highest reached. F151: uicache (Reload Data: the home
// screen's icon cache rebuilt, for an app) between return and reopen.
// return (a normal run: apt, an IPA) reads "Return to iFizBox" (Cydia's "Return to Cydia", B67) and only closes the
// sheet. reopen reads "Close iFizBox": iFizBox itself was upgraded and has to quit for the new copy to run
// (core/progress.js selfLevels).
const FINISH = ["return", "uicache", "reopen", "restart", "reload", "reboot"];
export const FINISH_LABEL = {
  return: `Return to ${NAME}`, uicache: "Reload Data", reopen: `Close ${NAME}`, restart: "Restart SpringBoard", reload: "Reload SpringBoard",
  reboot: "Reboot Device",
};
export function finishOf(...levels) {
  let best = 0;
  for (const l of levels) best = Math.max(best, FINISH.indexOf(l));
  return FINISH[best];
}

// Cydia restarts SpringBoard when a queued package (its old or new version) depends on mobilesubstrate. On
// rootless jailbreaks tweaks may name a hooking library instead, so those count too.
const HOOKERS = new Set(["mobilesubstrate", "ellekit", "com.ex.substitute", "org.coolstar.libhooker", "com.saurik.substrate.safemode"]);
export function needsRestart(stanzas) {
  for (const st of stanzas) {
    if (!st) continue;
    if (HOOKERS.has(st.package)) return true;
    for (const field of ["depends", "preDepends", "pre-depends"]) {
      const v = st[field];
      if (!v) continue;
      for (const group of parseRelations(v)) if (group.some((r) => HOOKERS.has(r.name))) return true;
    }
  }
  return false;
}

// ---- console logs (Settings > Console Logs) ------------------------------------------------------------------

export const LOG_KEY = "ifizbox.consoleLogs";
const LOG_MAX = 20;           // runs kept, newest first
const LOG_CHARS = 60_000;     // per run: the head and the tail of a longer one, with a note where it was cut

export function trimLog(text, max = LOG_CHARS) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  const head = Math.floor(max / 5);
  const tail = max - head;
  const cut = s.slice(head, s.length - tail).split("\n").length - 1;
  return `${s.slice(0, head)}\n… ${cut} lines left out …\n${s.slice(s.length - tail)}`;
}

// F361: a run is kept from its first line, not only once it ends: start() adds it as running and its handle's line()
// saves each line as it comes, so a run that hangs or is killed still leaves its log. Each page load has its own
// SESSION: an entry still running from an earlier one (the app was closed or killed mid-run) reads "stopped".
// An entry's state: running | done | failed | cancelled | stopped (older entries, without one, go by ok).
const SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const RUN_STATES = ["running", "done", "failed", "cancelled", "stopped"];
export function runState(e) {
  if (e?.state === "running") return e.session === SESSION ? "running" : "stopped";
  if (RUN_STATES.includes(e?.state)) return e.state;
  return e?.ok ? "done" : "failed";
}
// The words Console Logs shows for an entry's state.
export function runStatusText(e) {
  switch (runState(e)) {
    case "running": return "Running…";
    case "done": return "Completed";
    case "cancelled": return "Cancelled";
    case "stopped": return "Stopped";
    default: return e?.code == null || e.code === -1 ? "Failed" : `Failed (${e.code})`;
  }
}

// storage: a localStorage-like { getItem, setItem, removeItem }; none (or one that throws) keeps logs in memory.
// flushMs: a running entry's lines are saved at most this often (the first at once, the rest within flushMs), so a
// long apt run doesn't rewrite the whole list once per line; end() saves what is left.
export function createRunLog(storage = null, { max = LOG_MAX, chars = LOG_CHARS, now = () => Date.now(), session = SESSION,
  flushMs = 250, later = setTimeout, cancel = clearTimeout } = {}) {
  let mem = null;
  const read = () => {
    if (mem) return mem;
    try { const v = JSON.parse(storage?.getItem(LOG_KEY) ?? "[]"); if (Array.isArray(v)) return v; } catch { /* unreadable: start again */ }
    return [];
  };
  const write = (list) => {
    try { storage?.setItem(LOG_KEY, JSON.stringify(list)); mem = storage ? null : list; } catch {
      // Full: drop the oldest until it fits, else keep this session's in memory.
      for (let n = list.length - 1; n > 0; n--) {
        try { storage.setItem(LOG_KEY, JSON.stringify(list.slice(0, n))); mem = null; return; } catch { /* still too big */ }
      }
      mem = list;
    }
  };
  const stateOf = (run) => (run.state && RUN_STATES.includes(run.state) ? run.state
    : run.cancelled ? "cancelled" : run.code === 0 ? "done" : "failed");
  const put = (entry) => { write([entry, ...read()].slice(0, max)); return entry; };
  // Changes one kept entry (gone past the newest `max`: nothing). -> the entry as saved, or null
  const change = (id, f) => {
    const list = read();
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return null;
    list[i] = f(list[i]);
    write([...list]);
    return list[i];
  };
  const newId = (at) => `${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    // { title, jobs, code, finish, text, cancelled } -> the saved entry (with id and at), for a run that has ended
    add(run) {
      const at = now();
      return put({ id: newId(at), at, title: run.title ?? "", jobs: run.jobs ?? [],
        code: run.code ?? null, ok: run.code === 0, state: stateOf(run), text: trimLog(run.text, chars) });
    },
    // F361: { title, jobs, text } -> a handle for a run that is starting, saved now as running:
    //   line(text)                    one more line, saved at once
    //   set({ title, jobs })          what the run turned out to be (a name the answer gave)
    //   end({ code, cancelled, finish, text })   done (code 0), cancelled or failed; `text` replaces the lines
    // Calls after end() do nothing.
    start(run = {}) {
      const at = now();
      const lines = run.text ? [String(run.text)] : [];
      const entry = put({ id: newId(at), at, title: run.title ?? "", jobs: run.jobs ?? [], code: null, ok: false,
        state: "running", session, text: trimLog(lines.join("\n"), chars) });
      let over = false;
      let timer = null;
      let saved = 0; // when the lines were last saved
      const save = (patch) => change(entry.id, (e) => ({ ...e, ...patch }));
      const flush = () => {
        if (timer != null) { cancel(timer); timer = null; }
        saved = now();
        save({ text: trimLog(lines.join("\n"), chars) });
      };
      return {
        id: entry.id,
        line(text) {
          if (over || text == null) return;
          lines.push(String(text));
          if (flushMs <= 0 || now() - saved >= flushMs) flush();
          else if (timer == null) timer = later(() => { timer = null; if (!over) flush(); }, flushMs);
        },
        set(patch = {}) {
          if (over) return;
          const p = {};
          if (patch.title != null) p.title = patch.title;
          if (patch.jobs) p.jobs = patch.jobs;
          save(p);
        },
        end(result = {}) {
          if (over) return null;
          over = true;
          if (timer != null) { cancel(timer); timer = null; }
          const code = result.code ?? (result.cancelled ? null : -1);
          const text = result.text != null ? String(result.text) : lines.join("\n");
          return save({ code, ok: code === 0 && !result.cancelled, state: stateOf({ ...result, code }),
            ...(result.finish ? { finish: result.finish } : {}), text: trimLog(text, chars) });
        },
        get ended() { return over; },
      };
    },
    list: () => read().map(({ text, ...rest }) => ({ ...rest, state: runState(rest), lines: String(text).split("\n").length })),
    get: (id) => { const e = read().find((x) => x.id === id); return e ? { ...e, state: runState(e) } : null; },
    clear() { mem = null; try { storage?.removeItem(LOG_KEY); } catch { /* nothing to clear */ } if (!storage) mem = []; },
  };
}

// A run's title for the log list: "Install Foo, Remove Bar" (names where known).
export function runTitle(jobs) {
  const parts = jobs.map((j) => `${MODE_LABEL[j.mode] ?? j.op} ${j.name || j.id}`);
  return parts.length > 3 ? `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} more` : parts.join(", ");
}

// ---- F131: packages whose Filename is a full URL ------------------------------------------------------------------
//
// Some repos list `Filename: https://github.com/.../x.deb` (ios.jjolano.me). apt joins it to the repo's URL and 404s
// ("Failed to fetch https://ios.jjolano.me/https://github.com/..."); Sileo fetches the link itself. iFizBox does too:
// the Confirm sheet gives such a job its `debUrl` (debUrlOf over catalog.history), and the native backend downloads
// it (share.debFetch) and hands the file to ifizbox-helper simulate-deb / install-deb, beside apt's run for the rest.

// A Filename apt can't fetch: an absolute URL rather than a path under the repo.
const isAbsoluteFilename = (filename) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(filename ?? ""));

// catalog.history(id) ({ kind, versions: [{ version, keys, filename, debUrl, candidate }] }) and the job's version
// (null: the newest a source offers, the page's candidate) -> the http(s) link to download, or null when apt can
// fetch it (a relative Filename), the version isn't offered, or the link isn't http(s) (the shell only fetches those).
export function debUrlOf(history, version = null) {
  if (history?.kind !== "apt") return null;
  const offered = (history.versions ?? []).filter((v) => v.keys?.length);
  const v = version ? offered.find((o) => o.version === version) : offered.find((o) => o.candidate) ?? offered[0];
  if (!v || !isAbsoluteFilename(v.filename)) return null;
  return /^https?:\/\/[^/\s]+/i.test(v.debUrl ?? "") ? v.debUrl : null;
}

// F133: the job fields for a linked download (debUrlOf's link) with its stanza's hashes, which the shell checks the
// file against (share.debFetch): { debUrl, debSha256?, debMd5? }, or null when debUrlOf gives no link.
export function debLinkOf(history, version = null) {
  const debUrl = debUrlOf(history, version);
  if (!debUrl) return null;
  const offered = history.versions.filter((v) => v.keys?.length);
  const v = version ? offered.find((o) => o.version === version) : offered.find((o) => o.candidate) ?? offered[0];
  return { debUrl, ...(v?.sha256 ? { debSha256: v.sha256 } : {}), ...(v?.md5sum ? { debMd5: v.md5sum } : {}) };
}

// Several apt-get -s plans (parseSimulation's) as one: each package once per list (the first plan's entry), the
// essentials together, the first download size.
export function mergePlans(plans) {
  const out = { installs: [], reinstalls: [], upgrades: [], downgrades: [], removes: [], essential: [], download: null };
  const seen = new Set();
  for (const p of plans) {
    if (!p) continue;
    for (const mode of MODES) {
      for (const e of p[`${mode}s`] ?? []) {
        if (seen.has(`${mode}:${e.id}`)) continue;
        seen.add(`${mode}:${e.id}`);
        out[`${mode}s`].push(e);
      }
    }
    for (const id of p.essential ?? []) if (!out.essential.includes(id)) out.essential.push(id);
    out.download ??= p.download ?? null;
  }
  return out;
}
