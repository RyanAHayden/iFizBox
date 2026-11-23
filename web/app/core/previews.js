// F122: where an app or package comes from (its Links group) and every preview picture its source offers (the one
// screenshots gallery). Pure JS, no DOM: screens/altstore.js draws both, for app pages and package pages alike.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   appLinks(app)                    -> [{ kind, label, detail, url }]  an AltStore app's own links (stanza.ipa)
//   packageLinks(stanza, sileoJson)  -> the same for an APT package (Homepage:, Depiction:, SileoDepiction's buttons)
//   githubOf(urls, { not })          -> { owner, repo } of the first github.com/raw/github.io URL, or null
//   sileoLinks(json)                 -> [{ label, url }] a Sileo depiction's http(s) buttons
//
//   altShots(app)                    -> [shot]  AltStore screenshots (v1 screenshotURLs, v2 strings/objects, iphone/ipad)
//   aptShots(stanza)                 -> [shot]  Screenshots: (any separators) and Header:
//   sileoShots(json)                 -> [shot]  every DepictionScreenshotsView, videos skipped (the depiction draws its own headerImage)
//   sileoRatings(json), sileoWhatsNew(json)  F181: a depiction's rating, reviews and newest changelog entry (at the end)
//   htmlShots(html, baseUrl)         -> [shot]  a Zebra/Cydia HTML depiction's <img>s, chrome and icons skipped
//   readmeShots(markdown, gh)        -> [shot]  a GitHub README's images, relative ones resolved, badges/icons skipped
//   releaseShots(release)            -> [shot]  the latest GitHub release's attached pictures (and its notes' images)
//   dedupeShots(list)                -> [shot]  one per picture (http/https, host case, github blob vs raw are one)
//   shot: { url, width, height, from: "altstore" | "apt" | "sileo" | "html" | "readme" | "release", device? }
//
//   loadPreviews(key, { shots, html, gh }, { text, store, now })  -> Promise<[shot]>
//     The gallery's pictures: the source's own (`shots`) when it has any, else the HTML depiction's, else the
//     GitHub repo's README and latest release. Cached per app (`key`) for a day in `store` (localStorage-like).

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const isHttp = (u) => /^https?:\/\//i.test(str(u));
const httpUrl = (u) => (isHttp(u) ? str(u) : null);

function resolve(u, base) {
  const s = str(u);
  if (!s || /^(data|javascript|mailto|file|blob):/i.test(s) || s.startsWith("#")) return null;
  try {
    const r = new URL(s, base);
    return /^https?:$/.test(r.protocol) ? r.href : null;
  } catch { return null; }
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// ---- GitHub ----------------------------------------------------------------------------------------------------

const GH_RESERVED = new Set(["orgs", "settings", "marketplace", "sponsors", "topics", "features", "login", "apps",
  "user-attachments", "notifications", "explore", "about", "pricing", "collections", "search"]);
const GH_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// One URL -> { owner, repo } or null. github.com/<o>/<r>/…, raw.githubusercontent.com/<o>/<r>/…, <o>.github.io/<r>/…,
// objects.githubusercontent.com has no repo in it, so it gives none.
export function githubRepoOf(url) {
  let u;
  try { u = new URL(str(url)); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "github.com" || host === "www.github.com" || host === "raw.githubusercontent.com") {
    const [owner, repo] = parts;
    if (!owner || !repo || !GH_NAME.test(owner) || GH_RESERVED.has(owner.toLowerCase())) return null;
    const r = repo.replace(/\.git$/, "");
    return /^[\w.-]+$/.test(r) ? { owner, repo: r } : null;
  }
  const io = /^([a-z0-9][a-z0-9-]{0,38})\.github\.io$/.exec(host);
  const dir = parts.length > 1 || (parts.length === 1 && u.pathname.endsWith("/")); // not a file at the site's root
  if (io && dir && /^[\w.-]+$/.test(parts[0])) return { owner: io[1], repo: parts[0] };
  return null;
}

const sameRepo = (a, b) => Boolean(a && b) && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();

// The first URL naming a repo. `not`: a repo to pass over (the one the source's own JSON lives in: an IPA released
// there is the source's, and that README is about the source, not the app).
export function githubOf(urls, { not = null } = {}) {
  for (const u of urls) {
    const gh = githubRepoOf(u);
    if (gh && !sameRepo(gh, not)) return gh;
  }
  return null;
}

const githubUrl = (gh) => `https://github.com/${gh.owner}/${gh.repo}`;

// ---- Links -----------------------------------------------------------------------------------------------------

// AltStore has no standard field for these; sources use these names (kept in the app's `extra`, core/sources/ipa.js).
const SITE_KEYS = ["website", "websiteURL", "homepage", "homepageURL", "homePage", "developerURL", "developerWebsite", "url"];
const CODE_KEYS = ["sourceURL", "sourceCodeURL", "sourceCode", "source_code", "repository", "repositoryURL", "repo",
  "github", "githubURL", "gitURL", "codeURL"];

function pushLink(out, link) {
  if (!link.url) return;
  const k = link.url.replace(/\/+$/, "").replace(/^http:/i, "https:").toLowerCase();
  if (out.some((l) => l.url.replace(/\/+$/, "").replace(/^http:/i, "https:").toLowerCase() === k)) return;
  out.push(link);
}

function siteLink(url, label = "Website") {
  return { kind: "website", label, detail: hostOf(url), url };
}

function ghLink(gh) {
  return { kind: "github", label: "GitHub", detail: `${gh.owner}/${gh.repo}`, url: githubUrl(gh) };
}

const sourceRepo = (app) => githubRepoOf(app?.sourceUrl);

// "Feather" and the repo "Feather", "LiveContainer" and "LiveContainer-iOS": the repo is named for the app.
const squash = (s) => str(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const namedFor = (gh, name) => {
  const r = squash(gh.repo), n = squash(name);
  return r.length > 2 && n.length > 2 && (r.includes(n) || n.includes(r));
};

// Is the repo the source's JSON lives in this app's own? When it is named for the app, when the source's website
// names that repo (Kernarium's source for Andarium), or when the source lists this one app; not for a source repo
// carrying many apps' IPAs.
const homeIsApps = (home, app) =>
  namedFor(home, app?.name) || sameRepo(githubRepoOf(app?.sourceWebsite), home) || app?.sourceApps === 1;

// The repo an app's own fields name: a code link first, then its website, then the IPA's release. A release in the
// repo the source's JSON lives in counts only when that repo is the app's (homeIsApps); so does the source's repo
// itself.
export function appGithub(app) {
  const x = app?.extra ?? {};
  const urls = [...CODE_KEYS, ...SITE_KEYS].map((k) => x[k] ?? app?.[k]).filter(isHttp);
  const own = githubOf(urls);
  if (own) return own;
  const home = sourceRepo(app);
  const mine = Boolean(home) && homeIsApps(home, app);
  const downloads = (app?.versions ?? []).map((v) => v.downloadURL).filter(isHttp);
  const fromRelease = githubOf(downloads, { not: home && !mine ? home : null });
  if (fromRelease) return fromRelease;
  return mine ? home : null;
}

export function appLinks(app) {
  const out = [];
  const x = app?.extra ?? {};
  const gh = appGithub(app);
  for (const k of SITE_KEYS) {
    const u = httpUrl(x[k] ?? app?.[k]);
    if (u && !githubRepoOf(u)) { pushLink(out, siteLink(u, "Developer Website")); break; }
  }
  if (gh) pushLink(out, ghLink(gh));
  for (const k of CODE_KEYS) {
    const u = httpUrl(x[k] ?? app?.[k]);
    if (u && !githubRepoOf(u)) { pushLink(out, { kind: "code", label: "Source Code", detail: hostOf(u), url: u }); break; }
  }
  return out;
}

// A Sileo depiction's buttons that open web pages (not depiction- sub-pages, not app links).
export function sileoLinks(json) {
  const out = [];
  walk(json, (v) => {
    if (v.class !== "DepictionTableButtonView" && v.class !== "DepictionButtonView") return;
    const url = httpUrl(v.action) || httpUrl(v.backupAction);
    const label = str(v.title) || str(v.text);
    if (url && label && !out.some((l) => l.url === url)) out.push({ label, url });
  });
  return out;
}

export function packageLinks(stanza, sileoJson = null) {
  const out = [];
  const home = httpUrl(stanza?.homepage);
  const sileo = sileoJson ? sileoLinks(sileoJson) : [];
  const gh = githubOf([home, httpUrl(stanza?.depiction), ...sileo.map((l) => l.url)].filter(Boolean));
  if (home && !githubRepoOf(home)) pushLink(out, siteLink(home, "Developer Website"));
  if (gh) pushLink(out, ghLink(gh));
  for (const l of sileo) {
    const lg = githubRepoOf(l.url);
    if (lg && gh && sameRepo(lg, gh) && l.url.replace(/\/+$/, "").toLowerCase() === githubUrl(gh).toLowerCase()) continue;
    pushLink(out, { kind: "depiction", label: l.label, detail: hostOf(l.url), url: l.url });
  }
  return out;
}

export function packageGithub(stanza, sileoJson = null) {
  return githubOf([stanza?.homepage, stanza?.depiction, ...(sileoJson ? sileoLinks(sileoJson).map((l) => l.url) : [])].filter(isHttp));
}

// ---- Screenshots -----------------------------------------------------------------------------------------------

function walk(v, fn, depth = 0) {
  if (!v || typeof v !== "object" || depth > 40) return;
  if (Array.isArray(v)) { for (const x of v) walk(x, fn, depth + 1); return; }
  fn(v);
  for (const k of Object.keys(v)) if (v[k] && typeof v[k] === "object") walk(v[k], fn, depth + 1);
}

function shot(url, from, width = null, height = null, extra = {}) {
  return url ? { url, width: num(width), height: num(height), from, ...extra } : null;
}

// AltStore: app.screenshots as core/altstore.js parsed them ({ url, width, height, device }), or the raw forms.
export function altShots(app) {
  const parsed = app?.screenshots;
  if (Array.isArray(parsed) && parsed.every((s) => s && typeof s === "object" && "url" in s)) {
    return parsed.map((s) => shot(httpUrl(s.url), "altstore", s.width, s.height, s.device ? { device: s.device } : {})).filter(Boolean);
  }
  return rawAltShots(app);
}

export function rawAltShots(app) {
  const one = (s, device) => {
    if (typeof s === "string") return shot(httpUrl(s), "altstore", null, null, device ? { device } : {});
    return shot(httpUrl(s?.imageURL ?? s?.url), "altstore", s?.width, s?.height, device ? { device } : {});
  };
  let list = app?.screenshots ?? app?.screenshotURLs;
  if (list && !Array.isArray(list) && typeof list === "object") {
    return [...(Array.isArray(list.iphone) ? list.iphone : []).map((s) => one(s, "iphone")),
      ...(Array.isArray(list.ipad) ? list.ipad : []).map((s) => one(s, "ipad"))].filter(Boolean);
  }
  return Array.isArray(list) ? list.map((s) => one(s)).filter(Boolean) : [];
}

// APT: `Screenshots:` (URLs separated by commas, spaces or lines; Sileo's and Zebra's repos write all three) and
// `Header:` (a banner, wide). `Icon:` is the page's own icon already, so it stays out of the gallery.
export function aptShots(stanza) {
  const out = [];
  for (const u of str(stanza?.screenshots).split(/[\s,]+/)) {
    const url = httpUrl(u);
    if (url) out.push(shot(url, "apt"));
  }
  const header = httpUrl(stanza?.header);
  if (header) out.push(shot(header, "apt", 1500, 500, { banner: true }));
  return out;
}

// "{160, 284.44}" -> [160, 284.44]
function itemSize(s) {
  const m = str(s).match(/([\d.]+)\s*,\s*([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

export function sileoShots(json) {
  const out = [];
  walk(json, (v) => {
    if (v.class !== "DepictionScreenshotsView") return;
    const [w, h] = itemSize(v.itemSize);
    for (const s of Array.isArray(v.screenshots) ? v.screenshots : []) {
      if (!s || typeof s !== "object" || s.video === true) continue;
      const url = httpUrl(s.url);
      if (url && !/\.(mp4|mov|m4v|webm)([?#]|$)/i.test(url)) out.push(shot(url, "sileo", w, h));
    }
  });
  return out;
}

// What is never a screenshot: badges, shields, icons, logos, avatars, buttons, spinners, tracking pixels, SVG.
const BADGE_HOST = /(^|\.)(shields\.io|badgen\.net|badge\.fury\.io|travis-ci\.(org|com)|circleci\.com|codecov\.io|coveralls\.io|app\.codacy\.com|api\.codacy\.com|sonarcloud\.io|ci\.appveyor\.com|gitter\.im|discordapp\.com|ko-fi\.com|buymeacoffee\.com|cdn\.buymeacoffee\.com|liberapay\.com|opencollective\.com|patreon\.com|paypalobjects\.com|herokucdn\.com|starchart\.cc|star-history\.com|api\.star-history\.com|komarev\.com|visitor-badge\.(glitch\.me|laobi\.icu)|hits\.seeyoufarm\.com|github-readme-stats\.vercel\.app|contrib\.rocks|forthebadge\.com|repobeats\.axiom\.co|deepscan\.io|snyk\.io|img\.buymeacoffee\.com|readthedocs\.org|codeclimate\.com|deepsource\.io|testflight\.apple\.com|tools\.applemediaservices\.com|linkmaker\.itunes\.apple\.com|developer\.apple\.com)$/i;
const NOT_A_SHOT = /(badge|shield|icon|logo|avatar|favicon|sponsor|donate|paypal|kofi|ko-fi|patreon|buymeacoffee|download[-_]?on|app[-_]?store[-_]?badge|button|spinner|loading|arrow|chevron|pixel|spacer|blank|emoji|twemoji|flag|star[-_]?history|stars?\.svg|license|banner[-_]?ad|qr[-_]?code|^download|altsource|add[-_]?to[-_]|get[-_]?it[-_]?on|available[-_]?on|sidestore[-_]?badge)/i;
const NOT_A_ALT = /(badge|shield|\bicons?\b|\blogo\b|avatar|sponsor|donate)/i;
const PICTURE = /\.(png|jpe?g|webp|gif|heic|avif)([?#]|$)/i;

// B362: an image CDN's resizing query (Havoc's media.havoc.app/<id>?w=3840&q=75, imgix, Next.js): `w`/`width` and the
// like: a width or height asked for (not `q`, `format` alone: search pages and README widgets have those). Under 120
// (or a `s`/`size` under 120, Gravatar-style) is an icon's.
const RESIZE_KEYS = ["w", "width", "h", "height"];
const resized = (u) => RESIZE_KEYS.some((k) => num(u.searchParams.get(k)) !== null);
const tooSmall = (u) => [...RESIZE_KEYS, "s", "size"].some((k) => { const v = num(u.searchParams.get(k)); return v !== null && v < 120; });

// `responsive`: the <img> had a srcset with width descriptors ("640w"), which only pictures get (B362: Havoc's and
// other Next.js depiction pages serve every screenshot that way, extensionless).
export function isScreenshotUrl(url, { alt = "", width = null, height = null, responsive = false } = {}) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (BADGE_HOST.test(u.hostname)) return false;
  const path = decodeURIComponentSafe(u.pathname);
  // Next.js's image optimiser wraps the real picture: judge that one (its name says logo or icon too).
  if (/\/_next\/image$/.test(path) && u.searchParams.get("url")) {
    const inner = resolve(u.searchParams.get("url"), u.href);
    return Boolean(inner) && !tooSmall(u) && isScreenshotUrl(inner, { alt, width, height, responsive: true });
  }
  if (/\/altdirect\//i.test(path)) return false; // AltDirect's "Add to AltStore" / "Download" buttons
  if (/\/profile[-_]?(image|picture|pic|photo)s?\//i.test(path) || tooSmall(u)) return false; // an author's avatar (Chariz: ?s=32)
  if (/\.svg([?#]|$)/i.test(path) || /\/workflows\/[^/]+\/badge/i.test(path) || /\/actions\/workflows\//i.test(path)) return false;
  const file = path.split("/").pop() || "";
  if (NOT_A_SHOT.test(file) || NOT_A_ALT.test(str(alt))) return false;
  if (u.hostname === "github.com" && /^\/[^/]+\/[^/]+\/(workflows|actions)\b/.test(path)) return false;
  if (/(^|\.)githubusercontent\.com$/.test(u.hostname) && /^\/u\/\d+/.test(path)) return false; // avatars.githubusercontent.com/u/123
  if (u.hostname === "avatars.githubusercontent.com" || u.hostname === "gravatar.com" || u.hostname.endsWith(".gravatar.com")) return false;
  const w = num(width), h = num(height);
  if ((w && w < 120) || (h && h < 120)) return false;
  // A picture's own extension, or a host that serves pictures without one (GitHub's uploads, Imgur), or (B362) an
  // extensionless picture an image CDN resizes or a srcset offers in widths.
  return PICTURE.test(path) || /^\/user-attachments\/assets\//.test(path) || /\/assets\/[0-9a-f-]{20,}$/i.test(path)
    || /(^|\.)imgur\.com$/.test(u.hostname) || /(^|\.)(user-images|private-user-images)\.githubusercontent\.com$/.test(u.hostname)
    || (!/\.[a-z0-9]{1,5}$/i.test(path) && (responsive || resized(u)));
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : "";
};

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function htmlImgs(html) {
  const out = [];
  for (const m of str(html).matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-canonical-src");
    const srcset = attr(tag, "srcset");
    out.push({
      at: m.index,
      src: src || srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop() || "",
      alt: attr(tag, "alt"), cls: attr(tag, "class") + " " + attr(tag, "id"),
      responsive: /\s\d+w\s*(,|$)/.test(srcset),
      width: parseInt(attr(tag, "width"), 10) || null, height: parseInt(attr(tag, "height"), 10) || null,
    });
  }
  return out;
}

// A Zebra/Cydia depiction page: its <img>s. When some say "screenshot" (in the class, the alt or the file name) only
// those; else every picture that passes isScreenshotUrl. <base href> is honoured.
export function htmlShots(html, baseUrl) {
  const base = resolve(attr(/<base\b[^>]*>/i.exec(str(html))?.[0] ?? "", "href"), baseUrl) || baseUrl;
  const imgs = htmlImgs(str(html).replace(/<!--[\s\S]*?-->/g, ""))
    .map((i) => ({ ...i, url: resolve(i.src, base) }))
    .filter((i) => i.url && isScreenshotUrl(i.url, i));
  const marked = imgs.filter((i) => /screen ?shot|screenshot/i.test(`${i.cls} ${i.alt} ${i.url}`));
  return (marked.length ? marked : imgs).map((i) => shot(i.url, "html", i.width, i.height));
}

// github.com/<o>/<r>/blob/<ref>/<path> and …/raw/… -> raw.githubusercontent.com/<o>/<r>/<ref>/<path>.
function rawGithub(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i.exec(url);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3].replace(/\?raw=true$/, "")}` : url;
}

// A README's images: markdown ![alt](url "title"), reference images ![alt][ref] with [ref]: url, and HTML <img>.
// Relative paths resolve against the README's own folder on raw.githubusercontent.com (gh: { owner, repo, ref,
// path }: ref defaults to HEAD, path to README.md).
export function readmeShots(markdown, gh = {}) {
  const md = str(markdown).replace(/<!--[\s\S]*?-->/g, "").replace(/^```[\s\S]*?^```/gm, "");
  const ref = gh.ref || "HEAD";
  const dir = str(gh.path || "README.md").split("/").slice(0, -1).map(encodeURIComponent).join("/");
  const base = gh.owner && gh.repo ? `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${ref}/${dir ? dir + "/" : ""}` : gh.base || null;
  const found = [];
  const defs = new Map();
  for (const m of md.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*["')])?\s*$/gm)) defs.set(m[1].toLowerCase(), m[2]);
  for (const m of md.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) found.push({ at: m.index, src: m[2], alt: m[1] });
  for (const m of md.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]/g)) {
    const u = defs.get((m[2] || m[1]).toLowerCase());
    if (u) found.push({ at: m.index, src: u, alt: m[1] });
  }
  for (const i of htmlImgs(md)) found.push(i);
  // Bare GitHub upload links on a line of their own: GitHub shows them as pictures.
  for (const m of md.matchAll(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]+)\s*$/gim)) found.push({ at: m.index, src: m[1], alt: "" });
  found.sort((a, b) => a.at - b.at); // the README's own order
  const out = [];
  for (const f of found) {
    let url = resolve(f.src, base ?? undefined);
    if (!url) continue;
    url = rawGithub(url);
    if (isScreenshotUrl(url, f)) out.push(shot(url, "readme", f.width, f.height));
  }
  return out;
}

// GitHub's releases/latest JSON: the pictures attached to it (screenshots, not the app's icon), then its notes' images.
export function releaseShots(release, gh = {}) {
  if (!release || typeof release !== "object") return [];
  const out = [];
  for (const a of Array.isArray(release.assets) ? release.assets : []) {
    const url = httpUrl(a?.browser_download_url);
    const name = str(a?.name);
    const picture = /^image\//.test(str(a?.content_type)) || PICTURE.test(name);
    if (url && picture && !/\.svg$/i.test(name) && !NOT_A_SHOT.test(name)) out.push(shot(url, "release"));
  }
  for (const s of readmeShots(release.body, gh)) out.push({ ...s, from: "release" });
  return out;
}

// One per picture: http and https, host case, a trailing slash, github blob/raw links and ?raw=true are the same.
function shotKey(url) {
  let s = rawGithub(str(url)).replace(/^http:/i, "https:").replace(/[?&]raw=true$/, "");
  try {
    const u = new URL(s);
    u.hostname = u.hostname.toLowerCase();
    s = u.href;
  } catch { /* as it is */ }
  return s.replace(/\/+$/, "");
}

export function dedupeShots(list) {
  const seen = new Map();
  const out = [];
  for (const s of list) {
    if (!s?.url) continue;
    const k = shotKey(s.url);
    const had = seen.get(k);
    if (had) {
      if (!had.width && s.width) { had.width = s.width; had.height = s.height; }
      continue;
    }
    const copy = { ...s };
    seen.set(k, copy);
    out.push(copy);
  }
  return out;
}

// ---- Loading (fetched text, cached per app) --------------------------------------------------------------------

const PREVIEW_CACHE_PREFIX = "ifizbox.previews.";
const PREVIEW_CACHE_VERSION = 2;
export const PREVIEW_TTL = 24 * 3600 * 1000;
const memory = new Map();

function cached(store, key, now) {
  const m = memory.get(key);
  if (m && now - m.at < PREVIEW_TTL) return m.shots;
  try {
    const raw = store?.getItem(PREVIEW_CACHE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    // B362: entries from before v2 may hold an empty list from when extensionless pictures didn't count.
    if (!v || v.v !== PREVIEW_CACHE_VERSION || !Array.isArray(v.shots) || now - v.at >= PREVIEW_TTL) return null;
    memory.set(key, v);
    return v.shots;
  } catch { return null; }
}

function keep(store, key, shots, now) {
  const v = { v: PREVIEW_CACHE_VERSION, at: now, shots };
  memory.set(key, v);
  try { store?.setItem(PREVIEW_CACHE_PREFIX + key, JSON.stringify(v)); } catch { /* full or private: memory only */ }
}

export function clearPreviewMemory() { memory.clear(); pages.clear(); descriptions.clear(); }

// B328: an HTML depiction page is fetched once for its pictures (loadPreviews) and its description
// (loadDepictionDescription), which ask at the same time: the fetch is shared, the last few pages kept in memory.
const pages = new Map(); // url -> Promise<text>
const PAGES_KEPT = 8;
function depictionPage(url, text) {
  let p = pages.get(url);
  if (!p) {
    p = Promise.resolve().then(() => text(url));
    pages.set(url, p);
    p.catch(() => { if (pages.get(url) === p) pages.delete(url); });
    while (pages.size > PAGES_KEPT) pages.delete(pages.keys().next().value);
  }
  return p;
}

// A repo's README (any of the usual names, at HEAD) and its latest release -> pictures. Each fetch may fail alone.
export async function githubShots(gh, text) {
  const out = [];
  let readme = null;
  for (const name of ["README.md", "readme.md", "Readme.md", "README.markdown", "README"]) {
    try { readme = { body: await text(`https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/HEAD/${name}`), path: name }; break; } catch { /* next */ }
  }
  if (!readme) {
    try { // the API knows where the README is (docs/, .github/) and which name it has
      const meta = JSON.parse(await text(`https://api.github.com/repos/${gh.owner}/${gh.repo}/readme`));
      if (meta?.download_url) readme = { body: await text(meta.download_url), path: str(meta.path) || "README.md" };
    } catch { /* none */ }
  }
  if (readme) out.push(...readmeShots(readme.body, { owner: gh.owner, repo: gh.repo, path: readme.path }));
  try {
    const rel = JSON.parse(await text(`https://api.github.com/repos/${gh.owner}/${gh.repo}/releases/latest`));
    out.push(...releaseShots(rel, { owner: gh.owner, repo: gh.repo, ref: str(rel?.tag_name) || "HEAD" }));
  } catch { /* no release, or rate-limited */ }
  return out;
}

const MAX_SHOTS = 24;

export async function loadPreviews(key, { shots = [], html = null, gh = null } = {}, { text, store = globalThis.localStorage, now = Date.now() } = {}) {
  const own = dedupeShots(shots);
  if (own.length) return own.slice(0, MAX_SHOTS);
  if (!html && !gh) return [];
  const hit = key ? cached(store, key, now) : null;
  if (hit) return hit;
  let found = [];
  if (html) {
    try { found = htmlShots(await depictionPage(html, text), html); } catch { /* unreadable */ }
  }
  if (!found.length && gh) found = await githubShots(gh, text);
  const out = dedupeShots(found).slice(0, MAX_SHOTS);
  if (key) keep(store, key, out, now);
  return out;
}

// ---- F181: ratings, reviews and What's New from a Sileo depiction ------------------------------------------------
//
//   sileoRatings(json)  -> { average, count, noun, reviews: [{ title, author, rating, text, raw }] } or null
//     average: the first DepictionRatingView's rating (0-5), else the reviews' mean; count: how many reviews there
//     are (a depiction says nothing about how many people rated), null without any. null when there's no rating.
//   sileoWhatsNew(json) -> { title, text } or null: the newest entry of a "Changelog" / "What's New" tab: its first
//     header and the text under it, up to the next header (a Markdown view's own "## 1.2" headings count too).

const clampRating = (v) => (Number.isFinite(Number(v)) && str(v) !== "" ? Math.max(0, Math.min(5, Number(v))) : null);

export function sileoRatings(json) {
  let average = null;
  const reviews = [];
  walk(json, (v) => {
    if (v.class === "DepictionRatingView" && average == null) average = clampRating(v.rating);
    if (v.class === "DepictionReviewView") {
      reviews.push({ title: str(v.title), author: str(v.author), rating: clampRating(v.rating), text: str(v.markdown), raw: v.useRawFormat === true });
    }
  });
  const rated = reviews.filter((r) => r.rating != null);
  if (average == null && rated.length) average = Math.round((rated.reduce((n, r) => n + r.rating, 0) / rated.length) * 10) / 10;
  if (average == null && !reviews.length) return null;
  return { average, count: reviews.length || null, noun: "Reviews", reviews };
}

// A tab's leaf views in reading order (stacks and tabs flattened).
function leaves(v, out = [], depth = 0) {
  if (!v || typeof v !== "object" || depth > 40) return out;
  if (Array.isArray(v)) { for (const x of v) leaves(x, out, depth + 1); return out; }
  if (Array.isArray(v.views)) { leaves(v.views, out, depth + 1); return out; }
  if (v.class === "DepictionMinVersionForceView") return leaves(v.view, out, depth + 1);
  out.push(v);
  return out;
}

const CHANGES_TAB = /change|what.?s\s*new|release|history|updates?/i;
const HEADER = new Set(["DepictionHeaderView", "DepictionSubheaderView"]);

export function sileoWhatsNew(json) {
  let tab = null;
  walk(json, (v) => {
    if (tab || v.class !== "DepictionTabView" || !Array.isArray(v.tabs)) return;
    tab = v.tabs.find((t) => t && CHANGES_TAB.test(str(t.tabname))) ?? null;
  });
  if (!tab) return null;
  let title = null;
  const text = [];
  for (const v of leaves(tab)) {
    if (HEADER.has(v.class)) {
      if (title != null || text.length) break;
      title = str(v.title) || null;
      continue;
    }
    const t = v.class === "DepictionMarkdownView" ? str(v.markdown) : v.class === "DepictionLabelView" ? str(v.text) : "";
    if (!t) continue;
    if (v.class === "DepictionMarkdownView" && /^\s{0,3}#{1,6}\s/m.test(t)) {
      // "## 1.2\n- fix\n## 1.1 ..." in one view: its first heading and what follows, up to the next heading.
      const lines = t.split("\n");
      const at = lines.findIndex((l) => /^\s{0,3}#{1,6}\s/.test(l));
      if (title == null && !text.length) {
        title = lines[at].replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s*#+\s*$/, "").trim() || null;
        const pre = lines.slice(0, at).join("\n").trim();
        const rest = lines.slice(at + 1);
        const end = rest.findIndex((l) => /^\s{0,3}#{1,6}\s/.test(l));
        const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
        if (pre && !body) text.push(pre);
        if (body) text.push(body);
        if (end >= 0) break;
        continue;
      }
      const before = lines.slice(0, at).join("\n").trim();
      if (before) text.push(before);
      break;
    }
    text.push(t);
  }
  const body = text.join("\n").trim();
  return title || body ? { title, text: body } : null;
}

// ---- B328: an HTML depiction's description -----------------------------------------------------------------------
//
//   depictionDescription(html, baseUrl) -> string ("" when none): the description text of a Zebra/Cydia HTML
//     depiction. BigBoss's <fieldset id="description"> first; else a block named for its description, an <article>
//     or <main>, a block named content/entry/post, the <body>: the first of those with real text. Scripts, styles,
//     frames, forms, nav, header, footer, asides and button links are left out. Plain text: line breaks kept, a link
//     as its text with its URL after it (the page shows URLs as links), pictures dropped, no HTML.
//   betterDescription(field, fromDepiction) -> the longer of the Description: field's text and the depiction's.
//   loadDepictionDescription(url, { text, store, now }) -> Promise<string>: the page (shared with loadPreviews'
//     fetch) through depictionDescription, cached per URL for a day in `store`; "" when it can't be read.

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", bull: "•", middot: "·",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®",
  trade: "™", deg: "°", times: "×", rarr: "→", larr: "←", laquo: "«", raquo: "»" };

function decodeAll(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return n > 0 && n !== 0xfeff ? String.fromCodePoint(n) : ""; } catch { return ""; }
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

// The inside of the element whose opening tag starts at `at` (same-name tags nested inside are counted).
function innerOf(html, at, tag) {
  const open = html.indexOf(">", at);
  if (open < 0) return "";
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = open + 1;
  let depth = 1;
  for (let m; (m = re.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (!depth) return html.slice(open + 1, m.index);
  }
  return html.slice(open + 1);
}

const DROP_WHOLE = ["script", "style", "noscript", "template", "iframe", "object", "svg", "head", "title", "select", "button", "textarea"];
const CHROME = ["nav", "header", "footer", "aside", "form"];

function stripped(html) {
  let s = str(html).replace(/<!--[\s\S]*?-->/g, "");
  for (const t of DROP_WHOLE) s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?</${t}\\s*>`, "gi"), " ");
  return s.replace(/<(?:iframe|object|embed)\b[^>]*>/gi, " ");
}

function dropElements(html, tags) {
  let s = html;
  for (const t of tags) {
    for (let guard = 0; guard < 200; guard++) {
      const m = new RegExp(`<${t}\\b[^>]*>`, "i").exec(s);
      if (!m) break;
      const inner = innerOf(s, m.index, t);
      const end = s.indexOf(inner, m.index) + inner.length;
      const close = new RegExp(`</${t}\\s*>`, "i").exec(s.slice(end));
      s = s.slice(0, m.index) + " " + s.slice(end + (close ? close.index + close[0].length : 0));
    }
  }
  return s;
}

// HTML -> plain text with its line breaks.
function htmlToText(html, base) {
  let s = html
    // BigBoss's button links (View All Screenshots, Developer Website) are chrome, not description
    .replace(/<a\b[^>]*\bclass\s*=\s*["']?[^"'>]*\bbutton\b[^>]*>[\s\S]*?<\/a\s*>/gi, " ")
    .replace(/<label\b[^>]*>[\s\S]*?<\/label\s*>/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (m, attrs, inner) => {
      const label = inner.replace(/<[^>]*>/g, "").trim();
      const href = resolve(attr(` ${attrs}`, "href"), base);
      if (!href) return inner;
      const shown = decodeAll(label);
      if (!shown) return ` ${href} `;
      const same = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
      return same(shown) === same(href) || shown.includes(href) ? inner : `${inner} (${href})`;
    })
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n\u0000")
    .replace(/<\/?(?:p|div|section|article|main|fieldset|blockquote|pre|ul|ol|dl|dt|dd|table|tr|h[1-6]|hr|center|panel)\b[^>]*>/gi, "\n")
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  s = decodeAll(s);
  const lines = s.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim());
  const out = [];
  for (const l of lines) {
    const line = l.startsWith("\u0000") ? (/^\u0000\s*[•·\-*]/.test(l) ? l.slice(1).trim() : `• ${l.slice(1).trim()}`) : l;
    if (line === "•") continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const MAX_DESCRIPTION = 8000;
const realText = (t) => t.replace(/https?:\/\/\S+/g, "").replace(/[^\p{L}\p{N}]+/gu, "").length >= 20;

export function depictionDescription(html, baseUrl) {
  const page = stripped(html);
  if (!page.trim()) return "";
  const base = resolve(attr(/<base\b[^>]*>/i.exec(str(html))?.[0] ?? "", "href"), baseUrl) || baseUrl;
  const cap = (t) => (t.length > MAX_DESCRIPTION ? t.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, "") + "…" : t);
  const pick = (inner) => htmlToText(dropElements(inner, CHROME), base);
  // BigBoss: <fieldset id="description">
  const bb = /<fieldset\b[^>]*\bid\s*=\s*["']?description\b[^>]*>/i.exec(page);
  if (bb) {
    const t = pick(innerOf(page, bb.index, "fieldset"));
    if (realText(t)) return cap(t);
  }
  const blocks = (re) => [...page.matchAll(re)].map((m) => pick(innerOf(page, m.index, m[1].toLowerCase())));
  const tries = [
    /<(div|section|fieldset|td|p)\b[^>]*\b(?:id|class)\s*=\s*["']?[^"'>]*\bdesc(?:ription)?\b[^>]*>/gi,
    /<(article|main)\b[^>]*>/gi,
    /<(div|section)\b[^>]*\b(?:id|class)\s*=\s*["']?[^"'>]*\b(?:content|entry|post|main)\b[^>]*>/gi,
  ];
  for (const re of tries) {
    const found = blocks(re).filter(realText).sort((a, b) => b.length - a.length)[0];
    if (found) return cap(found);
  }
  const body = /<body\b[^>]*>/i.exec(page);
  const t = pick(body ? innerOf(page, body.index, "body") : page);
  return realText(t) ? cap(t) : "";
}

const flat = (t) => str(t).replace(/\s+/g, " ");
export function betterDescription(field, fromDepiction) {
  const f = str(field);
  const d = str(fromDepiction);
  return d && flat(d).length > flat(f).length ? d : f;
}

const DESC_CACHE_PREFIX = "ifizbox.depdesc.";
const descriptions = new Map(); // url -> { at, text }

export async function loadDepictionDescription(url, { text, store = globalThis.localStorage, now = Date.now() } = {}) {
  if (!isHttp(url) || typeof text !== "function") return "";
  const m = descriptions.get(url);
  if (m && now - m.at < PREVIEW_TTL) return m.text;
  try {
    const v = JSON.parse(store?.getItem(DESC_CACHE_PREFIX + url) ?? "null");
    if (v && typeof v.text === "string" && now - v.at < PREVIEW_TTL) { descriptions.set(url, v); return v.text; }
  } catch { /* unreadable: fetch */ }
  let found;
  try { found = depictionDescription(await depictionPage(url, text), url); } catch { return ""; }
  const v = { at: now, text: found };
  descriptions.set(url, v);
  try { store?.setItem(DESC_CACHE_PREFIX + url, JSON.stringify(v)); } catch { /* full or private: memory only */ }
  return found;
}
