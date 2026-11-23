// SPDX-License-Identifier: GPL-3.0-or-later
// One source page for both kinds (AltStore sources and APT repos). Every source page is the same four parts, each
// drawn only when it has something, so no page is bare and none repeats itself:
//   1. the header card (banner or tint, icon, name, subtitle): APT repos get one too (CydiaIcon, Label, host)
//   2. what's in it: AltStore up to 5 apps on the page, then All Apps (altstore.js); APT Works on My Phone and the
//      sections (browse.js)
//   3. About (the description) and News / Featured banners
//   4. Information: one grouped table of status rows with row icons (Trust, Website, Updated or Status, Last Release,
//      HTTPS, Signed Releases)
//
//   sourceHeader({ name, subtitle, banner, iconEl, tint })  -> the header card (altstore.css .alt-header)
//   aptHeader(source)                                      -> an APT repo's header card
//   infoGroup(source, { website, canister })               -> the Information group; `.ready` resolves once drawn
//                                                             with Canister's facts (or without them)
import { el, grouped } from "../nav/ui.js";
import { trustOf } from "../core/trust.js";
import { trustedNow, trustPill } from "./safety.js";
import { healthOf, ago } from "../core/health.js";
import { sourceSubtitle, sourceIcons, displayName } from "../core/sources.js";
import { sourceIconImage } from "../source-icon.js";
import { getBackend } from "../backend.js";
import { rowIcon } from "../icons/rowicons.js";
import { showMenu, longPress, copyText } from "../nav/menu.js";

// The header card, as AltStore sources draw it (altstore.css .alt-header). `iconEl` an element or null.
export function sourceHeader({ name, subtitle = "", banner = null, iconEl = null, tint = null }) {
  const head = el("div", "alt-header");
  if (tint) head.style.setProperty("--alt-tint", tint);
  if (banner) head.append(banner);
  const id = el("div", "alt-id");
  if (iconEl) { iconEl.classList.add("alt-icon"); id.append(iconEl); }
  const names = el("div", "alt-names");
  names.append(el("span", "alt-name", name));
  if (subtitle) names.append(el("span", "alt-subtitle", subtitle));
  id.append(names);
  head.append(id);
  return head;
}

// An APT repo's address without its scheme and trailing slash: "apt.procurs.us".
export const shortUrl = (url) => String(url ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

// An APT repo's header: the letter tile the Sources row shows with its CydiaIcon over it once it loads, its Label,
// and its Release Description or host.
export function aptHeader(source, { backend = getBackend() } = {}) {
  const wrap = el("div", "alt-source source-head");
  const name = displayName(source);
  const icon = el("span", "source-head-icon", name.trim().charAt(0).toUpperCase());
  icon.append(sourceIconImage(source.key, sourceIcons(source), backend));
  wrap.append(sourceHeader({ name, subtitle: source.description || shortUrl(sourceSubtitle(source)), iconEl: icon }));
  return wrap;
}

const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The Information group: the status rows every source has, in one grouped table with row icons. Website (an AltStore
// source's) opens on a tap and holds for Copy URL, as a source row on Sources does. Canister's HTTPS and Signed
// Releases fill in when `canister` (a promise of canisterTrust's facts) answers; the footer names Canister only then.
export function infoGroup(source, { website = null, canister = null, now = Date.now(), menu = showMenu, copy = copyText,
  hold = longPress } = {}) {
  const box = el("div", "source-info");
  const kind = trustOf(source, { trusted: trustedNow() });
  const h = healthOf(source, now);
  const rows = [{ label: "Trust", detail: "", icon: rowIcon("srcTrust"), cls: "source-info-trust" }];
  if (website) {
    rows.push({ label: "Website", icon: rowIcon("srcWebsite"), detail: shortUrl(website), cls: "source-info-website",
      onClick: () => window.open(website, "_blank", "noopener") });
  }
  if (h.state === "down") rows.push({ label: "Status", icon: rowIcon("srcStatus"), detail: "Not Responding", cls: "find-warn" });
  else if (h.reachedAt) rows.push({ label: "Updated", icon: rowIcon("srcUpdated"), detail: sentence(ago(h.reachedAt, now)) });
  if (h.releaseDate) rows.push({ label: "Last Release", icon: rowIcon("srcRelease"), detail: sentence(ago(h.releaseDate, now)) });
  const draw = (facts) => {
    const all = [...rows];
    if (facts?.https != null) {
      all.push({ label: "HTTPS", icon: rowIcon("srcHttps"), detail: facts.https ? "Yes" : "No", cls: facts.https ? null : "find-warn" });
    }
    if (facts?.gpg != null) all.push({ label: "Signed Releases", icon: rowIcon("srcSigned"), detail: facts.gpg ? "Yes" : "No" });
    const named = all.length > rows.length;
    box.replaceChildren(grouped([{ header: "Information", rows: all,
      footer: named ? "HTTPS and Signed Releases are from Canister (canister.me), which checks this repo's files." : null }]));
    box.querySelector(".source-info-trust .cell-detail")?.replaceChildren(trustPill(kind));
    return named ? facts : null;
  };
  draw(null);
  // Hold Website: iOS 6's black menu with Copy URL (nav/menu.js), the same as a source row's hold on Sources.
  if (website) hold(box, ".source-info-website", (li, e) => menu(li, [{ label: "Copy URL", onClick: () => copy(website) }], { x: e?.clientX }));
  box.ready = Promise.resolve(canister).then((f) => (f ? draw(f) : null), () => null);
  return box;
}
