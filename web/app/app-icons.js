// The share sheet's app tiles (screens/handoff.js) with each app's real icon instead of its initial (user 2026-11-18).
// Fetched at run time, never committed: an app's icon comes from its own AltStore-format source (the iconURL of its
// bundle there, so a new icon is picked up), or else its GitHub organisation's avatar, which is the app icon for
// these. Cydia keeps its letter: its logo is never used (AGENTS.md). Apps not listed keep their letter too.
//
//   appIcon(app)          // a cached data: URL (114 px PNG, the 57 pt tile at 2x), or null
//   loadAppIcons(apps)    // fetch and cache what's missing or older than a month; resolves when done
//
// Cached in localStorage (each icon ~10 KB): the sheet draws them at once, offline too.

import { getBackend } from "./backend.js";
import { KEY_PREFIXES } from "./core/storagekeys.js";

const gh = (org) => ({ url: `https://github.com/${org}.png?size=120` });
export const APP_ICONS = {
  AltStore: { source: "https://apps.altstore.io", bundle: "com.rileytestut.AltStore" },
  "AltStore Classic": { source: "https://apps.altstore.io", bundle: "com.rileytestut.AltStore" },
  SideStore: { source: "https://apps.sidestore.io", bundle: "com.SideStore.SideStore" },
  Feather: { source: "https://raw.githubusercontent.com/khcrysalis/Feather/main/app-repo.json", bundle: "thewonderofyou.Feather" },
  LiveContainer: gh("LiveContainer"),
  Sileo: gh("Sileo"),
  Zebra: gh("zbrateam"),
};

const KEY = KEY_PREFIXES.appIcon;
const MAX_AGE = 30 * 24 * 3600 * 1000;
const SIZE = 114;

function read(app) {
  try { return JSON.parse(localStorage.getItem(KEY + app) ?? "null"); } catch { return null; }
}

export function appIcon(app) {
  const hit = read(app);
  return typeof hit?.data === "string" && hit.data.startsWith("data:image/") ? hit.data : null;
}

// Where an app's icon is: its source's entry for the bundle (else the source's own icon), or the fixed URL.
export async function iconUrl(spec, text = (u) => getBackend().text(u)) {
  if (!spec) return null;
  if (spec.url) return spec.url;
  const json = JSON.parse(await text(spec.source));
  const app = (json.apps ?? []).find((a) => a.bundleIdentifier === spec.bundle);
  const url = app?.iconURL || json.iconURL;
  return /^https:\/\//.test(url ?? "") ? url : null;
}

// The image, drawn into a 114 px square PNG, so the cache is small and the page never shows a remote URL.
async function toDataUrl(url) {
  const blob = await (await getBackend().fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
  canvas.getContext("2d").drawImage(bitmap, 0, 0, SIZE, SIZE);
  return canvas.toDataURL("image/png");
}

const loading = new Map(); // app -> its load under way
export function loadAppIcons(apps) {
  return Promise.all([...new Set(apps)].filter((a) => APP_ICONS[a]).map((app) => {
    const hit = read(app);
    if (hit?.data && Date.now() - (hit.savedAt ?? 0) < MAX_AGE) return null;
    if (!loading.has(app)) {
      loading.set(app, iconUrl(APP_ICONS[app]).then((u) => u && toDataUrl(u)).then((data) => {
        if (data) { try { localStorage.setItem(KEY + app, JSON.stringify({ data, savedAt: Date.now() })); } catch { /* full: letter */ } }
      }).catch(() => {}).finally(() => loading.delete(app))); // offline or moved: the letter, tried again next time
    }
    return loading.get(app);
  }));
}
