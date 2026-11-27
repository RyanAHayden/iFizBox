// Recommended (F45, Sources > Manage > Recommended): the curated sources, one tap to add. F52 dropped the games: this
// page lists sources; a recommended game is a package and belongs on Home's Browse/Featured. This is the
// one place the list lives: add, drop or reword an entry here and nothing else changes.
//
//   source: { kind: "source", url, name, why, jailbreak?, for?, identifier? }   jailbreak: an APT repo (hidden on Not
//                                                                 Jailbroken); for: the jailbreaks it suits (F19)
//   identifier   B273: an AltStore source's own `identifier`, read from its JSON (2026-11-21), so the row shows Added
//                when the list has that source under another URL; none where the JSON has none (Manic EMU)
//   tag: "dev" | "modded"   F327: every AltStore source says which More Sources group it goes in: From the Developer
//                           (the app's own makers, or a team's pick of open-source apps) or Modded Apps (a store app
//                           with a tweak built in, from that mod's own maintainer). Never a source of cracked or
//                           decrypted paid apps.
//
// F142: the list is what today's package managers and sideloaders ship, read from their source (CHECKED is when):
//   APT (the jailbreak build, above its AltStore sources)  Sileo's first-run repos (Sileo RepoManager.swift: Havoc, Chariz); Zebra's own repo
//       (ZBBaseSource zebraSource) and its "utility" sources for palera1n and Dopamine (ElleKit, palera1n; its
//       community list, api.getzbra.com/sources.json, is gone: 404); Dopamine's default.sources (Chariz, Havoc,
//       ElleKit). Procursus and BigBoss are dist repos, which Recommended can't add, and every rootless jailbreak's
//       bootstrap adds Procursus already.
//   AltStore (the sideload IPA and the website): AltStore's and SideStore's own built-in sources, Feather's own, and
//       every source both Feather's recommended list (Feather SourcesAddView.swift) and SideStore's defaults
//       (sidestore.io/default-sources) carry. AltStore's recommended collections (cdn.altstore.io
//       recommended-sources.json) are EU marketplace (PAL) sources, which a sideloaded app can't install from.
//   FIZL0's own source stays, as the user asked. Every `why` says what the source actually carries, read from its
//   Packages or source.json on CHECKED with tools/recommended_check.py (which re-checks them all).
import { NAME } from "../brand.js";
import { KEYS } from "./storagekeys.js";

export const CHECKED = "2026-11-18";

export const RECOMMENDED_SOURCES = [
  { kind: "source", name: "FIZL0", tag: "dev", url: "https://fizl0.github.io/apps/source.json", own: true, identifier: "io.github.fizl0",
    why: `openMX, OpenTennis and Party Board in one source: the games ${NAME}'s default list is built around.` },
  // ---- APT repos: the jailbreak build ----
  { kind: "source", name: "Havoc", url: "https://havoc.app/", jailbreak: true, for: ["dopamine", "palera1n", "nathanlr"],
    why: "Havoc: over 500 paid and free tweaks, themes and apps, most with rootless builds, iOS 15 and later." },
  { kind: "source", name: "Chariz", url: "https://repo.chariz.com/", jailbreak: true, for: ["dopamine", "palera1n", "nathanlr"],
    why: "Chariz: about 190 paid and free tweaks and themes, plus libraries like Cephei; rootless for iOS 15 to 17." },
  { kind: "source", name: "ElleKit", url: "https://ellekit.space/", jailbreak: true, for: ["dopamine", "palera1n"],
    why: "ElleKit: the tweak injection library rootless jailbreaks load tweaks with, and its legacy arm64e support." },
  { kind: "source", name: "palera1n", url: "https://repo.palera.in/", jailbreak: true, for: ["palera1n"],
    why: "palera1n: its loader, PreferenceLoader and a few tweaks (Battery17, FakePass, Cocha) for palera1n phones." },
  { kind: "source", name: "Zebra", url: "https://getzbra.com/repo/", jailbreak: true, for: ["dopamine", "palera1n", "nathanlr"],
    why: "Zebra: only the Zebra package manager itself, from its own developers." },
  // ---- AltStore sources: the sideload IPA and the website ----
  { kind: "source", name: "AltStore", tag: "dev", url: "https://apps.altstore.io/", identifier: "com.rileytestut.AltStore",
    why: "AltStore: AltStore, the Delta game emulator and the Clip clipboard manager, each with a beta, iOS 16+." },
  { kind: "source", name: "SideStore", tag: "dev", url: "https://sidestore.io/apps-v2.json/", identifier: "com.SideStore.SideStore",
    why: "SideStore: the SideStore app, an AltStore that refreshes its apps on the phone without a computer." },
  { kind: "source", name: "Feather", tag: "dev", url: "https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json", identifier: "kh.crysalis.feather-repo",
    why: "Feather: the Feather on-device IPA signer and installer." },
  { kind: "source", name: "SideStore Team Picks", tag: "dev", url: "https://community-apps.sidestore.io/sidecommunity.json", identifier: "com.sidestoreapps.community",
    why: "Over 20 apps SideStore's team picked: RetroArch, PPSSPP, Play!, MAME4iOS, ScummVM, iSH, iTorrent and more." },
  { kind: "source", name: "StikDebug", tag: "dev", url: "https://stikdebug.xyz/index.json", identifier: "com.stik.stikdebug",
    why: "StikDebug and StikPair: turn on JIT for emulators on the phone, no computer needed." },
  { kind: "source", name: "LiveContainer", tag: "dev", url: "https://github.com/LiveContainer/LiveContainer/releases/download/1.0/apps.json", identifier: "com.livecontainer.source",
    why: "LiveContainer: runs other IPAs inside one app, past the free account's three-app limit." },
  { kind: "source", name: "Provenance", tag: "dev", url: "https://provenance-emu.com/apps.json", identifier: "com.provenance-emu.provenance.altstore",
    why: "Provenance and its alpha builds, plus iCube (GameCube and Wii) and iFly (Dreamcast): retro emulators." },
  { kind: "source", name: "Manic EMU", tag: "dev", url: "https://apps.manicemu.site/altstore",
    why: "Manic EMU: an all-in-one emulator, from NES and Game Boy to 3DS, GameCube and Wii, iOS 15+." },
  { kind: "source", name: "DolphiniOS", tag: "dev", url: "https://altstore.oatmealdome.me/", identifier: "me.oatmealdome.altstore",
    why: "DolphiniOS and its public beta: the Dolphin GameCube and Wii emulator for iPhone." },
  { kind: "source", name: "Flycast", tag: "dev", url: "https://github.com/chachillie/Flycast-iOS/raw/refs/heads/main/flycast-ios.json", identifier: "com.chachirie.source",
    why: "Flycast: the Sega Dreamcast, Naomi and Atomiswave emulator." },
  { kind: "source", name: "UTM", tag: "dev", url: "https://alt.getutm.app", identifier: "com.utmapp.repos.UTM",
    why: "UTM and UTM SE: virtual machines on the iPhone, for Windows, Linux and classic Mac OS." },
  { kind: "source", name: "Amethyst", tag: "dev", url: "https://alt.crystall1ne.dev", identifier: "dev.crystall1ne.alt",
    why: "Angel Aura Amethyst and PojavLauncher: launchers that run Minecraft: Java Edition." },
  // Asked for by the user (2026-11-18): tweaked-app sources, each from the app's own maintainer or its README.
  { kind: "source", name: "YouMod", tag: "modded", url: "https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/apps.json", identifier: "com.MountainofPenguin.org",
    why: "YouMod: YouTube with ad blocking, background play, Return YouTube Dislike and YTUHD built in." },
  { kind: "source", name: "Unbound", tag: "modded", url: "https://repo.unbound.rip/app-repo.json", identifier: "app.unbound.ios.repo",
    why: "Unbound: a Discord client mod with plugins and themes, plus its TestFlight builds." },
  { kind: "source", name: "RyukGram", tag: "modded", url: "https://source.ryuksign.com/", identifier: "com.ryuksign.source",
    why: "RyukGram: Instagram with downloads, a built-in gallery and privacy options, with no-plugin builds too." },
  { kind: "source", name: "PokeMMO", tag: "dev", url: "https://pokemmo.com/altstore", identifier: "eu.pokemmo.altstore",
    why: "PokeMMO: a free-to-play online multiplayer monster-catching RPG." },
];

// ---- F19: recommended for the jailbreak ------------------------------------------------------------------------
// An APT entry's `for` names the jailbreaks it suits. Where each list comes from (read 2026-11-17):
//   dopamine  Dopamine's own default.sources (opa334/Dopamine DOBootstrapper.m): Chariz, Havoc, BigBoss, ElleKit.
//             BigBoss is a dist repo (stable/main), which Recommended can't add yet, so it is left out here.
//   palera1n  palera1n's loader config (palera.in/loader.json, "repositories"): repo.palera.in and ElleKit; Havoc
//             and Chariz for tweaks, since its bootstrap adds no store.
//   nathanlr  a semi-jailbreak (verygenericname/nathanlr) whose app writes no apt sources: the rootless stores.
// `other` (no jailbreak picked or found) gets every APT entry, as before F19.

export const JAILBREAKS = [
  { id: "dopamine", name: "Dopamine" },
  { id: "palera1n", name: "palera1n" },
  { id: "nathanlr", name: "nathanlr" },
  { id: "other", name: "Other" },
];

export const jailbreakName = (id) => JAILBREAKS.find((j) => j.id === id)?.name ?? "Other";

// Which jailbreak set up apt, from its source files ([{ path, text }], backend-native aptSourceFiles): palera1n's
// loader writes sources.list.d/palera1n.sources, Dopamine writes sources.list.d/default.sources holding its four
// repos. null when neither is there (nathanlr, an older jailbreak, the site).
export function detectJailbreak(files) {
  const list = Array.isArray(files) ? files : [];
  const name = (f) => String(f?.path ?? "").split("/").pop();
  if (list.some((f) => name(f) === "palera1n.sources")) return "palera1n";
  const dopamine = ["repo.chariz.com", "havoc.app", "ellekit.space"];
  if (list.some((f) => name(f) === "default.sources" && dopamine.every((h) => String(f?.text ?? "").includes(h)))) return "dopamine";
  return null;
}

// F56: the jailbreak from the marker files under the jbroot (Bridge.swift app.info `markers`, names relative to the
// jbroot). A sure answer where detectJailbreak guesses from apt files: nathanlr first, since it also writes
// .installed_dopamine; palera1n by its loader's dotfile, bootstrap or sources file; NekoJB and xia0o0o0o's jailbreak
// (which write .installed_dopamine too, so Dopamine's own app skips them) are "other"; then Dopamine. null when
// none is there (an older shell without `markers`, a rootful jailbreak, the site).
export function jailbreakFromMarkers(markers) {
  const has = new Set((Array.isArray(markers) ? markers : []).map((m) => String(m ?? "").replace(/^\/+/, "")));
  if (has.has(".installed_nathanlr")) return "nathanlr";
  if ([".installed_palera1n", ".palecursus_strapped", "etc/apt/sources.list.d/palera1n.sources"].some((m) => has.has(m))) return "palera1n";
  if (has.has(".installed_nekojb") || has.has(".xia0o0o0o_jb_installed")) return "other";
  if (has.has(".installed_dopamine")) return "dopamine";
  return null;
}

// The entries for a jailbroken phone: the APT entries whose `for` names the jailbreak (every one for "other"/null),
// then every AltStore source, FIZL0's own first: the jailbreak app installs IPAs too (user 2026-11-18), so
// Recommended shows both, as two groups (manage.js). The sideload IPA and the website get the AltStore ones only
// (recommendedRows' jailbroken: false).
export function recommendedFor(recs, jailbreak) {
  const all = Array.isArray(recs) ? recs : [];
  const any = !jailbreak || jailbreak === "other";
  const apt = all.filter((r) => r.jailbreak && (any || !r.for || r.for.includes(jailbreak)));
  const alt = all.filter((r) => !r.jailbreak);
  return [...apt, ...alt.filter((r) => r.own), ...alt.filter((r) => !r.own)];
}

// The user's pick on Recommended (localStorage), else what was detected.
const JAILBREAK_KEY = KEYS.jailbreakName;
export function savedJailbreak(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(JAILBREAK_KEY);
    return JAILBREAKS.some((j) => j.id === v) ? v : null;
  } catch { return null; }
}
export function saveJailbreak(id, storage = globalThis.localStorage) {
  try { if (id) storage?.setItem(JAILBREAK_KEY, id); else storage?.removeItem(JAILBREAK_KEY); } catch { /* private mode */ }
}

// F19 first run: the Sources tab shows a "Recommended for <jailbreak>" row until Recommended has been opened once.
const FIRST_RUN_KEY = KEYS.recommendedSeen;
export function recommendedSeen(storage = globalThis.localStorage) {
  try { return storage?.getItem(FIRST_RUN_KEY) === "1"; } catch { return true; }
}
export function markRecommendedSeen(storage = globalThis.localStorage) {
  try { storage?.setItem(FIRST_RUN_KEY, "1"); } catch { /* private mode */ }
}

// Search's "Recommended Sources" group: apps in recommended sources not added yet whose name, subtitle or developer
// holds every word of the query. sources: [{ row, apps }] (manage.js recommendedApps). -> [{ row, app }]
export function matchRecommendedApps(sources, q, limit = 25) {
  const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const { row, apps } of sources ?? []) {
    for (const app of apps ?? []) {
      const hay = [app?.name, app?.subtitle, app?.developerName].filter(Boolean).join(" ").toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push({ row, app });
    }
  }
  return out.slice(0, limit);
}

// ---- F327: More Sources (screens/moresources.js) --------------------------------------------------------------
// The Recommended group's sub-groups, in order: Tweak Sources (APT repos, jailbroken only), From the Developer and
// Modded Apps (AltStore sources by `tag`).
export const REC_GROUPS = [
  { id: "tweaks", header: "Tweak Sources" },
  { id: "dev", header: "From the Developer" },
  { id: "modded", header: "Modded Apps" },
];
export const recGroupOf = (rec) => (rec?.jailbreak ? "tweaks" : rec?.tag === "modded" ? "modded" : "dev");

// rows: [{ rec, … }] (core/sourcelist.js recommendedRows) -> [{ id, header, rows }], empty groups left out, each
// group's rows in the order given.
export function recommendedGroups(rows) {
  return REC_GROUPS.map((g) => ({ ...g, rows: (rows ?? []).filter((r) => recGroupOf(r.rec) === g.id) }))
    .filter((g) => g.rows.length);
}

// A row's two-line reason without the name it starts with ("Havoc: over 500 …" -> "Over 500 …"): the name is the
// row's label already.
export function shortWhy(rec) {
  const why = String(rec?.why ?? "");
  const name = String(rec?.name ?? "");
  if (!name || !why.startsWith(`${name}: `)) return why;
  const rest = why.slice(name.length + 2);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
