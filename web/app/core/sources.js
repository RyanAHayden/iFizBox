// The source list: defaults, the Add Source check, refreshing a source's package count, and the IndexedDB store
// the list lives in. Shared by the site and the app: everything that touches the network goes through a backend
// (backend-http.js or backend-native.js), which only needs these calls:
//
//   backend.packages(dir) -> { text, source }  the Packages index in a repo directory (.xz/.bz2/.gz/plain)
//   backend.text(url)     -> string
//   backend.fetch(url)    -> Response
//
// and throws errors with a `code` (BackendError: bad_url, refused, too_large, timeout, upstream, not_found,
// network, rate_limited). Cydia's behaviour this follows: docs/cydia.md, "Fetching a source" and "Sources tab".
import { DOMAIN } from "../brand.js";
import { repoLayout, parseRelease, DEFAULT_ARCH, countPackages } from "./apt.js";
import { isAltKey, neverLoaded } from "./altstore.js";
import { releaseTime, fingerprint, healthFields, withTimeout, pool, REFRESH_TIMEOUT, REFRESH_CONCURRENCY } from "./health.js";
import { githubApiRepo, isGithubSource, refreshGithubSource } from "./github.js"; // F304
import { githubTweakUri } from "./github.js"; // F344a

// F72: iFizBox's own repo names the oldest iFizBox that may run without upgrading first (core/essential.js).
const MIN_FIELD = "x-ifizbox-minimum-version";

// A source: { key, uri, dist, components, name?, origin?, depiction?, count?, updated?, error? }. `name` is ours
// (the defaults), `origin` comes from the repo's Release; the row shows the first there is, else the host.
// `depiction` is the Release's Depiction: template (see releaseDepiction), null when the Release has none.
//
// The default sources are data, not code: two files beside index.html, each read on its own.
//   web/app/tweak-sources.json  the APT repos, [{ name, uri, dist, components }]
//   web/app/app-sources.json    the AltStore sources, [url]: the app's own first, as "/repo/source.json" (read
//                               against https://<DOMAIN>/, like core/appoffer.js APP_SOURCE_URL; tools/altsource.py)
// The site serves both (https://<DOMAIN>/tweak-sources.json, /app-sources.json), so changing a list is a site
// deploy, not an app release. A new store seeds from them once (a default the user deletes stays deleted):
// loadTweakSources / loadAppSources ask the site's copy first through `remote` (the app's backend.text, its own
// fetch path) within DEFAULTS_TIMEOUT, and fall back to the copy bundled with the frontend (offline, a first
// launch without network). The site itself passes no `remote`: its bundled copy is the site's copy.
export const TWEAK_SOURCES_FILE = "tweak-sources.json";
export const APP_SOURCES_FILE = "app-sources.json";
export const DEFAULTS_TIMEOUT = 3000;

// tweak-sources.json's entries as source records (each with its sourceKey); anything without an http(s) uri is
// dropped, and a repeated key keeps the first.
export function tweakSourcesFrom(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (!s || typeof s.uri !== "string" || !/^https?:\/\//i.test(s.uri)) continue;
    const rec = {
      ...(typeof s.name === "string" && s.name ? { name: s.name } : {}),
      uri: s.uri,
      dist: typeof s.dist === "string" && s.dist ? s.dist : "./",
      components: Array.isArray(s.components) ? s.components.filter((c) => typeof c === "string" && c) : [],
    };
    rec.key = sourceKey(rec);
    if (seen.has(rec.key)) continue;
    seen.add(rec.key);
    out.push(rec);
  }
  return out;
}

// app-sources.json's URLs, a relative one read against https://<DOMAIN>/, deduped (dedupeUrls).
export function appSourcesFrom(list) {
  if (!Array.isArray(list)) return [];
  const base = `https://${DOMAIN}/`;
  return dedupeUrls(list.filter((u) => typeof u === "string").map((u) => {
    try { return new URL(u.trim(), base).href; } catch { return ""; }
  }));
}

// The frontend's own copy of web/app/<file>: an app:// file in the app, the site's in a browser, from disk in node.
export async function readBundled(file) {
  const url = new URL(`../${file}`, import.meta.url);
  if (url.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    return readFile(url, "utf8");
  }
  const res = await fetch(url.href);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

// One default list: the site's copy (remote(url) -> its text) when it answers in time with a non-empty list,
// else the bundled one, else [].
async function loadDefaultList(file, from, { remote = null, bundled = readBundled, timeout = DEFAULTS_TIMEOUT } = {}) {
  if (remote) {
    try {
      const text = await withTimeout(Promise.resolve().then(() => remote(`https://${DOMAIN}/${file}`)), timeout);
      const list = from(JSON.parse(text));
      if (list.length) return list;
    } catch {
      // offline, too slow, or not a list: the bundled copy
    }
  }
  try {
    return from(JSON.parse(await bundled(file)));
  } catch {
    return [];
  }
}

// opts: { remote: (url) => Promise<text>, bundled: (file) => Promise<text>, timeout: ms }.
export const loadTweakSources = (opts) => loadDefaultList(TWEAK_SOURCES_FILE, tweakSourcesFrom, opts);

// F302: the Tweak Sources the sideload build starts with: tweak-sources.json's entries marked "inject": true, as
// tweakSourcesFrom records. F344a: only app-tweak sources real users trust, which today are GitHub repos whose releases
// carry the tweak's .deb ({ name, github: "<owner>/<repo>", inject: true }, core/github.js reads them; the research is
// in journal/2026-11-21-f344a-tweak-sources-lite/). tweakSourcesFrom (the jailbroken defaults, the Worker's cron) skips
// them: they have no uri.
export const injectSourcesFrom = (list) => {
  const picked = Array.isArray(list) ? list.filter((s) => s?.inject === true) : [];
  const out = [...tweakSourcesFrom(picked), ...githubDefaultsFrom(picked)];
  return out.filter((s, i) => out.findIndex((o) => o.key === s.key) === i);
};

// F344a: tweak-sources.json's { github: "<owner>/<repo>" } entries as GitHub Tweak Source records (the shape
// core/github.js githubTweakRecord saves, before its first refresh fills the count).
const GITHUB_DEFAULT = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
export function githubDefaultsFrom(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const m = typeof s?.github === "string" ? GITHUB_DEFAULT.exec(s.github.trim()) : null;
    if (!m || m[2] === "." || m[2] === "..") continue;
    const gh = { user: m[1], repo: m[2] };
    const uri = githubTweakUri(gh);
    const key = sourceKey({ uri, dist: "./" });
    if (out.some((o) => o.key === key)) continue;
    out.push({ key, uri, dist: "./", components: [], github: gh, name: typeof s.name === "string" && s.name ? s.name : gh.repo });
  }
  return out;
}
export const loadInjectSources = (opts) => loadDefaultList(TWEAK_SOURCES_FILE, injectSourcesFrom, opts);
export const loadAppSources = (opts) => loadDefaultList(APP_SOURCES_FILE, appSourcesFrom, opts);

// URLs -> their parsed hrefs (host lower-cased, a bare host gets its "/"), first of each kept, in order.
export function dedupeUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    let href;
    try { href = new URL(String(u).trim()).href; } catch { continue; }
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

// Cydia's key, `deb:<URI>:<dist>`.
export function sourceKey({ uri, dist }) {
  return `deb:${uri}:${dist || "./"}`;
}

// ---- B273: one source, whatever spelling it was added under ---------------------------------------------------
//
//   sourceMatchKey(uri, dist)        -> what two source URLs are compared by, or null for no http(s) URL. Keys
//                                      (sourceKey, altKey) keep the spelling the source was added under, since stored
//                                      records and settings are filed by them; this only says when two are one source.
//   sameSource(a, b)                 -> true when two records ({ uri, dist, identifier }) are one source
//   findSameSource(list, want, opts) -> the listed record `want` already is, or null; opts.except: a key to skip
//   duplicateSources(list)           -> keys of the records that repeat another's URL (the ones to merge away)
//
// Ignored: http vs https, case and a leading www. in the host, trailing slashes, and GitHub's raw spellings, which
// all serve one file: github.com/<o>/<r>/raw/<ref>/<path>, raw.githubusercontent.com/<o>/<r>/<ref>/<path>, either
// with refs/heads/<branch> for <ref> (owner and repo without case, as GitHub reads them). A dist repo's suite counts.
// An app source's identifier (its JSON's `identifier`) also makes two records one source.
export function sourceMatchKey(uri, dist) {
  let u;
  try { u = new URL(String(uri ?? "").trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let host = u.hostname.toLowerCase().replace(/^www\./, "");
  let parts = u.pathname.split("/").filter(Boolean);
  let rest = null;
  if (host === "github.com" && parts.length > 4 && parts[2] === "raw") rest = parts.slice(3);
  else if (host === "raw.githubusercontent.com" && parts.length > 3) rest = parts.slice(2);
  if (rest) {
    if (rest[0] === "refs" && rest[1] === "heads" && rest.length > 3) rest = rest.slice(2);
    host = "raw.githubusercontent.com";
    parts = [parts[0].toLowerCase(), parts[1].toLowerCase(), ...rest];
  }
  const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
  const suite = dist && dist !== "./" && !String(dist).endsWith("/") ? ` ${dist}` : "";
  return `${host}${port}/${parts.join("/")}${u.search}${suite}`;
}

const identifierOf = (s) => (typeof s?.identifier === "string" ? s.identifier.trim() : "");

export function sameSource(a, b) {
  if (!a || !b) return false;
  const ka = sourceMatchKey(a.uri, a.dist);
  if (ka && ka === sourceMatchKey(b.uri, b.dist)) return true;
  const ia = identifierOf(a);
  return Boolean(ia) && ia === identifierOf(b);
}

export function findSameSource(list, want, { except = null } = {}) {
  return (list ?? []).find((s) => s && s.key !== except && sameSource(s, want)) ?? null;
}

// Which record of a repeated source stays: one that has loaded (read without an error) before one that hasn't, else
// the first listed. The others' keys are returned; the one kept keeps its own key and settings. Only URL spellings
// count here, not a shared identifier: this removes records without asking, and a fork of a source often keeps the
// original's identifier while listing other apps (Add Source and Recommended, which the user sees, do count it).
// The built-in source (core/essential.js SELF_APT_URI / SELF_ALT_URL, repeated here: essential.js imports
// altstore.js, which imports this file) under its own URL always stays, loaded or not: removeSource refuses it.
const BUILTIN_URIS = new Set([`https://${DOMAIN}/repo/`, `https://${DOMAIN}/repo/source.json`]);
export function duplicateSources(list) {
  const all = (list ?? []).filter((s) => s?.key);
  const builtin = (s) => BUILTIN_URIS.has(s.uri);
  const loaded = (s) => s.updated != null && !s.error;
  const same = (a, b) => { const k = sourceMatchKey(a.uri, a.dist); return Boolean(k) && k === sourceMatchKey(b.uri, b.dist); };
  const drop = new Set();
  for (let i = 0; i < all.length; i++) {
    if (drop.has(all[i].key)) continue;
    const group = all.filter((s, j) => j >= i && !drop.has(s.key) && s.key !== all[i].key && same(all[i], s));
    if (!group.length) continue;
    const members = [all[i], ...group];
    const keep = members.find(builtin) ?? members.find(loaded) ?? members[0];
    for (const s of members) if (s !== keep) drop.add(s.key);
  }
  return [...drop];
}

// Cydia's alert wording (its Localizable.strings INVALID_URL_EX, NOT_REPOSITORY_EX). `kind`: invalid_url, not_repository, verification.
const ALERTS = {
  invalid_url: ["Invalid URL", "That is not a valid source URL. Please check it and try again."],
  not_repository: ["Did Not Find Repository", "The indicated repository could not be found. This could be because "
    + "you are trying to add a legacy Installer repository (these are not supported). Also, this interface is only "
    + "capable of working with exact repository URLs."],
  verification: ["Verification Error", ""],
};

export class SourceError extends Error {
  constructor(kind, message, code) {
    super(message || ALERTS[kind]?.[1] || kind);
    this.name = "SourceError";
    this.kind = kind;
    this.title = ALERTS[kind]?.[0] ?? "Error";
    if (code) this.code = code;
  }
}

// What the user typed -> the repo URL with a trailing slash, or SourceError("invalid_url"). Cydia's
// VerifySource() wants `(http(s?)://|file:///)[^# ]*`; file:/// can't be fetched by either backend, so only
// http(s). Unlike Cydia, a bare host ("repo.example.com") gets https:// in front: that's how repos are shared now.
export function normalizeSourceUrl(input) {
  let s = String(input ?? "").trim();
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  if (!/^https?:\/\/[^#\s/?]+[^#\s]*$/i.test(s)) throw new SourceError("invalid_url");
  let u;
  try { u = new URL(s); } catch { throw new SourceError("invalid_url"); }
  if (u.search || u.username || u.password) throw new SourceError("invalid_url");
  return u.href.replace(/\/*$/, "/");
}

// Where to look for CydiaIcon.png, in order. Cydia asks only <base> (MetaIndexURI(""), so dists/<dist>/ for a
// dist repo), but dist repos such as Procursus serve it at the top level (the URI) instead, so a dist repo also
// gets the root as a fallback. A flat repo has the one place.
export function sourceIconUrls(source) {
  const { flat, base, root } = repoLayout(source);
  return flat ? [base + "CydiaIcon.png"] : [base + "CydiaIcon.png", root + "CydiaIcon.png"];
}

export function displayName(source) {
  if (source.name) return source.name;
  if (source.origin) return source.origin;
  const gh = githubRepo(source.uri);
  if (gh) return gh.user;
  try { return new URL(source.uri).hostname.toLowerCase(); } catch { return source.uri; }
}

// F44: the GitHub user and repo a source URL is hosted under, or null. The four shapes:
//   github.com/<user>/<repo>/raw/...  and  github.com/<user>/<repo>/releases/.../download/...
//   raw.githubusercontent.com/<user>/<repo>/...
//   <user>.github.io/<repo>/...  (repo null for a file at the root: the user's <user>.github.io site)
// The user keeps the case the URL has (FIZL0 on github.com; a github.io host is always lower case).
const GH_RESERVED = new Set(["orgs", "settings", "marketplace", "sponsors", "topics", "features", "login", "apps"]);
export function githubRepo(url) {
  let u;
  try { u = new URL(String(url ?? "").trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const name = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  if (host === "github.com" || host === "www.github.com" || host === "raw.githubusercontent.com") {
    const [user, repo] = parts;
    if (!user || !repo || !name.test(user) || (host !== "raw.githubusercontent.com" && GH_RESERVED.has(user.toLowerCase()))) return null;
    return { user, repo: repo.replace(/\.git$/, "") };
  }
  // F304: a GitHub repo's releases as an app source keep the API URL (api.github.com/repos/<user>/<repo>/releases).
  if (host === "api.github.com") return githubApiRepo(u.href);
  const io = /^([a-z0-9][a-z0-9-]{0,38})\.github\.io$/.exec(host);
  if (io) {
    // A first segment that is the file itself (fizl0.github.io/source.json) is no repo.
    const repo = parts.length > 1 ? parts[0] : null;
    return { user: io[1], repo };
  }
  return null;
}

// F44: the row's subtitle: "github.com/<user>/<repo>" for a GitHub-hosted source (just "<user>.github.io" for a
// user site's root), else the URL as given.
export function sourceSubtitle(source) {
  const gh = githubRepo(source?.uri);
  if (!gh) return source?.uri ?? "";
  return gh.repo ? `github.com/${gh.user}/${gh.repo}` : `${gh.user.toLowerCase()}.github.io`;
}

// F44: the GitHub avatar for a GitHub-hosted source (github.com redirects to avatars.githubusercontent.com), or
// null. It goes through backend.assetUrl like every other icon, so the site's proxy caches it.
export function githubAvatarUrl(source) {
  const gh = githubRepo(source?.uri);
  return gh ? `https://github.com/${encodeURIComponent(gh.user)}.png?size=120` : null;
}

// F44: where a source's icon may be, in order: an AltStore source's own iconURL, an APT source's CydiaIcon.png
// places (sourceIconUrls), then the GitHub avatar when the source is hosted there. An AltStore source that names
// an icon gets no avatar after it; a CydiaIcon.png that 404s does (the 404 is the "no icon of its own").
export function sourceIcons(source) {
  const avatar = githubAvatarUrl(source);
  if (isAltKey(source?.key)) return source.iconURL ? [source.iconURL] : avatar ? [avatar] : [];
  if (isGithubSource(source)) return avatar ? [avatar] : []; // F304: no CydiaIcon.png on a repo's page
  return [...sourceIconUrls(source), ...(avatar ? [avatar] : [])];
}

// Cydia's order: names that start with a letter first, then a compare without case or diacritics.
export function sortSources(list) {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const letter = (s) => /^\p{L}/u.test(displayName(s));
  return [...list].sort((a, b) => (letter(b) - letter(a)) || collator.compare(displayName(a), displayName(b)));
}

// The repo answered, but not with this file: try the next name. Anything else (refused, timeout, network, too
// large, rate limited) ends the check: asking again won't help.
export const missing = (e) => e?.code === "upstream" || e?.code === "not_found";

export function verificationError(e) {
  return new SourceError("verification", e?.message || String(e), e?.code);
}

// A Release (or InRelease) file, not an HTML page the host sent for any path.
function looksLikeRelease(text) {
  if (/^\s*[<{[]/.test(text)) return false; // a page, or JSON served for every path (F28)
  const r = parseRelease(text);
  return Boolean(r.origin || r.label || r.suite || r.codename || r.architectures.length || Object.keys(r.hashes).length);
}

// A Packages text, not a page or a JSON file the host sends for every path (alt.crystall1ne.dev serves its
// AltStore JSON at /Packages, /Release and the rest, F28): such a host is no APT repo, so Add Source falls through
// to AltStore. An empty file is a repo with nothing in it yet.
function looksLikePackages(text) {
  return !/^\s*[<{[]/.test(String(text ?? ""));
}

const MAGIC = {
  "Packages.zst": [0x28, 0xb5, 0x2f, 0xfd],
  "Packages.lzma": [0x5d, 0x00, 0x00],
};

async function hasMagic(res, magic) {
  const head = new Uint8Array(await res.arrayBuffer(), 0);
  return magic.every((b, i) => head[i] === b);
}

// What a stored count counts: "id" is unique package ids (B366). A count saved without it counted stanzas, one per
// version, so refreshSource recounts it even when the Release is unchanged.
const COUNT_BY = "id";

// Counts the packages in a Packages text that install on `arch`. Pass `count` (core/parser.js's, which runs in
// the worker) to keep big lists off the UI thread; this inline one is the fallback.
function countInline(text, arch) {
  return countPackages(text, arch); // B366: unique ids, not one per version
}

async function releaseOf(backend, base) {
  for (const name of ["Release", "InRelease"]) {
    try {
      const text = await backend.text(base + name);
      if (looksLikeRelease(text)) return { ...parseRelease(text), raw: text }; // raw: F19's fingerprint
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
  return null;
}

// The Add Source check. Cydia HEADs only Packages.bz2 and .gz, so it turns away repos that ship .xz or .zst
// alone; this accepts a flat repo if any of Packages(.xz/.bz2/.gz) (one backend.packages call: the server or
// the app tries each), Release/InRelease, Packages.zst or Packages.lzma is there. Returns the source to save,
// with its package count when the index could be read (null for .zst/.lzma-only repos), or throws SourceError:
// invalid_url, not_repository, or verification (with the backend's `code`, e.g. "refused" by the proxy).
//
// F48: `input` may also be a repo as an object, { uri, dist, components } (Import's `deb <uri> <suite> <components>`
// lines): a flat dist ("./") is checked as above, any other through verifyDistSource.
export async function verifySource(backend, input, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  if (input && typeof input === "object") {
    if (!isFlatDist(input.dist)) return verifyDistSource(backend, input, { arch, count });
    input = input.uri;
  }
  const uri = normalizeSourceUrl(input);
  const source = { uri, dist: "./", components: [] };
  source.key = sourceKey(source);
  let text = null;
  let release = null;
  let found = false;
  try {
    text = (await backend.packages(uri)).text;
    found = looksLikePackages(text);
    if (!found) text = null;
  } catch (e) {
    if (!missing(e)) throw verificationError(e);
  }
  try {
    release = await releaseOf(backend, uri);
  } catch (e) {
    if (!found) throw verificationError(e);
  }
  found ||= Boolean(release);
  for (const name of Object.keys(MAGIC)) {
    if (found) break;
    try {
      found = await hasMagic(await backend.fetch(uri + name), MAGIC[name]);
    } catch (e) {
      if (!missing(e)) throw verificationError(e);
    }
  }
  if (!found) return stableDistSource(backend, uri, { arch, count });
  if (release?.origin) source.origin = release.origin;
  if (release) source.depiction = release.fields.depiction || null;
  if (release?.fields[MIN_FIELD]) source.minimumVersion = release.fields[MIN_FIELD]; // F72: iFizBox's own repo
  source.count = text == null ? null : await count(text, arch);
  source.updated = source.reachedAt = Date.now(); // F19: health
  source.failures = 0;
  if (release) {
    source.releaseDate = releaseTime(release);
    source.releaseHash = fingerprint(release.raw);
  }
  if (source.count != null) Object.assign(source, { countArch: arch, countBy: COUNT_BY });
  return source;
}

const isFlatDist = (dist) => !dist || String(dist).endsWith("/");

// B261: a typed URL with nothing flat at it but a Release under dists/stable/ (BigBoss,
// http://apt.thebigboss.org/repofiles/cydia/, and the other old Cydia repos laid out as `deb <uri> stable main`) is
// added as that dist source, its components from the Release. Nothing there either: not_repository, as before.
async function stableDistSource(backend, uri, opts) {
  let release;
  try {
    release = await releaseOf(backend, `${uri}dists/stable/`); // null when the repo answered without one
  } catch (e) {
    throw verificationError(e); // refused, timeout, network: said as such, not as Did Not Find Repository
  }
  if (!release) throw new SourceError("not_repository");
  return verifyDistSource(backend, { uri, dist: "stable" }, opts);
}

// A suite as apt takes it on a `deb` line: a relative path, no spaces, no `..` (it goes into URI/dists/<dist>/).
const DIST_RE = /^[A-Za-z0-9._~+-]+(\/[A-Za-z0-9._~+-]+)*$/;
const COMPONENT_RE = /^[A-Za-z0-9._~+-]+(\/[A-Za-z0-9._~+-]+)*$/;
const badPath = (p) => p.split("/").some((part) => part === "." || part === "..");

// F48: the Add Source check for a dist repo, { uri, dist, components }: its Release (or InRelease) must be under
// URI/dists/<dist>/. No components given: the Release's Components. Then every component's Packages is counted
// (refreshSource), so a wrong suite or component is turned away here rather than failing apt-get update later. A
// Release whose Architectures leave ours out (Telesphoreo, rootful only) is still added, with count 0, as Refresh
// would show it. Throws SourceError: invalid_url, not_repository (no Release there), verification.
export async function verifyDistSource(backend, { uri: rawUri, dist, components } = {}, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  const uri = normalizeSourceUrl(rawUri);
  dist = String(dist ?? "").trim();
  if (!DIST_RE.test(dist) || badPath(dist)) throw new SourceError("invalid_url", `"${dist}" is not a valid suite.`);
  let comps = (Array.isArray(components) ? components : String(components ?? "").split(/\s+/))
    .map((c) => String(c).trim()).filter(Boolean);
  for (const c of comps) if (!COMPONENT_RE.test(c) || badPath(c)) throw new SourceError("invalid_url", `"${c}" is not a valid component.`);
  const source = { uri, dist, components: comps };
  let release;
  try {
    release = await releaseOf(backend, repoLayout(source).base);
  } catch (e) {
    throw verificationError(e);
  }
  if (!release) throw new SourceError("not_repository");
  if (!comps.length) comps = source.components = release.components.filter((c) => COMPONENT_RE.test(c) && !badPath(c));
  if (!comps.length) throw new SourceError("verification", `The Release under dists/${dist}/ names no components.`);
  source.key = sourceKey(source);
  const fields = await refreshSource(backend, source, { arch, count });
  if (fields.error) throw new SourceError("verification", fields.error);
  const { error, unchanged, ...rest } = fields;
  return { ...source, ...rest, reachedAt: rest.updated, failures: 0 };
}

// A package's fallback depiction: the source's Release Depiction: template with every `*` replaced by the
// package id (Cydia's `Package -depiction`, docs/cydia.md "Package page and depictions"). Only http(s) URLs
// count; anything else (or no template) is null. The package's own Depiction: always wins over this.
export function releaseDepiction(source, id) {
  const tpl = String(source?.depiction ?? "").trim();
  if (!tpl || !id) return null;
  const url = tpl.split("*").join(id);
  return /^https?:\/\//i.test(url) ? url : null;
}

// Refetches a source and returns the fields to store: { count, origin?, depiction?, updated, error }. `depiction`
// is only set when a Release was read, so a refresh that can't reach it keeps the stored template. A dist repo whose
// Release lists Architectures without ours has nothing for us (Telesphoreo is rootful only): count 0, no index
// fetched. Errors don't throw: they come back as `error` so one bad source doesn't stop the others.
//
// F19, Release first: the Release is read before any Packages. When it is the very text the last refresh saw
// (`releaseHash`), for the same architecture, and that refresh counted the packages without an error, the count
// stands and no Packages is fetched: an unchanged repo costs one request. `releaseDate` (its Date:) and
// `releaseHash` are saved for the health line (core/health.js) and the next refresh.
export async function refreshSource(backend, source, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  if (isGithubSource(source)) return refreshGithubSource(backend, source, { count }); // F304: its releases, no Release
  const layout = repoLayout(source, arch);
  const out = { updated: Date.now(), error: null };
  try {
    let release = null;
    try {
      release = await releaseOf(backend, layout.base);
    } catch (e) {
      if (!layout.flat) throw e;
    }
    if (release?.origin) out.origin = release.origin;
    if (release) {
      out.depiction = release.fields.depiction || null;
      out.minimumVersion = release.fields[MIN_FIELD] || null; // F72: X-iFizBox-Minimum-Version (iFizBox's own repo)
      out.releaseDate = releaseTime(release);
      out.releaseHash = fingerprint(release.raw);
    }
    out.countArch = arch;
    if (release && out.releaseHash === source?.releaseHash && source?.countArch === arch
        && source?.countBy === COUNT_BY && typeof source?.count === "number" && !source?.error) {
      Object.assign(out, { count: source.count, countBy: COUNT_BY, unchanged: true });
      return out;
    }
    if (!layout.flat && release?.architectures.length && !release.architectures.includes(arch)) {
      Object.assign(out, { count: 0, countBy: COUNT_BY });
      return out;
    }
    // Every component's Packages counted as one list, so a package two components carry counts once (B366).
    const texts = [];
    for (const file of layout.packages) {
      const dir = file.slice(0, -"Packages".length);
      texts.push((await backend.packages(dir)).text);
    }
    Object.assign(out, { count: await count(texts.join("\n\n"), arch), countBy: COUNT_BY });
  } catch (e) {
    out.error = e?.message || String(e);
  }
  return out;
}

// F19: refreshSource with a time limit. The fetches it started go on unawaited; the source gets the timeout as its
// error, so the row says Not Responding and the rest of Refresh goes on.
async function refreshTimed(backend, source, { timeout = REFRESH_TIMEOUT, ...rest } = {}) {
  try {
    return await withTimeout(refreshSource(backend, source, rest), timeout);
  } catch (e) {
    return { updated: Date.now(), error: e?.message || String(e) };
  }
}

// ---- the store ----------------------------------------------------------------------------------------------

// IndexedDB: store "sources" (keyPath "key") and "meta". The defaults go in once, on the first open, so a source
// the user deletes stays deleted. The IDBFactory is passed in so node tests can hand it a fake. `defaults`: the
// records seeded, or a function resolving to them, asked only on that first open (loadTweakSources: the bundled
// tweak-sources.json); when it gives none the store isn't marked seeded, so the next open tries again.
export function openSourceStore({ indexedDB: idb = globalThis.indexedDB, name = "ifizbox-sources", defaults = loadTweakSources } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const store = wrap(req.result, defaults);
      store.seed().then(() => resolve(store), reject);
    };
  });
}

function wrap(db, defaults = []) {
  const run = (storeName, mode, f) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = f(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
  const store = {
    async seed() {
      if (await run("meta", "readonly", (s) => s.get("seeded"))) return;
      const list = (typeof defaults === "function" ? await defaults() : defaults) ?? [];
      if (!list.length) return;
      for (const s of list) await run("sources", "readwrite", (st) => st.put(s));
      await run("meta", "readwrite", (s) => s.put({ key: "seeded", at: Date.now() }));
    },
    // Every source, in the Sources tab's order.
    list: async () => sortSources(await run("sources", "readonly", (s) => s.getAll())),
    get: (key) => run("sources", "readonly", (s) => s.get(key)),
    // Adds or replaces a whole source record.
    put: (source) => run("sources", "readwrite", (s) => s.put(source)).then(() => source),
    // Merges `fields` into the stored source; returns the new record, or undefined if it's gone.
    async update(key, fields) {
      const cur = await store.get(key);
      if (!cur) return undefined;
      return store.put({ ...cur, ...fields });
    },
    remove: (key) => run("sources", "readwrite", (s) => s.delete(key)).then(() => undefined),
    close: () => db.close(),
  };
  return store;
}

// The source-list calls every backend exposes (docs/native.md): `sources()`, `addSource(input)`,
// `removeSource(key)`, `refreshSources(onEach)`. Both backends mix these in over their own fetch calls, so the
// list lives on the device either way. `opts`: { indexedDB, arch: () => string, count, tweakDefaults: the store's
// seed (openSourceStore `defaults`; the bundled tweak-sources.json when not given) }.
export function sourceCalls(backend, opts = {}) {
  let opened = null;
  const store = () => (opened ??= openSourceStore(opts.tweakDefaults ? { ...opts, defaults: opts.tweakDefaults } : opts));
  const arch = () => (typeof opts.arch === "function" ? opts.arch() : opts.arch) || DEFAULT_ARCH;
  const count = opts.count;
  return {
    sources: async () => (await store()).list(),
    // Checks the repo (a URL, or a dist repo { uri, dist, components }, F48), then saves it. Throws SourceError
    // (see verifySource). An already-listed source is refreshed in place rather than added twice.
    async addSource(input) {
      const s = await verifySource(backend, input, { arch: arch(), count });
      const db = await store();
      const cur = await db.get(s.key);
      return db.put(cur ? { ...cur, ...s } : s);
    },
    // F304: `opts.github` (the sideload app's Tweak Sources): a GitHub repo read through its releases (core/github.js
    // githubTweakRecord, from withAltSources' Add) is saved as it comes; refreshSource reads it the same way.
    ...(opts.github ? {
      async addGithub(rec) {
        const db = await store();
        const cur = await db.get(rec.key);
        return db.put(cur ? { ...cur, ...rec } : rec);
      },
    } : {}),
    removeSource: async (key) => (await store()).remove(key),
    // Refreshes every source (all at once), saving each as it lands; onEach(source) sees the updated record.
    // `filter` (F41, sourceFilter): only the sources it keeps are fetched.
    // F19: at most REFRESH_CONCURRENCY at once, each given `timeout` ms (a dead host is marked Not Responding
    // instead of holding the rest), with the health fields (reachedAt, failures) saved beside the result.
    // F150: `signal` (the reload bar's Cancel) starts no more sources once aborted; those under way finish.
    // F233: `onRow(key, "loading")` as each source's fetch starts (the pool holds the rest back: their rows wait).
    async refreshSources(onEach = () => {}, { filter, timeout = opts.timeout ?? REFRESH_TIMEOUT,
      concurrency = opts.concurrency ?? REFRESH_CONCURRENCY, signal, onRow } = {}) {
      const db = await store();
      const list = (await db.list()).filter(filter ?? (() => true));
      return pool(list, concurrency, async (s) => {
        if (signal?.aborted) return null;
        onRow?.(s.key, "loading");
        const fields = await refreshTimed(backend, s, { arch: arch(), count, timeout });
        const next = await db.update(s.key, { ...fields, ...healthFields(s, fields) });
        if (next) onEach(next);
        return next;
      });
    },
  };
}

// F37: the sources a device type shows. Not Jailbroken ("none") sees AltStore-style sources only (keys `alt:`,
// core/altstore.js); a jailbroken type sees every source. Returns { shown, hidden: count of APT sources left out }.
export function sourcesFor(list, type) {
  const all = Array.isArray(list) ? list : [];
  if (type !== "none") return { shown: all, hidden: 0 };
  const shown = all.filter((s) => String(s?.key ?? "").startsWith("alt:"));
  return { shown, hidden: all.length - shown.length };
}

// F41: which sources Refresh fetches for a device type, as a refreshSources `filter`: Not Jailbroken ("none")
// keeps AltStore-style sources only (what sourcesFor shows), so nobody's hidden APT Packages go through the
// site's proxy; a jailbroken type refreshes everything (null: no filter).
// F302: `tweaks` (the sideload app, whose APT sources are Tweak Sources): everything is refreshed.
export function sourceFilter(type, { tweaks = false } = {}) {
  if (type !== "none" || tweaks) return null;
  return (s) => String(s?.key ?? "").startsWith("alt:");
}

// F302: the sideload app shows APT sources again, in their own "Tweak Sources" group on the Sources tab, for the
// tweaks it can inject into an app. True there (mode "sideload", a phone without a jailbreak) and nowhere else.
export const tweakSourcesOn = (type, mode) => type === "none" && mode === "sideload";
// The APT sources of `list` as Tweak Sources (in the order given), or [] where there are none.
export function tweakSourcesFor(list, type, mode) {
  if (!tweakSourcesOn(type, mode)) return [];
  return (Array.isArray(list) ? list : []).filter((s) => s?.key && !String(s.key).startsWith("alt:"));
}

// F43: the sources a first visit loads by itself: AltStore sources (the F28 defaults are seeded as bare URLs) that
// have never loaded, among those the device type shows (sourceFilter). APT sources are left to Refresh: their rows
// already have a name and CydiaIcon.png, and refreshing one means Packages through the proxy, or apt-get update in
// the app, where it would fight Refresh on Launch for apt's lock.
export function firstLoadFilter(type) {
  const shown = sourceFilter(type) ?? (() => true);
  return (s) => isAltKey(s?.key) && neverLoaded(s) && shown(s);
}

// B141: the AltStore sources worth one more try when Search finds nothing: never loaded, last fetch failed, or no
// apps (count null or 0). One only its own app can read (`unsupported`, an encrypted GBox source) never answers.
export function retryFilter(type) {
  const shown = sourceFilter(type) ?? (() => true);
  return (s) => isAltKey(s?.key) && !s.unsupported && shown(s) && (neverLoaded(s) || Boolean(s.error) || !s.count);
}

// F43: refreshes the never-loaded sources in `list` (firstLoadFilter), once each per `tried` (a Set of keys the
// caller keeps, so a source whose fetch throws isn't asked again on every visit). `begin()` runs before the fetch
// and returns what ends it (the screen's HUD). Resolves to the refreshed records, or null when nothing needed it.
// B141: `retry` (a Set of keys the caller keeps per visit, Search's) also takes the sources retryFilter keeps that
// aren't in it yet: one whose first fetch failed (first launch, the network still coming up) loads again once per
// Search visit instead of never.
export async function loadNeverLoaded(backend, list, type, { tried = new Set(), retry = null, begin = () => () => {}, onEach, onRow } = {}) {
  const want = firstLoadFilter(type);
  const again = retry ? retryFilter(type) : null;
  const keys = new Set((Array.isArray(list) ? list : [])
    .filter((s) => (want(s) && !tried.has(s.key)) || (again?.(s) && !retry.has(s.key))).map((s) => s.key));
  if (!keys.size) return null;
  for (const k of keys) { tried.add(k); retry?.add(k); }
  const end = begin(keys);
  try {
    return await backend.refreshSources(onEach, { filter: (s) => keys.has(s?.key), ...(onRow ? { onRow } : {}) });
  } finally {
    if (typeof end === "function") end(); // B75: a begin() that returns nothing is fine
  }
}


// What the user typed or pasted as a source, as one clean URL, or "" when it isn't one: the first URL-looking word,
// repeated schemes collapsed to the last one (the Add field starts with https://, so pasting https://repo.x gave
// https://https://repo.x; https://http://x keeps http), https:// added to a bare host, spaces and <> trimmed.
export function cleanSourceUrl(text) {
  const word = String(text ?? "").trim().split(/\s+/).find((w) => /[a-z0-9-]\.[a-z]{2,}|localhost/i.test(w)) ?? "";
  let u = word.replace(/^[<("']+|[>)"',.;]+$/g, "");
  if (!u) return "";
  u = u.replace(/^(?:(?:https?|cydia|sileo|zbra|altstore):\/{0,2}\/?)+(https?:\/\/)/i, "$1"); // the last scheme wins
  u = u.replace(/^(?:(?:https?):\/{0,2})+(?=https?:\/\/)/i, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
  try { return new URL(u).href; } catch { return ""; }
}

// raw.githubusercontent.com keeps a file 5 minutes after it changes, but treats a query as another file: sources
// there (iFizBox's own among them) are asked for with one that changes each minute, so a release shows within a
// minute (user 2026-11-18: Changes said iFizBox 0.3.5 with 0.3.6 out). Other hosts' URLs stay as they are.
export function freshUrl(url, now = Date.now()) {
  const s = String(url ?? "");
  if (!/^https:\/\/raw\.githubusercontent\.com\//i.test(s) || s.includes("?")) return s;
  return `${s}?t=${Math.floor(now / 60000)}`;
}

// F220: http sources. A source (a record, an Add input { uri, ... } or a URL) is "not secure" when it's fetched over
// plain http: anyone on the network could change its files. Add Source tries the https:// twin first
// (httpsInput); the source page's footer carries insecureNote. Refresh and install say nothing.
const sourceUri = (s) => String((typeof s === "string" ? s : s?.uri ?? s?.url) ?? "").trim();
export const isInsecureSource = (s) => /^http:\/\//i.test(sourceUri(s));
export const INSECURE_NOTE = "Not Secure: this source uses http, so its packages could be changed on the way.";
export const insecureNote = (s) => (isInsecureSource(s) ? INSECURE_NOTE : null);
// The same Add input over https (a URL string, or a dist repo { uri, dist, components } with its uri changed), or
// null when it isn't http.
export function httpsInput(input) {
  if (!isInsecureSource(input)) return null;
  const uri = sourceUri(input).replace(/^http:/i, "https:");
  return typeof input === "string" ? uri : { ...input, uri };
}

// ---- F344a: the sideload app shows only Tweak Sources with something for the user's apps ------------------------
//
//   tweakSourceVerdict(answer, appIds)  -> true (a tweak works in one of these apps, or in any app), false (the Tweak
//                                          Index has checked every tweak of the source and none does), null (not
//                                          known yet: no index, the source still being read, a failed read)
//   askTweakIndex(source, { file })     -> the index's answer for a source, from the index file this device has
//                                          (core/tweakindexfile.js createIndexFile; F398: no request names it), or null;
//                                          never asked for a GitHub Tweak Source (one tweak, no Packages to index)
//   shownTweakSources(list, hidden)     -> the Tweak Sources the list shows: those not in `hidden` (keys)
// A source is hidden only on a false verdict, so a missing or unfinished index hides nothing.
export function tweakIndexDone(a) {
  return Boolean(a?.enabled && a.known && a.refreshed && !a.pending && !a.error && Array.isArray(a.tweaks));
}

export function usableTweak(e, appIds) {
  if (!e?.ok || e.systemOnly) return false;
  if (e.anyApp && !e.unverified) return true;
  return (Array.isArray(e.bundles) ? e.bundles : []).some((b) => appIds.has(String(b).toLowerCase()));
}

export function tweakSourceVerdict(answer, appIds = []) {
  if (!tweakIndexDone(answer)) return null;
  const ids = new Set([...appIds].map((id) => String(id).toLowerCase()));
  return answer.tweaks.some((e) => usableTweak(e, ids));
}

export async function askTweakIndex(source, { file } = {}) {
  if (!source || !file || isGithubSource(source)) return null;
  const { answerFromFile } = await import("./tweakindexfile.js"); // lazily: not in app.js's startup closure (module-graph.test.js)
  return answerFromFile(await file.read().catch(() => null), source);
}

export const shownTweakSources = (list, hidden) => (hidden?.size ? list.filter((s) => !hidden.has(s.key)) : list);
