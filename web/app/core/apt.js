// APT repository parsing, shared by the site and the app: control stanzas (Packages, Release), repo URL layout,
// resolving Filename and Icon against the repo, and Debian version comparison. Pure functions, no DOM, no I/O:
// callers fetch and decode, this only turns text into data. Heavy parses run in core/worker.js.

// ---- package ids -------------------------------------------------------------------------------------------
// Package ids compare ignoring case (B407): dpkg and apt write every name in lower case (oreo), a source may not
// (Oreo), and the two are one package. IdMap and IdSet look ids up that way. Their keys come out in lower case, so
// take the spelling to show or send from the value (a row's id, a stanza's package), never from a key.

// dpkg's and apt's spelling of a package name: they know every name in lower case.
export const lowerId = (id) => String(id ?? "").replace(/[A-Z]+/g, (s) => s.toLowerCase());
export const sameId = (a, b) => lowerId(a) === lowerId(b);

// { id: name } with each name under dpkg's spelling of the id too: apt's status lines say oreo for a queued Oreo.
export function withLowerIds(names) {
  const out = { ...names };
  for (const [id, name] of Object.entries(names)) out[lowerId(id)] ??= name;
  return out;
}

export class IdMap extends Map {
  get(id) { return super.get(lowerId(id)); }
  has(id) { return super.has(lowerId(id)); }
  set(id, value) { return super.set(lowerId(id), value); }
  delete(id) { return super.delete(lowerId(id)); }
}

export class IdSet extends Set {
  has(id) { return super.has(lowerId(id)); }
  add(id) { return super.add(lowerId(id)); }
  delete(id) { return super.delete(lowerId(id)); }
}

// ---- control files (deb822) -------------------------------------------------------------------------------

// Parses control-file text into stanzas: one plain object per paragraph, field names lower-cased (Debian field
// names are case-insensitive, and real repos ship `homepage:` beside `Homepage:`). A continuation line (leading
// space or tab) is appended to the field with "\n" and its first whitespace character dropped, so a multi-line
// Description reads "short\nline\n.\n verbatim" (see `description`). The first of duplicate fields wins, as in
// apt. `#` comment lines are skipped, as deb822 allows; lines with no colon outside a field are ignored.
export function parseControl(text) {
  const stanzas = [];
  let cur = null;
  let key = null;
  const s = String(text ?? "").replace(/^﻿/, "");
  let pos = 0;
  const n = s.length;
  while (pos <= n) {
    let end = s.indexOf("\n", pos);
    if (end < 0) end = n;
    let line = s.slice(pos, end);
    pos = end + 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (/^[ \t]*$/.test(line)) { // blank: paragraph break
      if (cur) stanzas.push(cur);
      cur = null; key = null;
      continue;
    }
    const c = line[0];
    if (c === " " || c === "\t") {
      if (cur && key !== null) cur[key] += "\n" + line.slice(1).replace(/[ \t]+$/, "");
      continue;
    }
    if (c === "#") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) { key = null; continue; }
    const k = line.slice(0, colon).trim().toLowerCase();
    cur ??= {};
    if (Object.hasOwn(cur, k)) { key = null; continue; } // duplicate: keep the first, drop its continuations
    cur[k] = line.slice(colon + 1).trim();
    key = k;
  }
  if (cur) stanzas.push(cur);
  return stanzas;
}

// Splits a stanza's Description into the one-line synopsis and the long text. In the long text a lone "."
// (policy's " .") is an empty line; lines that began with two spaces keep one, meaning "show verbatim".
export function description(stanza) {
  const raw = stanza?.description ?? "";
  const nl = raw.indexOf("\n");
  if (nl < 0) return { short: raw, long: "" };
  const long = raw.slice(nl + 1).split("\n").map((l) => (l === "." ? "" : l)).join("\n");
  return { short: raw.slice(0, nl), long };
}

// Comma-separated relationship fields (Depends, Conflicts, …) as a list of alternatives:
// "a (>= 1), b | c" -> [[{name:"a", op:">=", version:"1"}], [{name:"b"}, {name:"c"}]]. Architecture
// qualifiers (`:any`) and restriction lists (`[…]`, `<…>`) are kept off the name.
export function parseRelations(value) {
  if (!value) return [];
  return String(value).split(",").map((group) => group.split("|").map((alt) => {
    const m = alt.trim().match(/^([^\s(\[<:]+)(?::([^\s(\[<]+))?\s*(?:\(\s*(<<|<=|>=|>>|=|<|>)\s*([^)\s]+)\s*\))?/);
    if (!m) return null;
    const r = { name: m[1] };
    if (m[2]) r.arch = m[2];
    if (m[3]) { r.op = m[3]; r.version = m[4]; }
    return r;
  }).filter(Boolean)).filter((g) => g.length);
}

// ---- Release ----------------------------------------------------------------------------------------------

// Strips the OpenPGP clear-signature from an InRelease file (and undoes its dash-escaping). Plain Release text
// is returned as it is. The signature is not checked here.
export function stripClearsign(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  if (!s.startsWith("-----BEGIN PGP SIGNED MESSAGE-----")) return s;
  const lines = s.split(/\r?\n/);
  let i = 1;
  while (i < lines.length && lines[i] !== "") i++; // armor headers ("Hash: SHA256") end at the first blank line
  const body = [];
  for (i++; i < lines.length && !lines[i].startsWith("-----BEGIN PGP SIGNATURE-----"); i++) {
    body.push(lines[i].startsWith("- ") ? lines[i].slice(2) : lines[i]);
  }
  return body.join("\n");
}

const HASH_FIELDS = ["md5sum", "sha1", "sha256", "sha512"];

// Parses a Release or InRelease file: `fields` is the stanza as parseControl gives it; the space-separated
// lists come out as arrays; each hash field becomes [{hash, size, path}].
export function parseRelease(text) {
  const fields = parseControl(stripClearsign(text))[0] ?? {};
  const words = (v) => (v ? v.split(/\s+/).filter(Boolean) : []);
  const hashes = {};
  for (const h of HASH_FIELDS) {
    if (!fields[h]) continue;
    hashes[h] = fields[h].split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3)
      .map(([hash, size, ...path]) => ({ hash, size: Number(size), path: path.join(" ") }));
  }
  return {
    fields,
    origin: fields.origin ?? "",
    label: fields.label ?? "",
    suite: fields.suite ?? "",
    codename: fields.codename ?? "",
    version: fields.version ?? "",
    description: fields.description ?? "",
    architectures: words(fields.architectures),
    components: words(fields.components),
    hashes,
  };
}

// ---- repo layout and URLs ---------------------------------------------------------------------------------

// iFizBox targets rootless jailbreaks; "iphoneos-arm" (rootful, palera1n rootful) and "iphoneos-arm64e" (roothide,
// F38) stay available as a setting.
export const DEFAULT_ARCH = "iphoneos-arm64";
export const ARCHES = ["iphoneos-arm64", "iphoneos-arm", "iphoneos-arm64e"];

// Whether a stanza is installable on `arch`: its Architecture is that arch or "all". Flat repos list rootful and
// rootless builds in one Packages file, so every package list goes through this. A stanza with no Architecture
// is dropped: apt needs the field for binary packages, and old repos that leave it out are rootful.
export function matchesArch(stanza, arch = DEFAULT_ARCH) {
  const a = stanza?.architecture;
  return a === arch || a === "all";
}

export const filterArch = (stanzas, arch = DEFAULT_ARCH) => stanzas.filter((s) => matchesArch(s, arch));

// How many packages a Packages text holds for `arch`: unique package ids, not stanzas, since a repo often lists
// several versions of one package (the Sources tab's count, matching the source's own package list).
export function countPackages(text, arch = DEFAULT_ARCH) {
  const ids = new Set();
  for (const s of parseControl(text)) if (s.package && matchesArch(s, arch)) ids.add(s.package);
  return ids.size;
}

// Where a source's index files live. `source` is a sources.list line ("deb URI DIST [COMPONENT…]") or
// {uri, dist, components}. A dist ending in "/" ("./", the usual Cydia repo) is a flat repo: Release and
// Packages sit in that directory and no components are allowed. Otherwise it's a dist repo:
// URI/dists/DIST/Release and URI/dists/DIST/COMPONENT/binary-ARCH/Packages. Either way `root` is the URI with a
// trailing slash, which Filename (and a relative Icon) resolve against, as apt does. `arch` defaults to rootless
// (iphoneos-arm64); pass "iphoneos-arm" for rootful jailbreaks.
export function repoLayout(source, arch = DEFAULT_ARCH) {
  let { uri, dist, components } = typeof source === "string" ? parseSourceLine(source) : source;
  if (!uri) throw new Error("repo source has no URI");
  const root = new URL(String(uri).replace(/\/*$/, "/")).href;
  dist = dist || "./";
  components = components ?? [];
  if (dist.endsWith("/")) {
    const base = new URL(safeRelative(dist), root).href;
    return { flat: true, root, base, release: base + "Release", inRelease: base + "InRelease", packages: [base + "Packages"] };
  }
  const base = new URL(`dists/${encodePath(dist)}/`, root).href;
  return {
    flat: false, root, base,
    release: base + "Release",
    inRelease: base + "InRelease",
    packages: components.map((c) => `${base}${encodePath(c)}/binary-${arch}/Packages`),
  };
}

// "deb https://repo.example/ ./" -> {type, uri, dist, components}. Options in brackets are skipped.
export function parseSourceLine(line) {
  const words = String(line).replace(/#.*/, "").replace(/\[[^\]]*\]/, " ").trim().split(/\s+/);
  const [type, uri, dist, ...components] = words;
  return { type, uri, dist, components };
}

// A package's download URL: its Filename resolved against the repo root.
export function resolveFilename(root, filename) {
  if (!filename) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) return filename; // already absolute (some repos do this)
  return new URL(safeRelative(filename), root).href;
}

// A package's Icon as a URL. http(s) and data: URLs are kept. file:/// is a path on the device (an app or
// PreferenceLoader icon the package installs), so it only shows once installed and only in the app; the
// misspellings real repos ship ("files:///", "file::///", "file://Applications/…") and bare absolute paths are
// normalised to file:///. Anything else is relative to the repo root (Sileo/Zebra-style repo-hosted icons).
// Returns null when there is no Icon.
export function resolveIcon(root, icon) {
  const s = String(icon ?? "").trim();
  if (!s) return null;
  if (/^(https?:|data:)/i.test(s)) return s;
  const local = s.match(/^files?:+\/*(.*)$/i);
  if (local) return "file:///" + encodePath(local[1]);
  if (s.startsWith("/")) return "file:///" + encodePath(s.replace(/^\/+/, ""));
  return root ? new URL(safeRelative(s), root).href : null;
}

// Parses a Packages file and adds the resolved `debUrl` and `iconUrl` to each stanza (camelCase, so they can
// never collide with a lower-cased control field). Stanzas without a Package field are dropped.
export function parsePackages(text, root) {
  const out = [];
  for (const st of parseControl(text)) {
    if (!st.package) continue;
    st.debUrl = root ? resolveFilename(root, st.filename) : null;
    st.iconUrl = resolveIcon(root, st.icon);
    out.push(st);
  }
  return out;
}

// Relative paths may hold ":" (Filename "debs/apt_1:0-23_iphoneos-arm.deb"), "#" or "?": keep URL() from
// reading them as a scheme, fragment or query.
function safeRelative(p) {
  const e = encodePath(p);
  return /^[a-z][a-z0-9+.-]*:/i.test(e) ? "./" + e : e;
}

function encodePath(p) {
  return String(p).replace(/%(?![0-9a-f]{2})/gi, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F").replace(/ /g, "%20");
}

// ---- Debian versions --------------------------------------------------------------------------------------

// "[epoch:]upstream[-revision]" -> {epoch, upstream, revision}. The epoch is up to the first ":", the revision
// after the last "-". Lenient like Cydia, not strict like dpkg: odd strings still parse and compare.
export function parseVersion(v) {
  let s = String(v ?? "").trim();
  let epoch = 0;
  const colon = s.indexOf(":");
  if (colon >= 0) {
    epoch = /^\d+$/.test(s.slice(0, colon)) ? Number(s.slice(0, colon)) : 0;
    s = s.slice(colon + 1);
  }
  const dash = s.lastIndexOf("-");
  return dash >= 0 ? { epoch, upstream: s.slice(0, dash), revision: s.slice(dash + 1) }
    : { epoch, upstream: s, revision: "" };
}

const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";

// dpkg's character order: "~" before everything (even the end), then the end of the part, then letters, then
// everything else, all in ASCII order within their class.
function order(c) {
  if (c === undefined || isDigit(c)) return 0;
  if (c === "~") return -1;
  const code = c.charCodeAt(0);
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return code;
  return code + 256;
}

// dpkg's verrevcmp: alternate non-digit runs (compared by `order`) and digit runs (compared as numbers).
function verrevcmp(a, b) {
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    while ((i < a.length && !isDigit(a[i])) || (j < b.length && !isDigit(b[j]))) {
      const ac = order(a[i]), bc = order(b[j]);
      if (ac !== bc) return ac - bc;
      i++; j++;
    }
    while (a[i] === "0") i++;
    while (b[j] === "0") j++;
    let firstDiff = 0;
    while (isDigit(a[i]) && isDigit(b[j])) {
      if (!firstDiff) firstDiff = a.charCodeAt(i) - b.charCodeAt(j);
      i++; j++;
    }
    if (isDigit(a[i])) return 1;
    if (isDigit(b[j])) return -1;
    if (firstDiff) return firstDiff;
  }
  return 0;
}

// -1, 0 or 1, by `dpkg --compare-versions` rules (Debian policy 5.6.12). An absent revision equals "0".
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (x.epoch !== y.epoch) return x.epoch < y.epoch ? -1 : 1;
  const r = verrevcmp(x.upstream, y.upstream) || verrevcmp(x.revision, y.revision);
  return Math.sign(r);
}

// Whether version `a` satisfies the relation `op b`, op being one of << <= = >= >> (and the obsolete < and >,
// which dpkg reads as <= and >=).
export function satisfies(a, op, b) {
  const c = compareVersions(a, b);
  switch (op) {
    case "<<": return c < 0;
    case "<=": case "<": return c <= 0;
    case "=": return c === 0;
    case ">=": case ">": return c >= 0;
    case ">>": return c > 0;
    default: throw new Error(`unknown version relation ${op}`);
  }
}
