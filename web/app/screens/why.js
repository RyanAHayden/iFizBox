// Why <NAME> (F303, user 2026-11-20): one page on Home's stack (#/home/why) listing what the app does that other
// app stores and sideloaders don't, led by the two builds and APT tweaks injected into sideloaded apps. iOS 6 grouped tables: each
// point is a group whose header names it, a few short lines as rows, and a real screenshot in the last cell
// (web/app/img/why/, cropped from the README captures, F288's Sign Options capture and F290's showcase stills).
//
// Linked from the website's Home (always: phones and, past the Not-an-iPhone page, desktops), the installed apps'
// Home until it has been opened there (showsWhyTile), then their Settings > About (whyAboutSection), and the
// Not-an-iPhone page desktops see first (notiphone.js).
// It stays open while the website's Home is locked (home.js OPEN_WHILE_LOCKED).
//
// Styles live here (whyCss, put in the document by ensureWhyStyle, rewritten when the Style changes) so the page and
// Home's tile need no new stylesheet link; they use ios6.css's tokens only, so both palettes and every theme follow.
import { el, grouped } from "../nav/ui.js";
import { format, settingsRoute } from "../router.js";
import { NAME } from "../brand.js";
import { rowIcon, homeTileCss, iconStyle } from "../icons/rowicons.js";

export const WHY_ROUTE = { tab: "home", path: ["why"] };
export const whyHref = (fmt = format) => fmt(WHY_ROUTE);
export const WHY_TITLE = `Why ${NAME}`;
export const WHY_TILE = { label: `Why ${NAME}?`, subtitle: "Tweaks in sideloaded apps, and more" };

// Each point: title (the group header), lines (short, one row each), shot (img/why/<shot>.jpg, its pixel size so the
// page keeps its height while it loads), alt. The first is the lead (F306: the two builds, then tweaks in apps).
export const WHY_POINTS = [
  {
    id: "builds", title: "One App, Jailbroken or Not",
    lines: ["Lite for any iPhone: apps, signing, tweaks in apps.", "The full app for jailbroken iPhones: apt underneath.",
      "Same screens, same sources, same settings.", "One account keeps your sources, certificate and repo sign-ins."],
    shot: "builds", size: [600, 376], alt: "The website's Home offering Lite and the jailbreak app",
  },
  {
    id: "tweaks", title: "Tweaks in Sideloaded Apps",
    lines: ["Add tweaks from APT repos to any app you sign, no jailbreak.", "Paid ones too, bought with your Havoc account.",
      "ElleKit comes bundled for tweaks that need it.", "Or add your own .deb, .dylib or .framework.",
      "The tweaks stay with the app when it's re-signed."],
    shot: "tweaks", size: [600, 456], alt: "Sign Options with three tweaks under Inject Tweaks",
  },
  {
    id: "look", title: "Cydia's iOS 6 Look",
    lines: ["Glossy bars, pinstripes and grouped tables.", "Light and dark themes: Gunmetal, OLED Black.",
      "Fast on today's iPhones, 120 Hz scrolling."],
    shot: "look", size: [478, 931], alt: "An app's page with Details, Reviews and Related",
  },
  {
    id: "signing", title: "Signing on the Phone",
    lines: ["Your certificate signs apps on the iPhone itself.", "No computer, no signing server to trust.",
      "Your IPAs never leave the phone."],
  },
  {
    id: "freeid", title: "A Free Apple ID Works",
    lines: ["No certificate? Sign in with a free Apple ID.", `${NAME} makes the certificate and profile for you.`,
      "Up to 3 apps, 7 days at a time."],
  },
  {
    id: "routes", title: "Installs Over Tailscale",
    lines: ["Install straight on the phone over LocalDevVPN or Tailscale.", "No install link, no popup, no server.",
      `${NAME} can update itself the same way.`],
    shot: "routes", size: [498, 322], alt: "Install Apps With: Signing Server or This iPhone",
  },
  {
    id: "sources", title: "AltStore and APT Sources Together",
    lines: ["AltStore sources for apps, APT repos for tweaks.", "One Sources tab, one search, one Changes list.",
      "Recommended Sources: one tap adds one."],
    shot: "sources", size: [478, 931], alt: "The Sources tab with Havoc, Chariz, BigBoss and more",
  },
  {
    id: "safety", title: "Safety Labels and Malware Checks",
    lines: ["Known Safe and Trusted labels on every source.", "Known malware is refused before it installs.",
      "Piracy sources are flagged, on Sources and Installed.", "Each app says what it asks iOS for."],
  },
  {
    id: "resign", title: "Re-sign and Update",
    lines: ["Days left on every app you signed.", "Re-sign All before they expire.",
      "App updates from your sources, signed the same way."],
    shot: "resign", size: [484, 558], alt: "Signed Apps with days left and Re-sign All",
  },
  {
    id: "reviews", title: "Reviews",
    lines: ["Rate and review apps and tweaks.", "Read what others found before you install.",
      "Report a package as malicious."],
  },
];

export const shotSrc = (id) => `img/why/${id}.jpg`;

// The page's CSS for `style`: the Why tile's star comes from the icon map (icons/rowicons.js "home", C51).
export const whyCss = (style = "ios6") => `
.why-intro { margin: 14px 19px 0; font-size: 17px; line-height: 22px; text-align: center; color: var(--text); text-shadow: var(--emboss); }
.why-lead .table.grouped { border-width: 2px; }
.cell.why-line .cell-inner { min-height: 0; padding-block: 9px; }
.cell.why-line .cell-label { font-size: 16px; font-weight: normal; line-height: 20px; white-space: normal; overflow: visible; }
.cell.why-shot-cell .cell-inner { display: block; padding: 10px; min-height: 0; }
.why-shot { display: block; width: 100%; max-width: 320px; height: auto; margin: 0 auto; border-radius: 7px;
  border: 1px solid var(--table-edge); }
.home-glyph.glyph-why { ${homeTileCss("why", style)}
  background-size: 21px 21px, 100% 100%; background-repeat: no-repeat; background-position: center; }
@media (min-width: 700px) { .why-page { max-width: 640px; margin: 0 auto; } }
`;

// Puts the page's CSS in the document for the Style showing now, or rewrites it when the Style has changed since
// (Theme > Style, iOS 6 <-> iOS 7: Home calls this again, so the Why tile swaps without a reload). Returns whether it
// wrote anything.
const written = new WeakMap(); // the <style> element -> the Style its CSS is for
export function ensureWhyStyle(doc = globalThis.document) {
  if (!doc?.head) return false;
  const style = iconStyle(doc);
  let s = doc.getElementById?.("why-style");
  if (s && written.get(s) === style) return false;
  if (!s) {
    s = doc.createElement("style");
    s.id = "why-style";
    doc.head.append(s);
  }
  s.textContent = whyCss(style);
  written.set(s, style);
  return true;
}

// The groups for `mode` ("site" | "sideload" | "jailbreak"). `install`: the website's Install <NAME> Lite (home.js).
export function whySections({ mode = "site", install = null } = {}) {
  const groups = WHY_POINTS.map((p, i) => ({
    header: p.title,
    rows: p.lines.map((label) => ({ label, cls: "why-line" })),
    point: p, lead: i === 0,
  }));
  const end = endGroup(mode, install);
  return end ? [...groups, end] : groups;
}

// What to do next: the website installs Lite; the sideload app sets up signing; the jailbreak app has done both.
export function endGroup(mode, install = null) {
  if (mode === "site" && install) {
    return { header: "Get Started", rows: [{ label: `Install ${NAME} Lite`, subtitle: "For any iPhone · no jailbreak needed", onClick: () => install(), chevron: true }],
      footer: `Free and open source (GPL-3.0). Jailbroken? Home has ${NAME} for your jailbreak too.` };
  }
  if (mode === "sideload") {
    return { header: "Get Started", rows: [{ label: "Set Up Signing", href: format(settingsRoute(["signing"])) }],
      footer: "Add your certificate, or use a free Apple ID." };
  }
  return null;
}

export const nav = () => ({ title: WHY_TITLE });

export function render(body, { mode = "site", install = null, storage = globalThis.localStorage } = {}) {
  ensureWhyStyle();
  if (mode !== "site") markWhyOpened(storage); // F306: Home's tile goes for good in the installed apps
  const page = el("div", "why-page");
  page.append(el("p", "why-intro", `What ${NAME} does that other app stores don't.`));
  const sections = whySections({ mode, install });
  const frag = grouped(sections);
  const groups = [...frag.children];
  sections.forEach((s, i) => {
    const g = groups[i];
    if (s.lead) g.classList.add("why-lead");
    if (!s.point?.shot) return;
    const li = el("li", "cell why-shot-cell");
    const inner = el("div", "cell-inner");
    const img = el("img", "why-shot");
    img.src = shotSrc(s.point.shot);
    img.alt = s.point.alt;
    img.width = s.point.size[0];
    img.height = s.point.size[1];
    img.loading = i < 2 ? "eager" : "lazy";
    img.decoding = "async";
    inner.append(img);
    li.append(inner);
    g.querySelector(".table")?.append(li);
  });
  page.append(frag);
  body.append(page);
  return page;
}

// Where Home shows the Why tile (F306, user 2026-11-20): the website always; the installed apps (sideload and
// jailbreak) only until the page has been opened once there (WHY_OPENED_KEY, kept in localStorage, which the app's
// web view keeps across launches). After that the page is reached from Settings' About group (whyAboutSection).
export const WHY_OPENED_KEY = `${NAME.toLowerCase()}.whyOpened`; // the lowercase name's storage prefix, from brand.js
export const showsWhyTile = (mode, opened = false) => mode === "site" || !opened;
export function whyOpened(storage = globalThis.localStorage) {
  try { return storage?.getItem(WHY_OPENED_KEY) === "1"; } catch { return false; }
}
export function markWhyOpened(storage = globalThis.localStorage) {
  try { storage?.setItem(WHY_OPENED_KEY, "1"); } catch { /* private mode: the tile stays */ }
}

// Settings' root in the installed apps: an About group with a row to the page (both builds; the website keeps the
// tile on Home instead). null on the website.
export function whyAboutSection(mode) {
  if (mode === "site") return null;
  return { header: "About", rows: [{ label: WHY_TILE.label, href: whyHref(), chevron: true, icon: rowIcon("recommended") }] };
}
