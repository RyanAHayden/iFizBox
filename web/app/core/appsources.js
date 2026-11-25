// Find App Sources (B272, screens/moresources.js #/sources/more/apps): the AltStore sources to browse and add. It
// listed only Recommended's app sources not added yet, so once those were in (Recommended's Add All) the page was
// empty. Now it is a directory: Recommended's app sources, then more checked ones (below), added ones kept with
// ADDED, so the page is never empty while the list has entries.
//
//   APP_SOURCE_DIRECTORY        the checked sources Find App Sources shows beyond Recommended (Recommended's entry shape)
//   findAppSources(recs, opts)  -> Recommended's AltStore entries, then the directory's, a URL once, piracy-listed ones
//                                  (`blocked(url)`, core/warnings.js sourceWarning) left out
//
// The bar for a directory entry, as Recommended's: run by the app's own developer or the mod's own maintainer (named
// in its README or site), free, and never a source of cracked or decrypted paid apps, re-hosted mods of someone
// else's work, or "premium unlocked" builds; nothing on Canister's piracy list. Each was read live with
// tools/recommended_check.py on DIRECTORY_CHECKED (what it carries is its `why`); journal/2026-11-21-b272-find-more-
// sources/ lists the ones left out and why.

export const DIRECTORY_CHECKED = "2026-11-21";

export const APP_SOURCE_DIRECTORY = [
  { kind: "source", name: "iSH", tag: "dev", url: "https://ish.app/altstore.json",
    why: "iSH: a Linux shell on the iPhone (Alpine, with apk), from its own developers." },
  { kind: "source", name: "iTorrent", tag: "dev", url: "https://xitrix.github.io/iTorrent/AltStore.json",
    why: "iTorrent: an open-source torrent client, from its developer's own source." },
  { kind: "source", name: "Geode", tag: "dev", url: "https://ios-repo.geode-sdk.org/altsource/main.json",
    why: "Geode: the mod loader for Geometry Dash, from the Geode team." },
  { kind: "source", name: "uYouEnhanced", tag: "modded", url: "https://raw.githubusercontent.com/arichornlover/arichornlover.github.io/main/apps.json",
    why: "uYouEnhanced: YouTube with uYou's downloads, background play and ad blocking, from its maintainer." },
];

const urlKey = (u) => String(u ?? "").trim().toLowerCase().replace(/\/+$/, "");

export function findAppSources(recs, { blocked = () => false, directory = APP_SOURCE_DIRECTORY } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of [...(recs ?? []).filter((x) => x?.kind === "source" && !x.jailbreak), ...(directory ?? [])]) {
    const k = urlKey(r.url);
    if (!k || seen.has(k) || blocked(r.url)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
