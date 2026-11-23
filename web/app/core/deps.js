// Plain-language dependency errors (F18; Sileo #255, Zebra #2052): resolves a package's Depends, Pre-Depends,
// Conflicts and Breaks against every source and the installed list (Provides counted, as apt does), and says what
// is wrong in one sentence with what to do. Pure JS, no DOM: the worker's catalog (core/catalog.js deps) runs it for
// the package page, and N4's Confirm sheet runs explainApt over apt's own output.
//
//   const index = depIndex({ available: [{ stanza, key }], installed: [stanza] })
//   explain(stanza, { device, index, homes })  -> { ok, problems: [problem], targets: { name: id } }
//   explainApt(output, { device, index, homes }) -> [problem]: apt-get's "unmet dependencies" and E: lines
//
//   problem: { kind, id, sentence, detail?, action?, blocking, via: [id] }
//     kind      "ios"         firmware (Cydia's stand-in for the iOS version) rules this iOS out
//               "ios-unknown" it states an iOS range and this iPhone's iOS version isn't known
//               "missing"     no source has the dependency and it isn't installed
//               "version"     sources have it, but not a version that satisfies the dependency
//               "conflict"    it conflicts with (or breaks) an installed package
//               "conflicted"  an installed package conflicts with (or breaks) it
//               "lists"       (explainApt only) apt can't read one of its own list files, or dpkg's status; id null
//     id       the package the sentence is about (the dependency, or the installed package); tapping opens it
//     action    { kind: "open", id } | { kind: "remove", id } | { kind: "add-source", name, url } |
//               { kind: "settings" }, with `label` ("Add Chariz", "Remove Y", "Open X", "Set iOS Version")
//     via       the chain of packages that pulled the dependency in, outermost first ([] for a direct one)
//   targets: each dependency name the page lists -> the package id that opens for it (a virtual name like
//            mobilesubstrate opens its provider, ElleKit), for tappable Depends (Zebra #1414)
//
// Dependencies of dependencies are followed (a few levels down), so a missing library two steps away still gets
// its sentence: "Needs Foo, which needs libbar, which none of your sources has".
import { parseRelations, satisfies, compareVersions } from "./apt.js";

// Where well-known libraries live when none of the user's sources has them: rootless (iphoneos-arm64) builds,
// checked against each repo's Packages file on 2026-11-17. Every repo here is also in core/recommended.js (recommended.test.js).
const ELLEKIT = { name: "ElleKit", url: "https://ellekit.space/" };
const PALERA1N = { name: "palera1n", url: "https://repo.palera.in/" };
const CHARIZ = { name: "Chariz", url: "https://repo.chariz.com/" };
const HAVOC = { name: "Havoc", url: "https://havoc.app/" };
const KNOWN_HOMES = {
  "ellekit": ELLEKIT, "mobilesubstrate": ELLEKIT, "org.coolstar.libhooker": ELLEKIT,
  "preferenceloader": PALERA1N,
  "ws.hbang.common": CHARIZ, "ws.hbang.alderis": CHARIZ, "org.thebigboss.libcolorpicker": CHARIZ,
  "me.nepeta.libcolorpicker": CHARIZ, "dev.theos.orion14": CHARIZ, "dev.theos.orion": CHARIZ,
  "com.mrgcgamer.libgcuniversal": HAVOC,
};

const DEPTH = 4; // how far down dependencies of dependencies are followed

// The firmware package's version is the iOS version; it and the cy+ / gsc. names it provides come from the
// jailbreak itself, never from a source.
const isSystem = (name) => name === "firmware" || name.startsWith("cy+") || name.startsWith("gsc.");

// ---- index -------------------------------------------------------------------------------------------------

// name -> offers: real packages and what they Provide. An offer is { id, version, stanza, key } where `version` is
// the provided version (null for an unversioned Provides, which satisfies only unversioned dependencies, as apt).
export function depIndex({ available = [], installed = [] } = {}) {
  const add = (map, name, offer) => {
    let list = map.get(name);
    if (!list) map.set(name, (list = []));
    list.push(offer);
  };
  const fill = (map, stanza, key) => {
    const id = stanza?.package;
    if (!id) return;
    add(map, id, { id, version: stanza.version ?? "", stanza, key, real: true });
    for (const g of parseRelations(stanza.provides)) for (const p of g) {
      if (p.name !== id) add(map, p.name, { id, version: p.op === "=" ? p.version : null, stanza, key, real: false });
    }
  };
  const avail = new Map();
  const inst = new Map();
  for (const a of available) fill(avail, a.stanza ?? a, a.key ?? null);
  for (const st of installed) fill(inst, st, null);
  return { available: avail, installed: inst };
}

const offerOk = (o, r) => (!r.op ? true : o.version != null && satisfies(o.version, r.op, r.version));
const nameOf = (st, fallback) => st?.name || fallback;

// ---- wording -----------------------------------------------------------------------------------------------

// "16.0 or later", "older than 16.0": a version bound in words.
function bound(op, version) {
  switch (op) {
    case ">=": case ">": return `${version} or later`; // old dpkg: ">" and "<" mean >= and <=
    case ">>": return `newer than ${version}`;
    case "<=": case "<": return `${version} or earlier`;
    case "<<": return `older than ${version}`;
    default: return `${version}`;
  }
}

// "iOS 16.0 or later", "iOS older than 16.0", "iOS 15.4".
const iosBound = (op, version) => (op ? `iOS ${bound(op, version)}` : "iOS");
// The opposite of a Conflicts bound: `Conflicts: firmware (>= 17.0)` -> "iOS 17.0 or later" is ruled out.
const notOn = (op, version) => (op ? `iOS ${bound(op, version)}` : "any iOS version");

// "X 2.0 or later", "X" when unversioned.
const want = (label, r) => (r.op ? `${label} ${r.op === "=" ? `version ${r.version}` : bound(r.op, r.version)}` : label);

// "Needs " / "Foo needs " followed by the chain: "Needs A, which needs B, which ...".
function lead(subject, via, names) {
  const start = subject ? `${subject} needs ` : "Needs ";
  return start + via.map((id) => `${names(id)}, which needs `).join("");
}

const FIRMWARE_DETAIL = "firmware isn't a package you can install: it stands for this iPhone's iOS version, which the jailbreak sets. Look for another version of the package, or one made for your iOS.";

// ---- explain -----------------------------------------------------------------------------------------------

export function explain(stanza, { device = null, index = depIndex(), homes = KNOWN_HOMES, subject = null } = {}) {
  const problems = [];
  const targets = {};
  const self = stanza?.package;
  const names = (id) => nameOf(index.installed.get(id)?.find((o) => o.real)?.stanza ?? index.available.get(id)?.find((o) => o.real)?.stanza, id);
  const ios = iosOf(device, index);
  const seen = new Set(self ? [self] : []);
  const push = (p) => { if (!problems.some((q) => q.sentence === p.sentence)) problems.push(p); };

  const walk = (st, via) => {
    const groups = [...parseRelations(st["pre-depends"]), ...parseRelations(st.depends)];
    for (const g of groups) {
      const r = resolveGroup(g, index, ios);
      if (!via.length) for (const alt of g) { const t = targetOf(alt, index); if (t) targets[alt.name] = t; }
      if (r.ok) {
        // Something will be installed for it: follow its own dependencies.
        if (r.install && via.length < DEPTH && !seen.has(r.install.id)) {
          seen.add(r.install.id);
          walk(r.install.stanza, [...via, r.install.id]);
        }
        continue;
      }
      push(sentenceFor(r.unknown && !r.failures.length ? r.unknown : r.failures[0], via, { subject, names, homes, ios }));
    }
    // Conflicts and Breaks against what is installed (only for the package asked about: a dependency's conflicts
    // are apt's to report, and it says them in the Confirm sheet).
    if (via.length) return;
    for (const g of [...parseRelations(st.conflicts), ...parseRelations(st.breaks)]) for (const r of g) {
      if (isSystem(r.name)) {
        if (r.name !== "firmware" || !ios) continue;
        if (!r.op || satisfies(ios, r.op, r.version)) {
          push({ kind: "ios", id: "firmware", blocking: true, via: [],
            sentence: `${subject ? `${subject} doesn't` : "Doesn't"} work on ${notOn(r.op, r.version)} (you have ${ios}).`, detail: FIRMWARE_DETAIL });
        }
        continue;
      }
      for (const o of index.installed.get(r.name) ?? []) {
        if (o.id === self || !offerOk(o, r)) continue;
        const n = names(o.id);
        push({ kind: "conflict", id: o.id, blocking: true, via: [],
          sentence: `${subject ? `${subject} conflicts` : "Conflicts"} with ${n}, which is installed (remove ${n} first).`,
          action: { kind: "remove", id: o.id, label: `Remove ${n}` } });
      }
    }
    // The other way round: an installed package that conflicts with this one (or with what it provides).
    if (!self) return;
    const mine = [{ name: self, version: st.version ?? "" }];
    for (const g of parseRelations(st.provides)) for (const p of g) mine.push({ name: p.name, version: p.op === "=" ? p.version : null });
    const installedOffers = new Map();
    for (const list of index.installed.values()) for (const o of list) if (o.real) installedOffers.set(o.id, o.stanza);
    for (const [id, ist] of installedOffers) {
      if (id === self) continue;
      for (const g of [...parseRelations(ist.conflicts), ...parseRelations(ist.breaks)]) for (const r of g) {
        const hit = mine.find((m) => m.name === r.name && (!r.op || (m.version != null && satisfies(m.version, r.op, r.version))));
        if (!hit) continue;
        const n = names(id);
        push({ kind: "conflicted", id, blocking: true, via: [],
          sentence: `${n}, which is installed, conflicts with ${subject ?? "it"} (remove ${n} first).`,
          action: { kind: "remove", id, label: `Remove ${n}` } });
      }
    }
  };
  if (stanza) walk(stanza, []);
  return { ok: !problems.some((p) => p.blocking), problems, targets };
}

// The iOS version to judge firmware by: the device's, else an installed firmware package's (in the app, dpkg's
// status lists it with the iOS version), else null.
function iosOf(device, index) {
  if (device?.ios) return String(device.ios);
  const fw = index.installed.get("firmware")?.find((o) => o.real);
  return fw?.version || null;
}

// Which package opens for a dependency name: an installed or available package by that id, else its provider.
function targetOf(r, index) {
  for (const map of [index.installed, index.available]) {
    const list = map.get(r.name);
    if (!list?.length) continue;
    return (list.find((o) => o.real) ?? list[0]).id;
  }
  return null;
}

// One alternative group: { ok, install?, unknown?, failures: [failure] }. `install` is the offer apt would install
// (null when an installed package already satisfies it). Failures come in the group's order.
function resolveGroup(group, index, ios) {
  const failures = [];
  let unknown = null;
  for (const r of group) {
    if (isSystem(r.name)) {
      if (r.name === "firmware") {
        if (!ios) { if (!r.op) return { ok: true }; unknown ??= { kind: "ios-unknown", r }; continue; }
        if (!r.op || satisfies(ios, r.op, r.version)) return { ok: true };
        failures.push({ kind: "ios", r });
        continue;
      }
      // cy+cpu.arm64 and the like: checkable only where dpkg's status says what firmware provides.
      const inst = index.installed.get(r.name);
      if (!inst) return { ok: true };
      if (inst.some((o) => offerOk(o, r))) return { ok: true };
      failures.push({ kind: "version", r, have: inst.map((o) => o.version).filter(Boolean), installedOnly: true });
      continue;
    }
    const inst = index.installed.get(r.name) ?? [];
    if (inst.some((o) => offerOk(o, r))) return { ok: true, install: null };
    const avail = index.available.get(r.name) ?? [];
    const good = avail.filter((o) => offerOk(o, r));
    if (good.length) {
      const best = good.reduce((a, b) => (compareVersions(a.stanza.version ?? "", b.stanza.version ?? "") >= 0 ? a : b));
      return { ok: true, install: best };
    }
    if (!avail.length && !inst.length) failures.push({ kind: "missing", r });
    else failures.push({ kind: "version", r, have: [...new Set(avail.map((o) => o.version).filter(Boolean))].sort(compareVersions),
      installed: inst.find((o) => o.version)?.version ?? null, id: (avail[0] ?? inst[0]).id });
  }
  return { ok: false, unknown, failures };
}

function sentenceFor(f, via, { subject, names, homes, ios }) {
  const r = f.r;
  const head = lead(subject, via, names);
  if (f.kind === "ios") {
    return { kind: "ios", id: "firmware", blocking: true, via,
      sentence: `${head}${iosBound(r.op, r.version)} (you have ${ios}).`, detail: FIRMWARE_DETAIL };
  }
  if (f.kind === "ios-unknown") {
    return { kind: "ios-unknown", id: "firmware", blocking: false, via,
      sentence: `${head}${iosBound(r.op, r.version)}: set your iOS version in Settings to check.`,
      action: { kind: "settings", label: "Set iOS Version" } };
  }
  const label = names(f.id ?? r.name);
  if (f.kind === "missing") {
    const home = homes?.[r.name];
    if (home) {
      return { kind: "missing", id: r.name, blocking: true, via,
        sentence: `${head}${want(label, r)}, which none of your sources has; it is on ${home.name}.`,
        action: { kind: "add-source", name: home.name, url: home.url, label: `Add ${home.name}` } };
    }
    return { kind: "missing", id: r.name, blocking: true, via,
      sentence: `${head}${want(label, r)}, which none of your sources has: add the source that carries it.` };
  }
  // version
  const id = f.id ?? r.name;
  const latest = f.have?.length ? f.have[f.have.length - 1] : null;
  let tail;
  if (f.installedOnly) tail = latest ? `; this iPhone has ${latest}.` : ".";
  else if (f.installed && !latest) tail = `; you have ${f.installed} installed and no source has a newer one.`;
  else if (f.installed) tail = `; you have ${f.installed} installed and your sources have ${latest} at most.`;
  else tail = latest ? `; your sources have ${latest} at most.` : "; your sources have only a version that doesn't say which.";
  return { kind: "version", id, blocking: true, via, sentence: `${head}${want(label, r)}${tail}`,
    action: f.installedOnly ? undefined : { kind: "open", id, label: `Open ${label}` } };
}

// ---- apt's own output (N4's Confirm sheet) -------------------------------------------------------------------

// "E: Problem with MergeList <file>": apt can't parse one of its own files, and then refuses every command. A list
// file is named after the URL it came from (repo.twickd.com_._en, apt.procurs.us_dists_1800_main_..._Packages),
// so its first part is the source's host; Refresh downloads it again. dpkg's status file is another matter:
// Refresh doesn't rewrite it.
function unreadableList(path) {
  const file = path.split("/").pop();
  if (file === "status" && /\/dpkg\//.test(path)) {
    return { kind: "lists", id: null, blocking: true, via: [],
      sentence: `apt can't read dpkg's status file (${path}), the list of what is installed, so it won't run. Refreshing sources won't fix it: it needs repairing in a terminal.` };
  }
  let host = file.split("_")[0];
  try { host = decodeURIComponent(host); } catch { /* keep it as written */ }
  return { kind: "lists", id: null, blocking: true, via: [],
    sentence: `apt can't read the list it downloaded from ${host || "a source"} (${file}), so it won't run. Refresh your sources to download it again.` };
}

// apt-get's report, line by line:
//    foo : Depends: bar (>= 2) but it is not installable
//          PreDepends: firmware (>= 16.0) but 15.4 is installed
//          Conflicts: baz but 1.0 is installed
//   E: Unable to locate package qux
// Each line becomes a problem in the same words as explain(), named after the package ("Foo needs ..."). Lines it
// can't read are left for the raw output under it.
export function explainApt(output, { device = null, index = depIndex(), homes = KNOWN_HOMES } = {}) {
  const problems = [];
  const names = (id) => nameOf(index.installed.get(id)?.find((o) => o.real)?.stanza ?? index.available.get(id)?.find((o) => o.real)?.stanza, id);
  const ios = iosOf(device, index);
  let pkg = null;
  let unreadable = false; // "The package lists or status file could not be parsed or opened."
  for (const raw of String(output ?? "").split(/\r?\n/)) {
    if (/^E: The package lists or status file could not be parsed/.test(raw)) { unreadable = true; continue; }
    let m = raw.match(/^E: Problem with MergeList (\S+)/);
    if (m) { problems.push(unreadableList(m[1])); continue; }
    m = raw.match(/^E: Unable to locate package (\S+)/);
    if (m) {
      const home = homes?.[m[1]];
      problems.push({ kind: "missing", id: m[1], blocking: true, via: [],
        sentence: home ? `None of your sources has ${m[1]}; it is on ${home.name}.` : `None of your sources has ${m[1]}: add the source that carries it.`,
        ...(home ? { action: { kind: "add-source", name: home.name, url: home.url, label: `Add ${home.name}` } } : {}) });
      continue;
    }
    m = raw.match(/^E: Package '?([^' ]+)'? has no installation candidate/);
    if (m) {
      problems.push({ kind: "missing", id: m[1], blocking: true, via: [],
        sentence: `${names(m[1])} is known but no source offers a version of it for this iPhone.` });
      continue;
    }
    m = raw.match(/^\s+(?:(\S+)\s+:\s+)?(Depends|PreDepends|Pre-Depends|Conflicts|Breaks):\s+(.+?)\s+but\s+(.+?)\s*$/);
    if (!m) { if (!/^\s/.test(raw)) pkg = null; continue; }
    if (m[1]) pkg = m[1];
    if (!pkg) continue;
    const [, , field, relText, why] = m;
    const r = parseRelations(relText)[0]?.[0];
    if (!r) continue;
    const subject = names(pkg);
    const have = why.match(/^(\S+) is (?:to be )?installed$/)?.[1] ?? null;
    if (field === "Conflicts" || field === "Breaks") {
      const n = names(r.name);
      problems.push({ kind: "conflict", id: r.name, blocking: true, via: [],
        sentence: `${subject} conflicts with ${n}, which is installed (remove ${n} first).`,
        action: { kind: "remove", id: r.name, label: `Remove ${n}` } });
      continue;
    }
    if (r.name === "firmware") {
      const you = have ?? ios;
      problems.push({ kind: "ios", id: "firmware", blocking: true, via: [], detail: FIRMWARE_DETAIL,
        sentence: `${subject} needs ${iosBound(r.op, r.version)}${you ? ` (you have ${you})` : ""}.` });
      continue;
    }
    // "but it is not installable" / "not going to be installed" / "<v> is to be installed": the index knows why.
    const res = resolveGroup([r], index, ios);
    let f = res.failures?.[0];
    if (!f && have) f = { kind: "version", r, have: [have], installed: null, id: r.name };
    if (!f) f = { kind: (index.available.get(r.name) || index.installed.get(r.name)) ? "version" : "missing", r, have: [], id: r.name };
    problems.push(sentenceFor(f, [], { subject, names, homes, ios }));
  }
  if (unreadable && !problems.some((p) => p.kind === "lists")) {
    problems.push({ kind: "lists", id: null, blocking: true, via: [],
      sentence: "apt can't read its package lists, so it won't run. Refresh your sources to download them again." });
  }
  const out = [];
  for (const p of problems) if (!out.some((q) => q.sentence === p.sentence)) out.push(p);
  return out;
}
