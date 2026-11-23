// F302 / C32: which APT packages the sideload build offers as tweaks, from the Packages fields alone. core/catalog.js
// (a Tweak Source's packages) and backend-native.js (the Sources tab's count) need only this, at startup; the rest of
// core/tweaks.js (unpacking .debs, Mach-O editing, core/unpack.js) loads where tweaks are added. core/tweaks.js
// re-exports every name here, so callers and tests that import them from there keep working.
//
//   injectableFromFields(stanza) -> { ok, why }   the Packages fields alone (Architecture, Section, Tag, Depends):
//     iphoneos-arm64 or iphoneos-arm, no theme/app/daemon/CLI/jailbreak-utility section or purpose, and every Depends
//     group satisfiable by a hook library we provide or can drop (HOOK_DEPS: substrate/ElleKit -> the bundled
//     ElleKit, PreferenceLoader, firmware, cy+ feature names). Anything depending on another package is left out.
//   isLibraryStanza(stanza) -> bool                  B185: a library for other tweaks (Comet), by Section, purpose::library
//     or a Description that is about a library/framework; injectableFromFields then answers { library: true,
//     why: LIBRARY_WHY }
//   countInjectable(packagesText) -> n               the Sources tab's count for a Tweak Source
//   hintMatcher(known) -> (stanza) -> [bundle id]    B391: the apps a tweak's name or description mentions, as words
//     (the known ones below and the user's, { bundleId: name }); core/tweakindex.js paidHint is this for one stanza
//
// SPDX-License-Identifier: GPL-3.0-or-later
import { parseControl, parseRelations } from "./apt.js";

export const TWEAK_ARCHES = new Set(["iphoneos-arm64", "iphoneos-arm"]);
// Depends a sideloaded app can do without: the hooking library (we bundle ElleKit), PreferenceLoader (its settings
// pane can't show up outside Settings, the tweak still runs), and the firmware / cy+ feature pseudo-packages.
export const HOOK_DEPS = new Set(["mobilesubstrate", "cydia-substrate", "ellekit", "com.ex.substitute", "substitute",
  "libhooker", "org.coolstar.libhooker", "preferenceloader", "firmware"]);
const OK_DEP = (name) => HOOK_DEPS.has(name.toLowerCase()) || /^cy\+/.test(name) || /^firmware$/i.test(name);
const THEME_DEPS = new Set(["winterboard", "snowboard", "com.anemonetheming.anemone", "anemone", "com.saurik.winterboard"]);
// Sections that are never an injectable tweak (lower case, matched as a word inside the section name).
const BAD_SECTION = /\b(themes?|theming|wallpapers?|ringtones?|fonts?|applications?|apps|terminal|development|developer|system|repositories|repo|jailbreak|utilities|networking|packaging|data_storage|keyboards?|widgets?|addons?|carrier|soundboard|sounds?|icons?|skins?|ebooks?|games?)\b/;
const BAD_PURPOSE = new Set(["purpose::uikit", "purpose::console", "purpose::library", "purpose::daemon", "role::developer"]);

// B185: what the user reads for a package other tweaks build on (Comet, a SwiftUI preferences framework; colour picker
// and support libraries): no paths, no jargon.
export const LIBRARY_WHY = "This is a library for other tweaks, not something to add to an app.";
const LIBRARY_SECTION = /\b(librar(y|ies)|frameworks?)\b/;
// A description that is about a library or framework: "A SwiftUI Prefs Framework", "Color picker support library for
// tweaks", "library for Foxfort tweaks", "An API … for developers". Only a short noun phrase at the start counts, and
// never an app's own library ("moves the app library", "a photo library button").
// No lookbehind here: it is a SyntaxError before Safari 16.4 and hangs the app on Loading on iOS 15 (B193). Walk the
// words instead: at most 5 (6 when the first is an article) before "library"/"framework", and the word right before
// it must not be one of NOT_LIBRARY_BEFORE.
const LIBRARY_WORD = /^(?:librar(?:y|ies)|framework)\b/i;
const LIBRARY_ARTICLE = /^(?:a|an|the)\s+/i;
const LIBRARY_LEAD_WORD = /^[\w+.-]+\s+/;
const NOT_LIBRARY_BEFORE = /\b(?:app|apps|photos?|music|media|video|ipod|game|games|sticker|emoji|icon|widget|my)\s$/i;
function libraryDesc(desc) {
  let pos = desc.length - desc.replace(/^\s+/, "").length;
  const max = LIBRARY_ARTICLE.test(desc.slice(pos)) ? 6 : 5;
  for (let words = 0; ; words++) {
    const rest = desc.slice(pos);
    if (LIBRARY_WORD.test(rest) && !NOT_LIBRARY_BEFORE.test(desc.slice(0, pos))) return true;
    if (words === max) return false;
    const w = LIBRARY_LEAD_WORD.exec(rest);
    if (!w) return false;
    pos += w[0].length;
  }
}
const FOR_DEVELOPERS = /\bfor (?:tweak )?developers\b/i;
export function isLibraryStanza(st) {
  const section = String(st?.section ?? "").toLowerCase().replace(/[_-]+/g, " ");
  const tags = String(st?.tag ?? "").split(",").map((t) => t.trim().toLowerCase());
  const desc = String(st?.description ?? "").split("\n")[0];
  return LIBRARY_SECTION.test(section) || tags.includes("purpose::library") || libraryDesc(desc) || FOR_DEVELOPERS.test(desc);
}

export function injectableFromFields(st) {
  const no = (why) => ({ ok: false, why });
  if (!st || !st.package) return no("not a package");
  if (!TWEAK_ARCHES.has(String(st.architecture ?? "").trim())) return no("not for iPhone (Architecture)");
  if (isLibraryStanza(st)) return { ok: false, why: LIBRARY_WHY, library: true }; // B185
  const section = String(st.section ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (BAD_SECTION.test(section)) return no(`not a tweak (${st.section})`);
  const tags = String(st.tag ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (tags.some((t) => BAD_PURPOSE.has(t))) return no("not a tweak (purpose)");
  const rels = [...parseRelations(st["pre-depends"]), ...parseRelations(st.depends)];
  for (const group of rels) {
    if (group.some((r) => THEME_DEPS.has(r.name.toLowerCase()))) return no("a theme");
    if (!group.some((r) => OK_DEP(r.name))) return no(`needs ${group.map((r) => r.name).join(" or ")}`);
  }
  return { ok: true, why: null };
}

// Injectable tweaks in a Packages text (any arch the filter keeps), each package counted once.
export function countInjectable(text) {
  const ids = new Set();
  for (const st of parseControl(text)) if (injectableFromFields(st).ok) ids.add(st.package);
  return ids.size;
}

// App names as they appear in tweak names and descriptions ("for YouTube", "Instagram tweak").
const HINT_NAMES = {
  "com.google.ios.youtube": ["YouTube"], "com.google.ios.youtubemusic": ["YouTube Music", "YTMusic"],
  "com.burbn.instagram": ["Instagram"], "com.zhiliaoapp.musically": ["TikTok"], "com.spotify.client": ["Spotify"],
  "net.whatsapp.WhatsApp": ["WhatsApp"], "ph.telegra.Telegraph": ["Telegram"], "com.reddit.Reddit": ["Reddit"],
  "com.toyopagroup.picaboo": ["Snapchat"], "com.facebook.Facebook": ["Facebook"], "com.facebook.Messenger": ["Messenger"],
  "com.hammerandchisel.discord": ["Discord"], "com.netflix.Netflix": ["Netflix"], "tv.twitch": ["Twitch"],
  "com.soundcloud.TouchApp": ["SoundCloud"], "com.atebits.Tweetie2": ["Twitter"],
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function hintMatcher(known = {}) {
  const names = new Map(Object.entries(HINT_NAMES));
  for (const [id, n] of Object.entries(known ?? {})) if (n && String(n).length >= 4) names.set(id, [...(names.get(id) ?? []), String(n)]);
  const tests = [...names].map(([id, list]) => [id, new RegExp(`(^|[^A-Za-z0-9])(?:${list.map(esc).join("|")})($|[^A-Za-z0-9])`, "i")]);
  return (st) => {
    const text = `${st?.name ?? ""}\n${st?.description ?? ""}`;
    const out = tests.filter(([, re]) => re.test(text)).map(([id]) => id);
    // "YouTube Music" also says "YouTube": the longer name wins
    if (out.includes("com.google.ios.youtubemusic") && !/youtube(?! ?music)/i.test(text.replace(/youtube ?music/gi, ""))) {
      return out.filter((id) => id !== "com.google.ios.youtube");
    }
    return out;
  };
}
