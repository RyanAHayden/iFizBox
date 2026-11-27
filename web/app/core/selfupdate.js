// iFizBox's own update check (F61, F183). In the app only (sideload and jailbreak builds): every launch, every Home
// Reload and every return to the app read GitHub's latest release and keep it (no once-a-day wait). Nothing pops up:
// a newer iFizBox shows only as an upgrade row in Changes and its badge (essential-ui.js upgradesWithSelf, with
// iFizBox's own AltStore source), installed from there like any app upgrade.
//   sideload   the row takes the release's iFizBox.ipa when GitHub is newer than the source
//   jailbreak  apt lists iFizBox's upgrade from its built-in repo (served from that same release); the release is
//              only recorded
// Also here: the version compare and the release parse, which Home's Install offers use too (debFor, appoffer.js).
//
// Pure: everything that touches the network, the bridge or storage comes in through `deps`, so node tests drive
// every path (selfupdate.test.js). essential-ui.js wires the real ones.
import { GITHUB_REPO, NAME } from "../brand.js";
import { KEYS } from "./storagekeys.js";

export const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const STORE_KEY = KEYS.selfupdate;
const NOTE_LINES = 4;

// "v1.2.3", "1.2", "1.2.3-beta" -> [1, 2, 3] (missing parts are 0; anything after the numbers is ignored).
// Null when it doesn't start with a number.
export function parseVersion(s) {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(String(s ?? ""));
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

// -1, 0 or 1; an unreadable version is older than any readable one.
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export const isNewer = (latest, current) => parseVersion(latest) != null && compareVersions(latest, current) > 0;

// The first `n` lines of a release's notes worth showing (a Changes row's short line): Markdown headings, rules,
// images and blank lines dropped, list bullets and emphasis taken off.
export function noteLines(body, n = NOTE_LINES) {
  const out = [];
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    let l = raw.trim();
    if (!l || /^#{1,6}\s/.test(l) || /^([-*_])\1{2,}$/.test(l) || /^!\[/.test(l) || /^<!--/.test(l)) continue;
    l = l.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/\*\*|__|`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
    if (l) out.push(l);
    if (out.length >= n) break;
  }
  return out;
}

// GitHub's release JSON -> { version, tag, notes, url, ipa, debs: [{ name, url }] }, or null when it isn't a
// release with a version tag (a draft, a rate-limit message, a tag like "nightly").
export function parseRelease(json) {
  if (!json || typeof json !== "object" || json.draft || typeof json.tag_name !== "string") return null;
  const v = parseVersion(json.tag_name);
  if (!v) return null;
  const assets = Array.isArray(json.assets) ? json.assets.filter((a) => a && typeof a.name === "string" && typeof a.browser_download_url === "string") : [];
  const url = (a) => a.browser_download_url;
  const ipa = assets.find((a) => a.name === `${NAME}.ipa`); // F180: that name only, no other .ipa
  return {
    version: v.join("."),
    tag: json.tag_name,
    notes: noteLines(json.body),
    url: typeof json.html_url === "string" ? json.html_url : "",
    ipa: ipa ? url(ipa) : null,
    debs: assets.filter((a) => /\.deb$/i.test(a.name)).map((a) => ({ name: a.name, url: url(a) })),
  };
}

// The .deb for this architecture (core/settings.js bridgeArch: iphoneos-arm64 rootless, iphoneos-arm64e roothide,
// iphoneos-arm rootful): the asset naming exactly that arch (Debian's name_version_arch.deb), else a plain
// iFizBox.deb, which is the rootless build (native/build.sh), so only for iphoneos-arm64. Null when none fits.
export function debFor(release, arch) {
  const debs = release?.debs ?? [];
  if (arch) {
    const exact = debs.find((d) => new RegExp(`[_-]${arch.replace(/[^a-z0-9-]/g, "")}\\.deb$`, "i").test(d.name));
    if (exact) return exact.url;
  }
  if (!arch || arch === "iphoneos-arm64") return debs.find((d) => d.name === `${NAME}.deb`)?.url ?? null;
  return null;
}

// Which install each build takes: "sideload", "jailbreak", or null on the site (it has nothing to update).
export function installPath(mode) {
  return mode === "sideload" || mode === "jailbreak" ? mode : null;
}

// ---- the state kept between launches ------------------------------------------------------------------------
//   lastCheck  ms of the last check
//   latest     the newest release seen: { version, tag, notes, url, ipa, debs }
//   current    the app's own version at that check

export function loadState(storage) {
  try {
    const s = JSON.parse(storage?.getItem(STORE_KEY) ?? "null");
    return s && typeof s === "object" ? s : {};
  } catch { return {}; }
}

export function saveState(storage, patch) {
  const next = { ...loadState(storage), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  try { storage?.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* full or private: read again next time */ }
  return next;
}

// The release the last check kept, when it is newer than `current`; else null.
export function newerRelease(storage, current) {
  const latest = loadState(storage).latest;
  return latest?.version && current && isNewer(latest.version, current) ? latest : null;
}

// The release as JSON from GitHub: in the app through the shell's net.fetch (no CORS, its own User-Agent, which
// GitHub's API asks for), else fetch(). Throws on a non-2xx answer.
export async function fetchRelease({ native, fetch: f = globalThis.fetch, url = RELEASES_URL } = {}) {
  if (native?.call) {
    const r = await native.call("net.fetch", { url });
    if (!r || r.status >= 300) throw new Error(`GitHub answered ${r?.status ?? "nothing"}`);
    const bin = atob(r.body ?? "");
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return parseRelease(JSON.parse(new TextDecoder().decode(bytes)));
  }
  const res = await f(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return parseRelease(await res.json());
}

// ---- the check ----------------------------------------------------------------------------------------------
// deps: {
//   mode, storage, now()             build, where the state lives, the clock
//   current()   -> "0.1.0"           the app's own version (app.info)
//   release()   -> parseRelease(...) the latest release (fetchRelease)
// }
// Every time it is called (F183: launch, Home's Reload, a return), silent whatever happens: no alert, ever. It keeps
// the release so Changes can list it. Resolves "site" | "error" | "current" | "newer".
export async function checkForUpdates(deps) {
  const { mode, storage, now = Date.now } = deps;
  if (!installPath(mode)) return "site";
  let release, current;
  try {
    [release, current] = await Promise.all([deps.release(), deps.current()]);
  } catch {
    return "error";
  }
  saveState(storage, { lastCheck: now(), latest: release ?? null, current: current || null });
  return release && isNewer(release.version, current) ? "newer" : "current";
}

// ---- B83: a sideload self-update that didn't land ------------------------------------------------------------
// The sideload app records the version it handed to iOS (signing-client.js, iFizBox's own install); on the next
// launch, if app.info still says an older version, the update didn't finish (iOS never installed it, or the old
// iFizBox was opened before it could), and a banner says so with Try Again (essential-ui.js) instead of silence.
//   recordSelfUpdate(storage, version, now)        kept for PENDING_TTL ms
//   unfinishedSelfUpdate(storage, current, now)    -> the version that didn't land, or null; a landed or stale
//                                                  record is dropped
export const PENDING_KEY = KEYS.selfupdatePending;
export const PENDING_TTL = 24 * 60 * 60 * 1000;

export function recordSelfUpdate(storage, version, now = Date.now()) {
  if (!parseVersion(version)) return false;
  try { storage?.setItem(PENDING_KEY, JSON.stringify({ version: String(version), at: now })); return true; } catch { return false; }
}

export function clearSelfUpdate(storage) {
  try { storage?.removeItem(PENDING_KEY); } catch { /* nothing kept */ }
}

export function unfinishedSelfUpdate(storage, current, now = Date.now()) {
  let p = null;
  try { p = JSON.parse(storage?.getItem(PENDING_KEY) ?? "null"); } catch { p = null; }
  if (!p || typeof p !== "object" || !current) return null;
  const fresh = Number.isFinite(p.at) && now - p.at >= 0 && now - p.at < PENDING_TTL;
  if (!fresh || !isNewer(p.version, current)) { clearSelfUpdate(storage); return null; }
  return String(p.version);
}
