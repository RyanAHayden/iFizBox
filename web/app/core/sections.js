// Section, author and name helpers shared by the catalog (core/catalog.js) and the installed list (core/installed.js).
// Pure JS, no imports, so installed.js reaches them without importing the catalog (no import cycle; catalog.js
// re-exports them for its other callers). Cydia's rules: docs/cydia.md "Sections and section icons".

export const NO_SECTION = "(No Section)";

// Cydia.app/Sections.plist: typo and alias fixes applied to `Section:` before it is shown (Cydia, GPLv3).
const SECTION_FIXES = {
  "Hunspell Dictionaries": "Dictionaries", "Utility": "Utilities", "Utilites": "Utilities", "Developer": "Development",
  "Site-Specific": "Site-Specific Apps", "Themes (Springboard)": "Themes (SpringBoard)",
  "Themes (SummerBoard)": "Themes (SpringBoard)", "Themes (Systen)": "Themes (System)",
  "Themes (Lockcreen)": "Themes (LockScreen)", "Themes (Lockscreens)": "Themes (LockScreen)",
  "Themes (Locksceen)": "Themes (LockScreen)", "Themes (Lockscree)": "Themes (LockScreen)",
  "Themes (Losckscreen)": "Themes (LockScreen)", "Themes (Video)": "Themes (Apps)",
  "Themes (Lockscreen)": "Themes (LockScreen)", "Themes (Widgets)": "Themes (Addons)", "Wallpapers": "Wallpaper",
  "Ringtone": "Ringtones", "Tweak": "Tweaks", "SBSettings Addons": "Addons (SBSettings)",
  "LockInfo Addons": "Addons (LockInfo)", "App Addons": "Addons", "App Addons (Iconoclasm)": "Addons (Iconoclasm)",
  "App Addons (OpenNotifier)": "Addons (OpenNotifier)", "BossPaper Addons": "Addons (BossPaper)",
  "Lockinfo Addons": "Addons (LockInfo)", "Dictionaries (Hunspell)": "Dictionaries",
  "Addons (Bootlogo)": "Addons (BootLogo)", "Addons (BootLogos)": "Addons (BootLogo)", "eBooks": "Books",
  "Themes (Localization)": "Localization", "Themes (APPS)": "Themes (Apps)", "Themes (Weather)": "Themes (Apps)",
  "Themes (Videos)": "Themes (Apps)", "Themes (SMS)": "Themes (Apps)", "Themes (iPad)": "Themes",
  "Themes (Dock)": "Themes (SpringBoard)", "Themes (Dialer)": "Themes (Apps)", "Themes (Battery)": "Themes (LockScreen)",
  "FontSwap": "Addons (FontSwap)", "Cydgets (Lock)": "Addons (Cydget)", "Themes (App Addons)": "Themes (Addons)",
};

// A package's section as Cydia shows it: `_` -> space, then Sections.plist. English Sections.strings maps every
// name to itself, so there is no localisation step yet. No Section -> "(No Section)".
export function sectionName(raw) {
  const s = String(raw ?? "").replace(/_/g, " ").trim();
  if (!s) return NO_SECTION;
  return SECTION_FIXES[s] ?? s;
}

// Cydia's Simplify(): "[X]" -> "X", "(X)" -> "X", "Name (Sub)" -> "Name". For icons and the "from" line.
export function simpleSection(name) {
  const s = String(name ?? "");
  const m = s.match(/^\[(.*)\]$/) || s.match(/^\((.*)\)$/);
  if (m) return m[1];
  return s.replace(/\s*\(.*\)\s*$/, "") || s;
}

// "Jay Freeman (saurik) <saurik@saurik.com>" -> { name: "Jay Freeman (saurik)", email: "saurik@saurik.com" }.
export function parseAuthor(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*<([^>]*)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  return { name: s, email: "" };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
export const compareNames = (a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id);

// F450: the stars given here (core/ratingsort.js re-exports these; here so the catalog adds no startup module).
// `ratings` { <package id>: [average, count] } -> { avg, count } | null (unrated, or not a rating).
export function ratingOf(ratings, id) {
  // hasOwnProperty, not Object.hasOwn: that needs iOS 15.4 and the app runs on 15.0
  const v = ratings && Object.prototype.hasOwnProperty.call(ratings, id) ? ratings[id] : null;
  const avg = Array.isArray(v) ? Number(v[0]) : NaN;
  return Number.isFinite(avg) && avg > 0 ? { avg, count: Number(v[1]) || 0 } : null;
}
// F457: a modded app keeps the original's bundle ID, so the App Store's stars count only for an app named as the App
// Store names it: the whole name or its first words ("Spotify Music" of "Spotify: Music and Podcasts"). "+" is part of
// a word, so "Instagram++" isn't "Instagram". Here, not core/applookup.js: the catalog imports this module already,
// and app.js's startup modules are capped.
const nameWords = (s) => String(s ?? "").normalize("NFC").toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{M}\p{N}+]+/u).filter(Boolean);
export function isStoreName(appName, trackName) {
  const app = nameWords(appName).join("");
  let lead = "";
  return app !== "" && nameWords(trackName).some((w) => (lead += w) === app);
}
// Rated before unrated, the highest average first, then the most ratings; 0 between two unrated or two equal.
export function compareRatings(x, y) {
  if (x && y) return y.avg - x.avg || y.count - x.count;
  return x ? -1 : y ? 1 : 0;
}

// Search's segmented control (F35): a few broad kinds over Cydia's sections. A section belongs to a group by its
// simple name (simpleSection): "Themes (SpringBoard)" is a Theme, "Tweaks" a Tweak.
export const SECTION_GROUPS = ["Tweaks", "Themes", "Apps", "Utilities"];

// B341: the sideload build's Sections and Search list the Tweak Sources' injectable app tweaks under this one
// section (core/catalog.js tweakRows); its packages keep their own Section: lines.
export const APP_TWEAKS = "App Tweaks";
const GROUP_NAMES = {
  Tweaks: ["tweaks", "tweak", "app tweaks"],
  Themes: ["themes", "theme", "wallpaper", "ringtones", "fonts"],
  Apps: ["applications", "apps", "app", "games"],
  Utilities: ["utilities", "system", "terminal support", "networking", "development", "administration", "scripting"],
};
export function sectionGroup(section) {
  const s = simpleSection(section).toLowerCase();
  for (const [g, names] of Object.entries(GROUP_NAMES)) if (names.includes(s)) return g;
  return null;
}
