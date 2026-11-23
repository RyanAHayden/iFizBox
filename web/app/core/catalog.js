// The package catalog: every source's packages for this device's architecture, grouped into Cydia's sections,
// merged across sources ("All Sources") and searchable. Pure JS, no DOM, no I/O: core/worker.js holds one
// catalog and answers the UI's questions (core/parser.js `catalog(op, args)`), so parsing, grouping and search
// stay off the UI thread. Cydia's rules followed here: docs/cydia.md "Sections and section icons".
//
//   const c = createCatalog();
//   c.load(key, packagesText, root, arch)  -> number of packages kept
//   c.sections(key | "*")                  -> { total, sections: [{ name, count }] }
//   c.sections(key, { hidden: true })      -> every section, hidden ones too, each with `hidden` (edit mode)
//   c.setHidden(names)                     -> Section Visibility: these sections drop out of sections, list,
//                                             search and author (and so Changes); package() and has() still see them
//   c.setHiddenAuthors(names)              -> Hide by Author (F104, Zebra's filters): packages whose Author or
//                                             Maintainer is one of these drop out like hidden sections' (author()
//                                             still lists them, so the author page can show them again)
//   c.setBlocked(ids)                      -> Block (F226): these package ids drop out like hidden sections'
//                                             (author() too); package() and upgrades() still see them
//   c.list(key | "*", section | "*")       -> [row], sorted by name ("*": All Sources / All Packages)
//   c.search(query)                        -> [row], best matches first (any non-blank query)
//   c.author(name)                         -> [row]: every package whose Author or Maintainer is `name`; what
//                                             can't work on the device is kept, marked { misfit: true, why }
//   c.package(id, key | "*")               -> { stanza, key, others: [{ key, version }] } or null; a package
//                                             no source carries but dpkg has installed comes from its status
//                                             stanza: { stanza, key: null, row, others: [], installedOnly: true }
//   c.history(id, key | "*")               -> Version History (F29): { kind: "apt", id, name, versions:
//                                             aptVersionList } or { kind: "ipa", id, name, key, sourceUrl,
//                                             versions: altVersionList }; null when unknown
//   c.versions()                           -> [[key, id, version]] for every source (Changes, core/changes.js)
//   c.categories()                         -> Browse (F46): [{ name, count }] in BROWSE_CATEGORIES order, empty
//                                             ones and (Not Jailbroken) tweak categories left out
//   c.browse(category)                     -> [row] in that Browse category, sorted by name
//   c.popular({ limit })                   -> [row] ranked by how many sources list it, then newest (rankPopular),
//                                             each with `sources` (that count)
//   c.collection(id)                       -> F154: [row] in Browse's collection `id` (COLLECTIONS)
//   c.roulette({ per })                    -> F154: Tweak Roulette's pool, [{ label, icon, rows }] (roulettePool)
//   c.aptProblems(aptOutput)              -> N4: explainApt over the same index as deps (the Confirm sheet)
//   c.queueInfo([id])                      -> N4: { id: { name, restart, kind } } for the queue's packages (F151: kind)
//   c.runInfo([{ id, version }])           -> F234: { id: { name, debUrl, sha256, md5sum, size, depends, preDepends },
//                                             installed: { name: version } } for the queue run (core/installrun.js)
//   c.deps(id, key | "*")                  -> F18 (core/deps.js explain): { ok, problems, targets } for an APT
//                                             package, against every source and the installed list; null if unknown
//   c.setInstalled(statusText)             -> number of installed packages (dpkg's status file, core/installed.js)
//   c.installed()                          -> [row] installed, sorted by name, each with `installed` (its version)
//                                             and `size` (F104: Installed-Size in bytes, or null)
//   c.upgrades(holds, { dpkgHolds })       -> { available: [row], ignored: [row] } (Changes, core/installed.js)
//   c.loadAlt(key, json, ios, format, hide) -> an AltStore source (F9, core/altstore.js): each app a row, its
//                                             candidate the newest version iOS `ios` runs; apps none runs on left out,
//                                             and (F178) apps whose bundle ID is in `hide`
//   c.altSource(key)                       -> the AltStore source's page data: { name, tintColor, headerURL, news,
//                                             featured: [row], ... } or null
//   c.setDevice(device, { filter })        -> "Works on my phone" (F17, core/compat.js): every row gets `compat`,
//                                             its code for `device`; with filter on (the default) rows that can't
//                                             work drop out of sections, list, search and author like hidden ones.
//                                             A device with jailbreak "none" (F37, Not Jailbroken) sees AltStore
//                                             sources only: APT sources' packages drop out of everything, filter or
//                                             not (lists, Search, package pages, installed rows and upgrades)
//   c.setFilters(stored, { lite })         -> Source Filters (F382, core/sourcefilters.js): each row's own source
//                                             decides (All Sources' choices unless changed there) whether old,
//                                             unknown-iOS, paid and (lite) rootful-only tweaks drop out of sections,
//                                             list, search and author like hidden ones; a source's Works on My Phone
//                                             overrides setDevice's filter for its rows; Newest Copy Only leaves a
//                                             package out of a source's own list when another source has it newer.
//                                             package() and upgrades() still see everything
//   c.setIpaInfo(map)                      -> F160: { downloadURL: info } read from IPAs on this device (core/ipainfo.js);
//                                             merged into what is kept, and apps whose candidate is one of them are
//                                             judged with it (the source's own range wins, unless the IPA's own
//                                             MinimumOSVersion is higher: ipainfo.js ipaRaises). Returns how many are kept
//   c.setTweakVerdicts(map)                -> B377: { "id@version": true|false|null }, merged: true drops that Tweak
//                                             Source tweak (for iOS itself, or refused) from App Tweaks, Search,
//                                             Sections' counts and its source's list; false (it works) lists it; null
//                                             takes the verdict back. -> how many dropped. B391: one with no verdict is
//                                             listed only when its name or description mentions a known app or one of
//                                             the user's
//   c.setTweakKnown({ apps, held, worked }) -> B391: the user's apps { bundleId: name }, the package ids an app already
//                                             has (always listed) and those this phone found to work (listed while
//                                             their version has no verdict of its own)
//   c.shows(id, key)                       -> whether a Tweak Source's list has it (its banner shows then); any other
//                                             source: whether it has the package
//
// A row is the slim record lists draw: { id, name, short, version, section, icon, key, author, compat, purpose }.
import { parseControl, description, resolveFilename, resolveIcon, matchesArch, compareVersions, DEFAULT_ARCH, parseRelations } from "./apt.js";
import { parseStatus, installedStanzas, findUpgrades } from "./installed.js";
import { compat, compatCode, isIncompatible, normalizeDevice, needText } from "./compat.js";
import { parseSource, appStanza, isAltKey, runsOn, installOptions, signableApp } from "./altstore.js";
import { depIndex, explain, explainApt } from "./deps.js";
import { withIpaInfo } from "./ipainfo.js";
import { IdMap, IdSet, sameId } from "./apt.js"; // B407: package names compare ignoring case
import { needsRestart } from "./queue.js";
import { packageKind } from "./progress.js";
import { injectableFromFields, hintMatcher } from "./tweakfields.js"; // F302; C32: not tweaks.js, which pulls unpack.js in
import { NO_SECTION, sectionName, simpleSection, parseAuthor, compareNames, SECTION_GROUPS, sectionGroup, APP_TWEAKS } from "./sections.js";
import { normalizeFilters, resolveFilters, filterOn, ALL_SOURCES, isOldPackage, isUnknownIos, isAppTweak } from "./sourcefilters.js"; // F382

export const ALL = "*";

// C36: the section, author and name helpers live in core/sections.js (installed.js needs them, and importing them
// from here made an import cycle); re-exported so the catalog's callers keep importing them from here.
export { NO_SECTION, sectionName, simpleSection, parseAuthor, compareNames, SECTION_GROUPS, sectionGroup, APP_TWEAKS };

const tagsOf = (st) => String(st.tag ?? "").split(",").map((t) => t.trim()).filter(Boolean);

// Cydia hides packages tagged cydia::obsolete and those whose role:: isn't enduser, hacker or developer.
export function isVisible(st) {
  for (const t of tagsOf(st)) {
    if (t === "cydia::obsolete") return false;
    if (t.startsWith("role::") && !["role::enduser", "role::hacker", "role::developer"].includes(t)) return false;
  }
  return true;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// Cydia's package-list index: the uppercased first letter, or "#" for anything else.
export function indexLetter(name) {
  const c = String(name ?? "").trim().charAt(0).toUpperCase();
  return /\p{Lu}/u.test(c) ? c.normalize("NFD").charAt(0) : "#";
}

function makeRow(st, key) {
  const name = st.name || st.package;
  const author = parseAuthor(st.author)?.name ?? "";
  const maint = parseAuthor(st.maintainer)?.name ?? "";
  const desc = description(st);
  return {
    id: st.package, name, short: desc.short, version: st.version ?? "", section: sectionName(st.section),
    icon: st.iconUrl ?? null, key, author: author || maint, paid: tagsOf(st).includes("cydia::commercial"),
    kind: st.kind === "ipa" ? "ipa" : undefined, purpose: purposeOf(st),
    // search fields, lower-cased once at load; dropped before rows leave the worker
    _hay: [name, st.package, desc.short, desc.long, author, maint].join("\n").toLowerCase(),
    _n: name.toLowerCase(), _id: st.package.toLowerCase(), _a: author.toLowerCase(), _m: maint.toLowerCase(),
    // F382: what the Source Filters test, worked out once at load (core/sourcefilters.js)
    _old: isOldPackage(st), _unk: isUnknownIos(st), _app: isAppTweak(st),
  };
}

// F126: Cydia's primaryPurpose (the first purpose:: tag), for the corner badge (core/sectionicons.js).
const purposeOf = (st) => tagsOf(st).find((t) => t.startsWith("purpose::"))?.slice(9) || null;

// `guess` (B391): the apps a Tweak Source's tweak with no verdict mentions, there only when it mentions one.
const slim = ({ id, name, short, version, section, icon, key, author, compat, paid, kind, purpose, _guess }) => ({ id, name, short, version, section, icon, key, author, compat, paid, kind, purpose,
  ...(_guess?.length ? { guess: _guess } : {}) });

// A section filter value -> a row test: "group:Tweaks" (sectionGroup), a section's name, or null/"*" for any.
function sectionTest(section) {
  if (section == null || section === "" || section === ALL) return null;
  const s = String(section);
  if (s.startsWith("group:")) { const g = s.slice(6); return (r) => sectionGroup(r.section) === g; }
  return (r) => r.section === s;
}

// ---- Browse (F46) ------------------------------------------------------------------------------------------

// Home's Browse: AltStore app categories and APT sections merged into one short list. A row's category comes from
// its section: AltStore's "Apps (Games)" by the category inside, an APT section by its full lower-cased name, then
// by its simple name ("Themes (SpringBoard)" -> themes). APT sections with no category here (Libraries, System
// packages, Packaging...) stay out of Browse; All Packages still lists them.
export const BROWSE_CATEGORIES = ["Games", "Emulators", "Entertainment", "Photo & Video", "Social", "Lifestyle",
  "Utilities", "Developer", "Themes", "Tweaks", "Other"];
// Categories only a jailbroken phone can install: hidden while Not Jailbroken (F37).
const JAILBREAK_CATEGORIES = new Set(["Themes", "Tweaks"]);
const BROWSE_OF = {
  games: "Games", game: "Games", emulators: "Emulators", emulator: "Emulators",
  entertainment: "Entertainment", multimedia: "Entertainment", books: "Entertainment", music: "Entertainment",
  "photo & video": "Photo & Video", social: "Social", messaging: "Social", lifestyle: "Lifestyle",
  utilities: "Utilities", productivity: "Utilities", networking: "Utilities", navigation: "Utilities",
  developer: "Developer", development: "Developer", "terminal support": "Developer", scripting: "Developer",
  administration: "Developer",
  themes: "Themes", theme: "Themes", wallpaper: "Themes", fonts: "Themes", ringtones: "Themes",
  tweaks: "Tweaks", addons: "Tweaks", widgets: "Tweaks", keyboards: "Tweaks",
  other: "Other", apps: "Other",
};
// Neither AltStore nor APT has an emulator category: a game, utility or app whose name or subtitle says
// "emulator" (or "emulation") goes under Emulators instead.
const EMULATED = new Set(["Games", "Utilities", "Entertainment", "Other"]);
const EMULATOR_WORD = /\bemulat(?:or|ors|ion)\b/i;

// A row ({ section, name, short }) -> its Browse category, or null when it has none.
export function browseCategory(row) {
  const s = String(row?.section ?? "").trim().toLowerCase();
  const inner = s.match(/^apps \((.*)\)$/);
  const cat = BROWSE_OF[inner ? inner[1] : s] ?? (inner ? "Other" : BROWSE_OF[simpleSection(s)]) ?? null;
  if (cat && EMULATED.has(cat) && (EMULATOR_WORD.test(row.name ?? "") || EMULATOR_WORD.test(row.short ?? ""))) return "Emulators";
  return cat;
}

// Rows -> the Browse list: [{ name, count }] in BROWSE_CATEGORIES order, empty ones left out, and Themes and
// Tweaks too unless `jailbroken`.
export function mergeCategories(rows, { jailbroken = true } = {}) {
  const counts = new Map();
  for (const r of rows) {
    const c = browseCategory(r);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return BROWSE_CATEGORIES.filter((c) => counts.has(c) && (jailbroken || !JAILBREAK_CATEGORIES.has(c)))
    .map((name) => ({ name, count: counts.get(name) }));
}

// Popular, until real install counts exist: [{ row, sources, date }] -> rows, most sources first (what most
// sources list), then the newest update (`date`, epoch ms; AltStore versions carry one, APT packages don't), then
// by name. At most `limit`.
export function rankPopular(items, limit = 50) {
  return [...items].sort((a, b) => b.sources - a.sources || (b.date ?? 0) - (a.date ?? 0) || compareNames(a.row, b.row))
    .slice(0, limit);
}

// ---- Browse's lists (F124) ----------------------------------------------------------------------------------

// Browse's Cydia-style lists, in the order its page shows them, before the categories. `jailbreak`: only where the
// phone is jailbroken (Settings > Device; Not Jailbroken lists apps only, F37).
export const BROWSE_LISTS = [
  { id: "new", title: "New" },
  { id: "updated", title: "Recently Updated" },
  { id: "popular", title: "Popular" },
  { id: "featured", title: "Featured" },
  { id: "free-apps", title: "Free Apps", free: "apps" },
  { id: "free-tweaks", title: "Free Tweaks", free: "tweaks", jailbreak: true },
  { id: "free-themes", title: "Free Themes", free: "themes", jailbreak: true },
];
export const browseList = (id) => BROWSE_LISTS.find((l) => l.id === id) ?? null;
export const browseListsFor = (jailbroken = true) => BROWSE_LISTS.filter((l) => jailbroken || !l.jailbreak);

// New and Recently Updated: how many days back they reach, and how many rows each keeps.
export const FRESH_DAYS = 30;
const FRESH_LIMIT = 100;

// The Changes tab's records (core/changes.js: { id, version, first, date? }) and the catalog's rows (All Sources,
// one per id, the candidate version) -> { new: [row], updated: [row] }, each row with `seen` (epoch ms) and
// `change`. Times as the Changes tab counts them (core/changes.js dayGroups): a version's own date where the
// source gives one (AltStore versions[]), else the refresh that first saw it; undated records from the first
// refresh are the archive, never new. A row is new when its candidate is the first version ever seen of it, and
// updated when an older one came before. Newest first (rows keep their order on a tie), the last `days` only.
export function freshLists(records, rows, { now = Date.now(), days = FRESH_DAYS, limit = FRESH_LIMIT } = {}) {
  let baseline = Infinity;
  for (const r of records) if (r.date == null && r.first < baseline) baseline = r.first;
  const times = new Map(); // id -> { first, byVersion: version -> earliest counted time }
  for (const r of records) {
    const t = r.date ?? r.first;
    let p = times.get(r.id);
    if (!p) times.set(r.id, (p = { first: t, byVersion: new Map() }));
    if (t < p.first) p.first = t;
    if (r.date == null && r.first === baseline) continue;
    const v = p.byVersion.get(r.version);
    if (v === undefined || t < v) p.byVersion.set(r.version, t);
  }
  const from = now - days * 86400000;
  const out = { new: [], updated: [] };
  rows.forEach((row, i) => {
    const p = times.get(row.id);
    const at = p?.byVersion.get(row.version ?? "");
    if (at === undefined || at < from) return;
    const change = at > p.first ? "updated" : "new";
    out[change].push([{ ...row, change, seen: Math.min(at, now) }, i]);
  });
  const order = (list) => list.sort((a, b) => b[0].seen - a[0].seen || a[1] - b[1]).slice(0, limit).map(([r]) => r);
  return { new: order(out.new), updated: order(out.updated) };
}

// Free Apps / Tweaks / Themes: a row's kind for those lists. Apps are AltStore apps (IPAs) and APT packages in an
// app section; Tweaks and Themes are Browse's categories of those names.
export function freeKind(row) {
  if (row?.kind === "ipa" || sectionGroup(row?.section ?? "") === "Apps") return "apps";
  const c = browseCategory(row);
  return c === "Tweaks" ? "tweaks" : c === "Themes" ? "themes" : null;
}

// ---- Browse, rebuilt (F154) ---------------------------------------------------------------------------------

// The local calendar day `t` falls on, "2026-11-18": the Tweak of the Day and Roulette's streak count by it.
export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The day before "2026-11-18" ("2026-11-17"), by the calendar (DST-safe).
export function dayBefore(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
}

// FNV-1a over a string: the same number on every device and every load, so a day picks the same package everywhere.
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// Tweak of the Day: one of `rows` for `day` (dayKey), the same all day whatever order the rows come in (each id
// once, sorted, then the day's hash picks one). Null for no rows.
export function dailyPick(rows, day = dayKey()) {
  const byId = new Map();
  for (const r of rows ?? []) if (r?.id && !byId.has(r.id)) byId.set(r.id, r);
  const ids = [...byId.keys()].sort();
  return ids.length ? byId.get(ids[hash32(`ifizbox:${day}`) % ids.length]) : null;
}

// What a build's Browse is about: tweaks and themes where the phone is jailbroken, else apps (F37).
export const browseKind = (row, jailbroken = true) => {
  const k = freeKind(row);
  return jailbroken ? k === "tweaks" || k === "themes" : k === "apps";
};

const lowSimple = (row) => simpleSection(String(row?.section ?? "").trim().toLowerCase());
const says = (row, re) => re.test(`${row?.name ?? ""}\n${row?.short ?? ""}`);

// Browse's Collections: each a filtered list (browse/collection:<id>) by section and the words in a row's name or
// short description. `icon`: a file in icons/sections. `jailbreak`: the jailbroken build's four; the others are
// the apps builds' (sideload, the website while Not Jailbroken).
export const COLLECTIONS = [
  // Themes (user 2026-11-18: Home's Themes tile moved here): the Themes sections Home's tile opened.
  { id: "themes", title: "Themes", subtitle: "Icons, looks and SpringBoard themes", icon: "Themes", jailbreak: true,
    test: (r) => lowSimple(r) === "themes" },
  { id: "lock-screen", title: "Lock Screen", subtitle: "Clocks, music and notifications", icon: "Widgets", jailbreak: true,
    test: (r) => lowSimple(r) === "widgets" || says(r, /\block ?screen|lockscreen|cover ?sheet|notification/i) },
  { id: "home-screen", title: "Home Screen", subtitle: "Layouts, docks and icon effects", icon: "Tweaks", jailbreak: true,
    test: (r) => browseCategory(r) === "Tweaks" && says(r, /home ?screen|springboard|\bdock\b|\bicons?\b|folder|page/i) },
  { id: "keyboard", title: "Keyboard", subtitle: "Swipes, sounds and layouts", icon: "Keyboards", jailbreak: true,
    test: (r) => lowSimple(r) === "keyboards" || says(r, /keyboard/i) },
  { id: "make-it-yours", title: "Make It Yours", subtitle: "Fonts, wallpapers and sounds", icon: "Wallpaper", jailbreak: true,
    test: (r) => ["wallpaper", "fonts", "ringtones"].includes(lowSimple(r)) },
  { id: "play", title: "Play", subtitle: "Games and emulators", icon: "Games",
    test: (r) => ["Games", "Emulators"].includes(browseCategory(r)) },
  { id: "create", title: "Create", subtitle: "Photo, video and music", icon: "Multimedia",
    test: (r) => ["Photo & Video", "Entertainment"].includes(browseCategory(r)) },
  { id: "connect", title: "Connect", subtitle: "Chat, social and messaging", icon: "Social",
    test: (r) => browseCategory(r) === "Social" },
  { id: "tools", title: "Tools", subtitle: "Utilities and developer tools", icon: "Utilities",
    test: (r) => ["Utilities", "Developer"].includes(browseCategory(r)) },
];
export const collection = (id) => COLLECTIONS.find((c) => c.id === id) ?? null;
export const collectionsFor = (jailbroken = true) => COLLECTIONS.filter((c) => Boolean(c.jailbreak) === Boolean(jailbroken));

// Tweak Roulette's wheels: type (what kind of package, with its section icon), vibe (for fun: no data says what's
// "silly"), price (Spin always rests on Free; turned by hand, Paid picks a paid one). The apps builds spin app categories.
export const ROULETTE_TYPES = {
  jailbreak: [
    { label: "Tweak", icon: "Tweaks", test: (r) => browseCategory(r) === "Tweaks" },
    { label: "Theme", icon: "Themes", test: (r) => browseCategory(r) === "Themes" },
    { label: "Toy", icon: "Toys", test: (r) => ["toys", "fun"].includes(lowSimple(r)) },
    { label: "Utility", icon: "Utilities", test: (r) => browseCategory(r) === "Utilities" || lowSimple(r) === "system" },
  ],
  apps: [
    { label: "Game", icon: "Games", test: (r) => browseCategory(r) === "Games" },
    { label: "Emulator", icon: "Entertainment", test: (r) => browseCategory(r) === "Emulators" },
    { label: "Utility", icon: "Utilities", test: (r) => ["Utilities", "Developer"].includes(browseCategory(r)) },
    { label: "Photo", icon: "Multimedia", test: (r) => browseCategory(r) === "Photo & Video" },
    { label: "Social", icon: "Social", test: (r) => browseCategory(r) === "Social" },
    { label: "Fun", icon: "Entertainment", test: (r) => ["Entertainment", "Lifestyle", "Other"].includes(browseCategory(r)) },
  ],
};
export const ROULETTE_VIBES = ["Useful", "Pretty", "Silly", "Tiny", "Clever", "Hidden Gem"];
export const ROULETTE_PRICES = ["Free", "Paid", "Free", "Free", "Paid", "Free"];
const ROULETTE_PER = 150;

// Rows -> the wheels' pool: [{ label, icon, rows, paid }] per type, rows the free ones and paid the paid ones, at most
// `per` each (spread evenly over the type's rows, by name, so the pool is the same between spins). An empty type
// stays on the wheel; a spin never rests on it (spinPick).
export function roulettePool(rows, { jailbroken = true, per = ROULETTE_PER } = {}) {
  const spread = (all) => {
    const step = all.length > per ? all.length / per : 1;
    return step === 1 ? all : Array.from({ length: per }, (_, i) => all[Math.floor(i * step)]);
  };
  return ROULETTE_TYPES[jailbroken ? "jailbreak" : "apps"].map(({ label, icon, test }) => {
    const all = rows.filter((r) => test(r));
    return { label, icon, rows: spread(all.filter((r) => !r.paid)), paid: spread(all.filter((r) => r.paid)) };
  });
}

// The wheels turned by hand: a package of type `label`, paid or free as the price wheel says, by `rand`; not `last`
// (the id shown before) when there's another. null when the sources have none of that kind.
export function choosePick(pool, label, { paid = false, last = null, rand = Math.random } = {}) {
  const t = (pool ?? []).find((x) => x.label === label);
  const rows = (paid ? t?.paid : t?.rows) ?? [];
  const fresh = rows.length > 1 ? rows.filter((r) => r.id !== last) : rows;
  return fresh.length ? fresh[Math.min(fresh.length - 1, Math.floor(rand() * fresh.length))] : null;
}

// One spin: a type that has packages, then one of its packages, both by `rand` (0 <= x < 1). -> { type, row }
// (type: the index on the type wheel) or null when no type has any.
export function spinPick(pool, rand = Math.random) {
  const full = (pool ?? []).map((t, i) => [t, i]).filter(([t]) => t.rows?.length);
  if (!full.length) return null;
  const [t, type] = full[Math.min(full.length - 1, Math.floor(rand() * full.length))];
  return { type, row: t.rows[Math.min(t.rows.length - 1, Math.floor(rand() * t.rows.length))] };
}

// Search (F101, docs/sileo-zebra.md 'Search'). Any non-blank query searches, one Latin character too (the user
// dropped Zebra's short-query rule); Canister still needs two (core/canister.js askable()).
export function searchable(query) {
  return String(query ?? "").trim() !== "";
}

// Does `s` hold `q` at the start of a word (after a character that is not a letter or digit)? "board" starts a
// word in "snow board" and "com.x.board", not in "keyboard". The start of `s` itself is the prefix tier's.
export function wordStart(s, q) {
  for (let i = s.indexOf(q, 1); i > 0; i = s.indexOf(q, i + 1)) {
    if (!/[\p{L}\p{N}]/u.test(s[i - 1])) return true;
  }
  return false;
}

// ---- Version History (F29) ---------------------------------------------------------------------------------

// APT: `offers` [{ key, stanza }] (every version every source lists) -> one entry per version, newest first:
// { version, keys: [source keys carrying it], size, debUrl, filename, sha256, md5sum, candidate, installed }. F133:
// sha256 / md5sum are the hashes of the stanza that gave debUrl (null when it lists none). `candidate` is the
// version the page shows; `installed` dpkg's. An installed version no source still offers is listed too (keys []),
// so Downgrade (N4) sees where the phone stands.
export function aptVersionList(offers, { candidate = null, installed = null } = {}) {
  const byVersion = new Map();
  for (const { key, stanza } of offers) {
    const v = String(stanza?.version ?? "");
    if (!v) continue;
    let o = byVersion.get(v);
    if (!o) {
      o = { version: v, keys: [], size: Number(stanza.size) > 0 ? Number(stanza.size) : null, debUrl: stanza.debUrl ?? null,
        filename: stanza.filename ?? null, ...stanzaHashes(stanza), candidate: v === candidate, installed: v === installed };
      byVersion.set(v, o);
    }
    if (!o.keys.includes(key)) o.keys.push(key);
    if (!o.debUrl && stanza.debUrl) Object.assign(o, { debUrl: stanza.debUrl, ...stanzaHashes(stanza) });
  }
  if (installed && !byVersion.has(installed)) {
    byVersion.set(installed, { version: installed, keys: [], size: null, debUrl: null, filename: null, sha256: null, md5sum: null,
      candidate: installed === candidate, installed: true });
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

// F133: a Packages stanza's SHA256 and MD5sum (lowercase hex, else null), for the shell to check a download apt
// doesn't make (F131's full-URL Filenames).
function stanzaHashes(stanza) {
  const hex = (v, n) => {
    const t = String(v ?? "").trim().toLowerCase();
    return t.length === n && /^[0-9a-f]+$/.test(t) ? t : null;
  };
  return { sha256: hex(stanza?.sha256, 64), md5sum: hex(stanza?.md5sum, 32) };
}

// AltStore: every versions[] entry of a parsed app (core/altstore.js parseApp), in the source's order (newest
// first), each with `runs` (this iOS is inside its min/maxOSVersion; ios null: true), `candidate` (the newest
// that runs: the one the page shows) and `installable` (it has an IPA or a signed link to install from).
export function altVersionList(app, ios = null) {
  const list = Array.isArray(app?.versions) ? app.versions : [];
  let candidate = false;
  return list.map((v) => {
    const runs = runsOn(v, ios);
    const isCandidate = runs && !candidate;
    if (isCandidate) candidate = true;
    const o = installOptions(v, null);
    return { ...v, runs, candidate: isCandidate, installable: Boolean(o.itms || o.download) };
  });
}

export function createCatalog() {
  const sources = new Map(); // key -> { byId: Map(id -> { row, stanza }) }
  let merged = null;         // "All Sources": id -> { row, stanza, key }, built when first asked, dropped on load
  const sorted = new Map();  // key -> rows sorted by name (cache)
  let hidden = new Set();    // Section Visibility (Cydia's CydiaSections Hidden): section names left out of lists
  const shown = new Map();   // key -> sorted rows outside hidden sections (cache)
  let hiddenAuthors = new Set(); // F104: lower-cased author/maintainer names whose packages are left out of lists
  let blocked = new IdSet(); // F226: package ids blocked on the device, left out like hidden sections' packages
  let device = null;         // F17: the device rows are judged for (core/compat.js), or null before one is set
  let fitFilter = false;     // and whether rows that can't work on it are left out
  const fitting = new Map(); // key -> sorted rows that can work on the device (cache)
  let appsOnly = false;       // F37: the device isn't jailbroken: only AltStore sources (`alt:` keys) count
  // F302: Tweak Sources in the sideload build: APT sources loaded with { tweaks: true } (injectable tweaks only) count
  // on their own (their source page, a tweak's page) but stay out of All Sources, Search and Browse.
  const tweakKeys = new Set();
  const counts = (key) => !appsOnly || isAltKey(key) || tweakKeys.has(key);
  const inAll = (key) => !appsOnly || isAltKey(key);
  // B407: a map over several sources' packages. apt takes Oreo and oreo as one package, so ids compare ignoring case;
  // without a jailbreak the ids are apps' bundle IDs, kept apart as spelled.
  const mergeMap = () => (appsOnly ? new Map() : new IdMap());
  const ipaInfo = new Map(); // F160: downloadURL -> what the IPA itself says (core/ipainfo.js), from the UI
  const judged = (st) => (st?.kind === "ipa" && st.downloadURL && ipaInfo.has(st.downloadURL) ? withIpaInfo(st, ipaInfo.get(st.downloadURL)) : st);
  // F382: Source Filters. `filterStore` is the stored choices (null until the UI sent them: nothing filtered), each
  // source's resolved switches cached by key; `filterGen` tells the list caches built on them that they changed.
  let filterStore = null, filterLite = false, filterGen = 0;
  const keyFilters = new Map();
  function filtersOf(key) {
    if (!filterStore) return null;
    let f = keyFilters.get(key);
    if (!f) { f = resolveFilters(filterStore, [key], { lite: filterLite }).byKey[key]; keyFilters.set(key, f); }
    return f;
  }
  const filteredOut = (r) => {
    const f = filtersOf(r.key);
    return Boolean(f) && ((f.old && r._old) || (f.unknown && r._unk) || (f.paid && r.paid) || (f.appTweaks && tweakKeys.has(r.key) && !r._app));
  };
  // Works on My Phone: a source's own switch, else All Sources' (setDevice's filter).
  const misfit = (r) => {
    if (!device || !isIncompatible(r.compat)) return false;
    const own = filtersOf(r.key)?.fit;
    return typeof own === "boolean" ? own : fitFilter;
  };
  function setFilters(stored, { lite = false } = {}) {
    filterStore = stored == null ? null : normalizeFilters(stored);
    filterLite = Boolean(lite);
    keyFilters.clear();
    filterGen++;
    sorted.clear();
    shown.clear();
    fitting.clear();
    return filterStore ? Object.keys(filterStore).length : 0;
  }
  // B377: the Tweak Index's (or this device's) verdicts: "id@version" -> true when that tweak can't go into an app
  // (systemOnly, or refused: core/tweakindex.js dropsFromCatalog), false when it can. B391: a Tweak Source's row is
  // listed (App Tweaks, Search, Sections' counts, its source's list) by its verdict; with none, only when its name or
  // description mentions a known app or one of the user's, or this phone found it to work. One an app already has is
  // always listed. Nothing is downloaded to find out. package() still opens what isn't listed.
  const tweakVerdicts = new Map();
  let tweakKnown = { apps: {}, held: new Set(), worked: new Set() };
  let mentions = hintMatcher();
  function systemTweak(r) {
    if (!tweakKeys.has(r.key)) return false;
    const drop = tweakVerdicts.get(`${r.id}@${r.version}`);
    if (drop !== undefined) {
      r._guess = undefined;
      return drop && !tweakKnown.held.has(r.id);
    }
    r._guess ??= mentions({ name: r.name, description: sources.get(r.key)?.byId.get(r.id)?.stanza.description });
    return !r._guess.length && !tweakKnown.worked.has(r.id) && !tweakKnown.held.has(r.id);
  }
  function tweaksChanged() {
    filterGen++;
    sorted.clear();
    shown.clear();
    fitting.clear();
  }
  function setTweakVerdicts(map) {
    let changed = false;
    for (const [k, drop] of Object.entries(map && typeof map === "object" ? map : {})) {
      if (typeof drop === "boolean") {
        if (tweakVerdicts.get(k) !== drop) { tweakVerdicts.set(k, drop); changed = true; }
      } else if (drop === null && tweakVerdicts.delete(k)) changed = true;
    }
    if (changed) tweaksChanged();
    let dropped = 0;
    for (const drop of tweakVerdicts.values()) if (drop) dropped++;
    return dropped;
  }
  function setTweakKnown({ apps = {}, held = [], worked = [] } = {}) {
    tweakKnown = { apps: apps ?? {}, held: new Set(held), worked: new Set(worked) };
    mentions = hintMatcher(tweakKnown.apps);
    for (const k of tweakKeys) for (const e of sources.get(k)?.byId.values() ?? []) e.row._guess = undefined;
    tweaksChanged();
  }
  // F382: the newest version of each id across the counted sources, unfiltered rows only (Newest Copy Only), and All
  // Sources' merge without filtered rows (an id whose newest copy is filtered out falls back to the next one).
  let listCacheOf = [null, -1], newestCopy = new Map(), listMerged = new Map();
  function listMerges() {
    const all = entries(ALL);
    if (listCacheOf[0] === all && listCacheOf[1] === filterGen) return;
    newestCopy = mergeMap();
    listMerged = mergeMap();
    for (const [k, { byId }] of sources) {
      if (!counts(k)) continue;
      for (const e of byId.values()) {
        const id = e.row.id;
        if (filteredOut(e.row) || systemTweak(e.row) || !listed(e.row)) continue;
        const v = newestCopy.get(id);
        if (v == null || compareVersions(v, e.stanza.version) < 0) newestCopy.set(id, e.stanza.version);
        if (!inAll(k)) continue;
        const cur = listMerged.get(id);
        if (!cur || compareVersions(cur.stanza.version, e.stanza.version) < 0) listMerged.set(id, e);
      }
    }
    listCacheOf = [all, filterGen];
  }
  const dupesOn = () => Boolean(filterStore) && filterOn(filterStore, ALL_SOURCES, "dupes");
  const olderCopy = (e) => compareVersions(newestCopy.get(e.row.id) ?? e.stanza.version, e.stanza.version) > 0;

  // F302: an injectable tweak goes into a signed app, so a phone without a jailbreak takes it.
  const judge = (e) => { e.row.compat = device && !(e.stanza.injectable && device.jailbreak === "none") ? compatCode(judged(e.stanza), device) : null; };

  // F302: `opts.tweaks`: a Tweak Source of the sideload build: only what core/tweaks.js injectableFromFields keeps,
  // iphoneos-arm64 and iphoneos-arm alike, each stanza marked `injectable`.
  function load(key, text, root, arch = DEFAULT_ARCH, opts = {}) {
    const byId = new IdMap();
    const tweaks = Boolean(opts?.tweaks);
    if (tweaks) tweakKeys.add(key); else tweakKeys.delete(key);
    for (const st of parseControl(text)) {
      if (tweaks) {
        if (!st.package || !isVisible(st) || !injectableFromFields(st).ok) continue;
        st.injectable = true;
      } else if (!st.package || !matchesArch(st, arch) || !isVisible(st)) continue;
      const cur = byId.get(st.package);
      st.debUrl = root ? resolveFilename(root, st.filename) : null;
      // One source can list several versions of a package: the newest is the candidate, as in apt. The others
      // stay in `older` for the Version History page (F29, history()).
      if (cur && compareVersions(cur.stanza.version, st.version) >= 0) { cur.older.push(st); continue; }
      st.iconUrl = resolveIcon(root, st.icon);
      byId.set(st.package, { stanza: st, row: makeRow(st, key), older: cur ? [cur.stanza, ...cur.older] : [] });
    }
    for (const e of byId.values()) judge(e);
    sources.set(key, { byId });
    merged = null;
    sorted.clear();
    shown.clear();
    fitting.clear();
    return byId.size;
  }

  // F9: an AltStore source's JSON (text or parsed). Its apps go in like packages; the rest (news, header, tint,
  // featured apps) is kept for its source page. F16a: `format` (the source record's: altstore, esign, scarlet,
  // gbox; none is AltStore) picks the reader (core/altstore.js parseSource), so each app's `extra` comes along.
  const altMeta = new Map(); // key -> parsed source without apps
  // F178: `hide`, bundle IDs left out of this source (core/appoffer.js hiddenAltApps: the lite iFizBox IPA in the
  // jailbreak app); the source's count and page leave them out too.
  function loadAlt(key, json, ios = null, format = null, hide = []) {
    const parsed = parseSource(format, json);
    const skip = new Set(Array.isArray(hide) ? hide : []);
    if (skip.size) {
      parsed.apps = parsed.apps.filter((a) => !skip.has(a.bundleIdentifier));
      const kept = new Set(parsed.apps.map((a) => a.id));
      parsed.featuredApps = (parsed.featuredApps ?? []).filter((id) => kept.has(id));
    }
    const byId = new Map();
    for (const app of parsed.apps) {
      const st = appStanza(app, { url: key.replace(/^alt:/, ""), name: parsed.name }, ios);
      // `app` keeps every versions[] entry (the stanza only those that run here) for Version History (F29).
      // B269: an entry that can't be signed and installed (no IPA download, a .deb, an App Store link, a web clip)
      // is marked; while not jailbroken it stays out of every list, Search, Browse and the source's own list.
      if (st) byId.set(st.package, { stanza: st, row: { ...makeRow(st, key), unsignable: !signableApp(st).ok }, app, ios });
    }
    for (const e of byId.values()) judge(e);
    const { apps, ...meta } = parsed;
    altMeta.set(key, meta);
    sources.set(key, { byId });
    merged = null;
    sorted.clear();
    shown.clear();
    fitting.clear();
    return byId.size;
  }

  function altSource(key) {
    const meta = altMeta.get(key);
    if (!meta) return null;
    const byId = sources.get(key)?.byId ?? new Map();
    const featured = meta.featuredApps.map((id) => byId.get(id)?.row).filter(Boolean).map(slim);
    return { ...meta, featured, count: [...byId.values()].filter((e) => listed(e.row)).length };
  }

  function remove(key) {
    tweakKeys.delete(key); // F302
    altMeta.delete(key);
    sources.delete(key);
    merged = null;
    sorted.clear();
    shown.clear();
    fitting.clear();
  }

  // F17: judge every row for `device` ({ ios, jailbreak }; null clears it). Returns how many rows can't work on it.
  function setDevice(next, { filter = true } = {}) {
    device = next ? normalizeDevice(next) : null;
    fitFilter = Boolean(device && filter);
    const apps = device?.jailbreak === "none";
    if (apps !== appsOnly) { appsOnly = apps; merged = null; sorted.clear(); }
    let no = 0;
    for (const { byId } of sources.values()) for (const e of byId.values()) { judge(e); if (isIncompatible(e.row.compat)) no++; }
    shown.clear();
    fitting.clear();
    return no;
  }

  // F160: what IPAs said about themselves; only the apps whose candidate is one of them are judged again.
  function setIpaInfo(map) {
    const urls = new Set();
    for (const [url, info] of Object.entries(map && typeof map === "object" ? map : {})) {
      if (info && typeof info === "object") { ipaInfo.set(url, info); urls.add(url); }
    }
    if (!urls.size) return ipaInfo.size;
    for (const { byId } of sources.values()) for (const e of byId.values()) if (urls.has(e.stanza.downloadURL)) judge(e);
    shown.clear();
    fitting.clear();
    return ipaInfo.size;
  }

  function setHidden(names) {
    hidden = new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === "string"));
    shown.clear();
    return hidden.size;
  }

  // F104: Hide by Author. Names compare lower-cased, as author() does.
  function setHiddenAuthors(names) {
    hiddenAuthors = new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === "string" && n.trim())
      .map((n) => n.trim().toLowerCase()));
    shown.clear();
    return hiddenAuthors.size;
  }
  const byHiddenAuthor = (r) => hiddenAuthors.size > 0 && (hiddenAuthors.has(r._a) || hiddenAuthors.has(r._m));
  // F226: Block. These ids drop out of every list, Search, Sections' counts, the author page and Changes;
  // package() still opens one, so its page can unblock it, and upgrades() still sees it (Changes files it as ignored).
  function setBlocked(ids) {
    blocked = new IdSet((Array.isArray(ids) ? ids : []).filter((n) => typeof n === "string" && n));
    shown.clear();
    return blocked.size;
  }
  const isBlocked = (r) => blocked.size > 0 && blocked.has(r.id);
  const isHidden = (r) => hidden.has(r.section) || byHiddenAuthor(r) || isBlocked(r);
  // B269: rows a list may show at all: while not jailbroken (the sideload build), no app entry that can't be signed.
  const listed = (r) => !(appsOnly && r.unsignable);

  // id -> entry for a source, or the merge of all of them: the newest version wins; on a tie, the first source
  // loaded keeps it (apt's default: equal pins, first listed).
  function entries(key) {
    if (key !== ALL) return (counts(key) && sources.get(key)?.byId) || new Map();
    if (merged) return merged;
    merged = mergeMap();
    for (const [k, { byId }] of sources) {
      if (!inAll(k)) continue;
      for (const e of byId.values()) {
        const id = e.row.id;
        const cur = merged.get(id);
        if (!cur || compareVersions(cur.stanza.version, e.stanza.version) < 0) merged.set(id, e);
      }
    }
    return merged;
  }

  // B341: the Tweak Sources' injectable tweaks merged like All Sources (newest version wins), for the sideload
  // build's App Tweaks section; empty elsewhere. Rebuilt with the All Sources merge (the sourceCounts trick).
  let tweakMerged = new Map(), tweakOf = null, tweakSorted = [], tweakGen = -1;
  function tweakEntries() {
    if (!appsOnly || !tweakKeys.size) return new Map();
    const all = entries(ALL);
    if (tweakOf === all && tweakGen === filterGen) return tweakMerged;
    tweakMerged = new IdMap();
    const kept = new IdMap(); // F382: the same merge over the rows the Source Filters keep, for the section's list
    for (const k of tweakKeys) {
      for (const [id, e] of sources.get(k)?.byId ?? []) {
        const cur = tweakMerged.get(id);
        if (!cur || compareVersions(cur.stanza.version, e.stanza.version) < 0) tweakMerged.set(id, e);
        if (filteredOut(e.row) || systemTweak(e.row)) continue;
        const was = kept.get(id);
        if (!was || compareVersions(was.stanza.version, e.stanza.version) < 0) kept.set(id, e);
      }
    }
    tweakSorted = [...kept.values()].map((e) => e.row).sort(compareNames);
    tweakOf = all;
    tweakGen = filterGen;
    return tweakMerged;
  }
  // What App Tweaks lists: those rows outside hidden sections, blocked ids and hidden authors (and misfits).
  function tweakRows() {
    if (!tweakEntries().size) return [];
    return tweakSorted.filter((r) => !misfit(r) && !isHidden(r));
  }
  // An entry of `key`, or (All Sources, sideload build) of the App Tweaks merge: a tweak opened from that section.
  const entryOf = (id, key) => entries(key).get(id) ?? (key === ALL ? tweakEntries().get(id) : undefined);

  function rowsOf(key) {
    let rows = sorted.get(key);
    if (!rows) {
      // F382: the Source Filters' rows left out; All Sources from the merge of what they keep, and a source's own
      // list without what another source has newer (Newest Copy Only).
      const from = filterStore ? (listMerges(), key === ALL ? listMerged : entries(key)) : entries(key);
      const dupes = key !== ALL && dupesOn();
      rows = [...from.values()].filter((e) => listed(e.row) && !filteredOut(e.row) && !systemTweak(e.row) && !(dupes && olderCopy(e)))
        .map((e) => e.row).sort(compareNames);
      sorted.set(key, rows);
    }
    return rows;
  }

  // rowsOf without what can't work on the device (F17), when that filter is on.
  function fitOf(key) {
    if (!device) return rowsOf(key);
    let rows = fitting.get(key);
    if (!rows) {
      rows = rowsOf(key).filter((r) => !misfit(r));
      fitting.set(key, rows);
    }
    return rows;
  }

  // fitOf without the hidden sections: what every list, Search and Changes draw from.
  function visibleOf(key) {
    if (!hidden.size && !hiddenAuthors.size && !blocked.size) return fitOf(key);
    let rows = shown.get(key);
    if (!rows) {
      rows = fitOf(key).filter((r) => !isHidden(r));
      shown.set(key, rows);
    }
    return rows;
  }

  // `total` counts visible packages only. With { hidden: true } (Section Visibility's edit mode) hidden sections
  // are listed too, each marked; without it they are left out.
  function sections(key = ALL, { hidden: withHidden = false } = {}) {
    const counts = new Map();
    for (const r of fitOf(key)) if (!byHiddenAuthor(r) && !isBlocked(r)) counts.set(r.section, (counts.get(r.section) ?? 0) + 1);
    const list = [...counts].filter(([name]) => withHidden || !hidden.has(name))
      .map(([name, count]) => (withHidden ? { name, count, hidden: hidden.has(name) } : { name, count }))
      .sort((a, b) => collator.compare(a.name, b.name));
    // B341: the sideload build's App Tweaks, under All Sources (each Tweak Source keeps its own sections).
    const tweaks = key === ALL ? tweakRows().length : 0;
    if (tweaks && (withHidden || !hidden.has(APP_TWEAKS))) {
      list.push(withHidden ? { name: APP_TWEAKS, count: tweaks, hidden: hidden.has(APP_TWEAKS) } : { name: APP_TWEAKS, count: tweaks });
      list.sort((a, b) => collator.compare(a.name, b.name));
    }
    return { total: visibleOf(key).length, sections: list };
  }

  function list(key = ALL, section = ALL) {
    if (key === ALL && section === APP_TWEAKS && appsOnly) return hidden.has(APP_TWEAKS) ? [] : tweakRows().map(slim);
    const rows = visibleOf(key);
    return (section === ALL ? rows : rows.filter((r) => r.section === section)).map(slim);
  }

  // F101: id -> how many (counted) sources list it, rankPopular's measure; rebuilt when the merge is.
  let spread = null, spreadOf = null;
  function sourceCounts() {
    const all = entries(ALL);
    if (spreadOf === all) return spread;
    spread = mergeMap();
    for (const [k, { byId }] of sources) {
      if (!counts(k)) continue;
      for (const { row } of byId.values()) spread.set(row.id, (spread.get(row.id) ?? 0) + 1);
    }
    spreadOf = all;
    return spread;
  }

  // B364: the sideload build's unfiltered Search pool: All Sources' apps and the App Tweaks merge, by name (an id in
  // both keeps the app's row). Cached on the two lists it is made of.
  let poolOf = [null, null], pool = [];
  function appsAndTweaks() {
    tweakEntries();
    const apps = rowsOf(ALL);
    if (poolOf[0] === apps && poolOf[1] === tweakSorted) return pool;
    const ids = new Set(apps.map((r) => r.id));
    pool = tweakSorted.length ? [...apps, ...tweakSorted.filter((r) => !ids.has(r.id))].sort(compareNames) : apps;
    poolOf = [apps, tweakSorted];
    return pool;
  }

  // Every word must appear somewhere (name, id, description, author or maintainer). Ranked: exact name or id,
  // then name or id starting with the query, then the query starting a word in the name or id (F101), then the
  // query inside the name or id, then author or maintainer, then the rest. Within a tier (Sileo): the name
  // closest in length to the query, then the most sources listing it, then by name. Any non-blank query
  // searches (searchable()).
  // Search's filters (F35, all optional): `section` a section name or a SECTION_GROUPS group ("group:Tweaks"),
  // `source` a source key, `installed` "installed" | "not", `price` "free" | "paid". With the Works on My Phone
  // filter on, what can't work drops out, except an exact name or id match: that one stays, marked `exact`, with
  // `why` ("Needs iOS 15 or earlier") for the row's subtitle.
  function search(query, { limit = 2000, section = null, source = null, installed = null, price = null } = {}) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!searchable(q)) return [];
    const words = q.split(/\s+/);
    const key = source && sources.has(source) ? source : ALL;
    if (source && key === ALL) return []; // a source that isn't loaded has nothing
    // B341: in the sideload build, App Tweaks (or All Tweaks) searches the Tweak Sources' app tweaks instead.
    const appTweaks = appsOnly && key === ALL && (section === APP_TWEAKS || section === "group:Tweaks");
    if (appTweaks && hidden.has(APP_TWEAKS)) return [];
    const inSection = appTweaks ? null : sectionTest(section);
    // B364: and an unfiltered one (no section) takes them in beside the apps, or a tweak whose source was added
    // dropped out of Search altogether (Other Sources leaves out what added sources list).
    const withTweaks = appsOnly && key === ALL && !inSection && !appTweaks && !hidden.has(APP_TWEAKS);
    const hits = [];
    const listed = sourceCounts();
    for (const r of appTweaks ? (tweakEntries(), tweakSorted) : withTweaks ? appsAndTweaks() : rowsOf(key)) {
      if (isHidden(r)) continue;
      if (!words.every((w) => r._hay.includes(w))) continue;
      if (inSection && !inSection(r)) continue;
      if (installed === "installed" && !statusById.has(r.id)) continue;
      if (installed === "not" && statusById.has(r.id)) continue;
      if (price === "paid" && !r.paid) continue;
      if (price === "free" && r.paid) continue;
      let rank = 5;
      if (r._n === q || r._id === q) rank = 0;
      else if (r._n.startsWith(q) || r._id.startsWith(q)) rank = 1;
      else if (r._n.includes(q) || r._id.includes(q)) rank = wordStart(r._n, q) || wordStart(r._id, q) ? 2 : 3;
      else if (r._a.includes(q) || r._m.includes(q)) rank = 4;
      if (rank !== 0 && misfit(r)) continue;
      // One number sorts by tier, then length gap, then sources (most first); rows come in name order (rowsOf)
      // and the sort is stable, so name breaks the last tie without the collator. Twice R12's ~4 ms otherwise.
      const gap = Math.min(Math.abs(r._n.length - q.length), 9999);
      hits.push([rank * 1e8 + gap * 1e4 + (9999 - Math.min(listed.get(r.id) ?? 0, 9999)), rank, r]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    return hits.slice(0, limit).map(([, rank, r]) => {
      const out = slim(r);
      if (rank === 0 && isIncompatible(r.compat)) {
        out.exact = true;
        out.why = needText(compat(judged(entryOf(r.id, key).stanza), device));
      }
      return out;
    });
  }

  // F104: a hidden author's own page still lists their packages (hidden sections and blocked ids stay out).
  // B363: names compare lower-cased with spaces left out ("Big Boss" is "BigBoss"). What can't work on the device stays in, marked
  // `misfit` with `why` for the row's subtitle (BigBoss's packages are mostly rootful: the page was empty on a
  // rootless phone). The sideload build looks in the Tweak Sources too (appsAndTweaks), not only All Sources' apps.
  function author(name) {
    const same = (s) => s.replace(/\s+/g, "");
    const n = same(String(name ?? "").trim().toLowerCase());
    if (!n) return [];
    const pool = appsOnly ? appsAndTweaks() : rowsOf(ALL);
    return pool.filter((r) => !hidden.has(r.section) && !isBlocked(r) && (same(r._a) === n || same(r._m) === n)).map((r) => {
      const out = slim(r);
      if (misfit(r)) {
        out.misfit = true;
        const e = entryOf(r.id, ALL);
        if (e) out.why = needText(compat(judged(e.stanza), device));
      }
      return out;
    });
  }

  function pkg(id, key = ALL) {
    const e = entryOf(id, key);
    if (!e) return installedOnly(id);
    const others = [];
    for (const [k, { byId }] of sources) {
      if (!counts(k)) continue;
      const o = byId.get(id);
      if (o) others.push({ key: k, version: o.stanza.version });
    }
    return { stanza: e.stanza, key: e.row.key, row: slim(e.row), others };
  }

  // B391: what a source's featured banners may show (screens/extras.js): a hidden tweak's banner stays away too.
  function shows(id, key) {
    return tweakKeys.has(key) ? visibleOf(key).some((r) => sameId(r.id, id)) : Boolean(pkg(id, key));
  }

  // Version History (F29): every version of `id` on offer. APT: each version any source carries (the candidate
  // and the older ones a Packages file also lists), merged by version (aptVersionList); AltStore: every versions[]
  // entry of the app in the source of the page (altVersionList). Null when the package isn't in the catalog.
  function history(id, key = ALL) {
    const e = entryOf(id, key);
    if (!e) {
      const st = statusById.get(id);
      return st ? { kind: "apt", id, name: st.name || id, versions: aptVersionList([], { installed: st.version }) } : null;
    }
    if (e.app) return { kind: "ipa", id, name: e.row.name, key: e.row.key, sourceUrl: e.stanza.ipa?.sourceUrl ?? null,
      versions: altVersionList(e.app, e.ios) };
    const offers = [];
    for (const [k, { byId }] of sources) {
      if (!counts(k) || isAltKey(k)) continue;
      const o = byId.get(id);
      if (o) for (const st of [o.stanza, ...(o.older ?? [])]) offers.push({ key: k, stanza: st });
    }
    return { kind: "apt", id, name: e.row.name, versions: aptVersionList(offers, { candidate: e.stanza.version, installed: statusById.get(id)?.version }) };
  }

  // ---- Browse (F46): over what every list shows (hidden sections and, with the filter on, misfits left out) ----
  function categories() {
    return mergeCategories(visibleOf(ALL), { jailbroken: !appsOnly });
  }

  function browse(category) {
    if (appsOnly && JAILBREAK_CATEGORIES.has(category)) return [];
    return visibleOf(ALL).filter((r) => browseCategory(r) === category).map(slim);
  }

  function popular({ limit = 50 } = {}) {
    const lists = [...sources].filter(([k]) => counts(k)).map(([, { byId }]) => byId);
    const all = entries(ALL);
    const items = visibleOf(ALL).map((row) => ({
      row, sources: lists.reduce((n, byId) => n + (byId.has(row.id) ? 1 : 0), 0),
      date: all.get(row.id)?.stanza.ipa?.versions?.[0]?.date ?? null,
    }));
    return rankPopular(items, limit).map(({ row, sources: n }) => ({ ...slim(row), sources: n }));
  }

  // F124, Browse's Free Apps / Tweaks / Themes: the free rows of that kind (freeKind), by name. Tweaks and Themes
  // are empty while Not Jailbroken.
  function free(kind) {
    if (appsOnly && kind !== "apps") return [];
    return visibleOf(ALL).filter((r) => !r.paid && freeKind(r) === kind).map(slim);
  }

  // F124, Browse's Featured: `refs` ([{ key, id }], the sources' banners and AltStore featured apps, in order) ->
  // their rows, the source's own version (else All Sources'), each package once, hidden and unfit ones left out.
  function featured(refs = []) {
    const seen = new Set();
    const out = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
      const id = ref?.id;
      if (typeof id !== "string" || seen.has(id)) continue;
      const e = (ref.key !== ALL && counts(ref.key) && sources.get(ref.key)?.byId.get(id)) || entries(ALL).get(id);
      if (!e || isHidden(e.row) || !listed(e.row) || misfit(e.row) || filteredOut(e.row) || systemTweak(e.row)) continue;
      seen.add(id);
      out.push(slim(e.row));
    }
    return out;
  }

  // F154, Browse's Collections (COLLECTIONS) and Tweak Roulette's pool (roulettePool), over what every list shows.
  function collectionRows(id) {
    const c = collection(id);
    if (!c || (appsOnly && c.jailbreak)) return [];
    return visibleOf(ALL).filter((r) => c.test(r)).map(slim);
  }
  function roulette({ per } = {}) {
    return roulettePool(visibleOf(ALL), { jailbroken: !appsOnly, per }).map((t) => ({ ...t, rows: t.rows.map(slim) }));
  }

  // Which of `names` the catalog has (for linking Depends on the package page): on a source, or installed (its
  // page then comes from the status stanza).
  const has = (names) => names.filter((n) => entries(ALL).has(n) || statusById.has(n));

  // F18: what stops `id` installing, in plain words (core/deps.js explain), resolved against every APT source's
  // packages (older versions too) and dpkg's status. The index is rebuilt when a source or the status file changes.
  let depCache = null; // { all, status, index }
  function deps(id, key = ALL) {
    const e = entryOf(id, key);
    const st = e?.stanza ?? statusById.get(id);
    if (!st || st.kind === "ipa") return null;
    return explain(st, { device, index: currentDepIndex() });
  }

  function currentDepIndex() {
    const all = entries(ALL);
    if (!depCache || depCache.all !== all || depCache.status !== statusById) {
      const available = [];
      for (const [k, { byId }] of sources) {
        if (!counts(k) || isAltKey(k)) continue;
        for (const o of byId.values()) for (const s of [o.stanza, ...(o.older ?? [])]) available.push({ stanza: s, key: k });
      }
      depCache = { all, status: statusById, index: depIndex({ available, installed: [...statusById.values()] }) };
    }
    return depCache.index;
  }

  // N4's Confirm sheet: apt's refusal (apt-get -s output) in F18's plain words, against the same index.
  const aptProblems = (output) => explainApt(output, { device, index: currentDepIndex() });

  // N4: for the queue's package ids, { id: { name, restart } }: the name to show, and whether any version of it
  // (installed, or any a source offers) depends on mobilesubstrate, so the console ends with Restart SpringBoard.
  function queueInfo(ids = []) {
    const all = entries(ALL);
    const out = {};
    for (const id of ids) {
      const e = all.get(id);
      const st = statusById.get(id);
      const stanzas = [st, e?.stanza, ...(e?.older ?? [])];
      for (const [k, { byId }] of sources) {
        if (isAltKey(k)) continue;
        const o = byId.get(id);
        if (o && o !== e) stanzas.push(o.stanza, ...(o.older ?? []));
      }
      const kind = packageKind(stanzas); // F151: what the console's finish button does for it
      out[id] = { name: e?.row.name ?? (st ? installedPkgs?.find((r) => r.id === st.package)?.name : null) ?? null, restart: needsRestart(stanzas), kind };
    }
    return out;
  }

  // F234: what the queue run needs for each package apt's plan changes: the stanza of that version (its download
  // link, hashes, size and dependencies) from any source, and dpkg's version of every name those depend on.
  function runInfo(items = []) {
    const all = entries(ALL);
    const out = { installed: {} };
    const names = new Set();
    for (const { id, version = null } of items) {
      const e = all.get(id);
      let st = null;
      for (const [k, { byId }] of sources) {
        if (isAltKey(k)) continue;
        const o = byId.get(id);
        if (!o) continue;
        st = [o.stanza, ...(o.older ?? [])].find((s) => !version || s.version === version) ?? null;
        if (st?.debUrl) break;
      }
      if (!st) { out[id] = { name: e?.row.name ?? null }; continue; }
      const { sha256, md5sum } = stanzaHashes(st);
      out[id] = { name: e?.row.name ?? st.name ?? null, debUrl: st.debUrl ?? null, sha256, md5sum,
        size: Number(st.size) > 0 ? Number(st.size) : null, depends: st.depends ?? null, preDepends: st.preDepends ?? st["pre-depends"] ?? null };
      for (const g of [...parseRelations(out[id].depends), ...parseRelations(out[id].preDepends)]) for (const r of g) names.add(r.name);
    }
    for (const n of names) { const v = statusById.get(n)?.version; if (v) out.installed[n] = v; }
    return out;
  }

  // Every (source, id, candidate version) loaded: what the Changes tab files on a refresh (core/changes.js).
  // F51: AltStore apps add every runnable versions[] entry with its date, [key, id, version, date], so the tab
  // files them under the day they came out (and an app with an older version shows as Updated).
  function versions() {
    const out = [];
    for (const [k, { byId }] of sources) {
      for (const e of byId.values()) {
        const id = e.row.id;
        const vs = e.stanza.ipa?.versions;
        if (!Array.isArray(vs) || !vs.length) { out.push([k, id, e.stanza.version ?? ""]); continue; }
        for (const v of vs) out.push([k, id, v.version ?? "", v.date ?? null]);
      }
    }
    return out;
  }

  // ---- installed packages (F7): dpkg's status file, matched against every source's candidate ----
  let installedPkgs = null; // parseStatus rows, or null before a status file came
  let statusById = new IdMap(); // id -> status stanza, for the package page of packages no source carries (F27)

  function setInstalled(text) {
    if (text == null) {
      installedPkgs = null;
      statusById = new IdMap();
      return -1;
    }
    const stanzas = installedStanzas(text);
    statusById = new IdMap(stanzas.map((st) => [st.package, st]));
    installedPkgs = parseStatus(text, stanzas);
    return installedPkgs.length;
  }

  // The package page's answer for an installed package no source carries: the status stanza itself (name,
  // version, description, Author, Depends...), with no source, no other versions and nothing to download.
  function installedOnly(id) {
    const st = statusById.get(id);
    if (!st) return null;
    const p = installedPkgs.find((r) => r.id === st.package);
    const row = { id: p.id, name: p.name, short: p.short, version: p.version, section: p.section, icon: null, key: null, author: p.author,
      compat: device ? compatCode(st, device) : null };
    return { stanza: st, key: null, row, others: [], installedOnly: true };
  }

  // The installed list as rows: the status file's own fields (name, version, description), with the source's
  // icon, key and spelling of the id (B407: Oreo, dpkg's is oreo) where a source carries the package, so the row's
  // icon and package page work.
  function installed() {
    if (!installedPkgs) return null;
    const all = entries(ALL);
    return installedPkgs.map((p) => {
      const e = all.get(p.id);
      return { id: e?.row.id ?? p.id, name: p.name, short: p.short, version: p.version, section: p.section,
        icon: e?.row.icon ?? null, key: e?.row.key ?? null, author: p.author, installed: p.version, held: p.held, tier: p.tier, // F127
        purpose: e?.row.purpose ?? (statusById.has(p.id) ? purposeOf(statusById.get(p.id)) : null),
        size: installedBytes(statusById.get(p.id)),
        compat: e ? e.row.compat : (device && statusById.has(p.id) ? compatCode(statusById.get(p.id), device) : null) };
    });
  }

  // Every source counts (not just visible sections): an upgrade in a hidden section is still an upgrade.
  function upgrades(holds = [], opts = {}) {
    if (!installedPkgs) return { available: [], ignored: [] };
    const all = entries(ALL);
    return findUpgrades(installedPkgs, (id) => { const e = all.get(id); return e ? slim(e.row) : null; }, holds, opts);
  }

  return { load, loadAlt, altSource, remove, setHidden, setHiddenAuthors, setBlocked, sections, list, search, author, package: pkg, history, has, versions, keys: () => [...sources.keys()],
    categories, browse, popular, free, featured, collection: collectionRows, roulette,
    setInstalled, installed, upgrades, setDevice, setIpaInfo, setFilters, setTweakVerdicts, setTweakKnown, shows,
    deps, aptProblems, queueInfo, runInfo };
}

// F104: a status stanza's Installed-Size (dpkg writes KiB) in bytes, or null.
export function installedBytes(st) {
  const n = Number(String(st?.["installed-size"] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1024) : null;
}

// Runs a catalog operation by name: the worker's entry point. Unknown ops throw.
export function runCatalog(catalog, op, args = []) {
  const f = { load: catalog.load, loadAlt: catalog.loadAlt, altSource: catalog.altSource, remove: catalog.remove, sections: catalog.sections, list: catalog.list,
    search: catalog.search, author: catalog.author, package: catalog.package, history: catalog.history, has: catalog.has, keys: catalog.keys,
    versions: catalog.versions, setHidden: catalog.setHidden, setHiddenAuthors: catalog.setHiddenAuthors, setBlocked: catalog.setBlocked, setInstalled: catalog.setInstalled,
    installed: catalog.installed, upgrades: catalog.upgrades, setDevice: catalog.setDevice, setIpaInfo: catalog.setIpaInfo, setFilters: catalog.setFilters,
    setTweakVerdicts: catalog.setTweakVerdicts, setTweakKnown: catalog.setTweakKnown, shows: catalog.shows,
    categories: catalog.categories, browse: catalog.browse, popular: catalog.popular, free: catalog.free, featured: catalog.featured,
    collection: catalog.collection, roulette: catalog.roulette,
    deps: catalog.deps, aptProblems: catalog.aptProblems, queueInfo: catalog.queueInfo, runInfo: catalog.runInfo }[op];
  if (!f) throw new Error(`unknown catalog op ${op}`);
  return f(...args);
}
