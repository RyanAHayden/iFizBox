// AltStore sources (F9): a source's own page and an app's page. The parsing and the rules (which versions this
// phone runs, how an app installs) are core/altstore.js; the apps are catalog rows (core/catalog.js loadAlt), so
// lists, Search and Changes draw them with screens/browse.js like any package. browse.js hands this file:
//   the Sources tab's `alt:<url>` page  -> renderAltSource: header in the source's tint, All Apps, news,
//                                         featured apps, Website; Share in the nav bar (F76)
//   a package page whose stanza is an app (kind "ipa") -> renderApp
// Styles: altstore.css. Every remote image goes through mediaUrl (http ones through the proxy on the site).
import { grouped, placeholder, el, note } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { getBackend } from "../backend.js";
import { mediaUrl } from "./depiction.js";
import { installOptions } from "../core/altstore.js";
import { appLinks, appGithub, altShots, loadPreviews, dedupeShots } from "../core/previews.js";
import { settings } from "../settings-store.js";
import { displayName, githubAvatarUrl } from "../core/sources.js";
import { compat } from "../core/compat.js";
import { currentDevice } from "../device.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall, removeInstall, onAppsChange } from "../core/installed.js";
import { recordOf } from "../core/installed.js"; // B358
import { signAndInstall, isSelfIpa, originalWarning } from "../signing/install.js";
import { localSigning } from "../signing/common.js";
import { TOO_BIG_FOOTER } from "../signing/toobig.js";
import { overSiteLimit } from "../core/websign.js";
import { siteGateRows, markiFizBoxInstalled, websiteInstallsOn } from "../websign-gate.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { guarded } from "../nav/tapguard.js";
import { setSourceShare, headerShareButton } from "./handoff.js";
import { sourceErrorGroup } from "./sourceerror.js"; // B177
import { openIpaInstall, markIpaNeeds } from "./ipa-install.js";
import { ipaInstallAvailable } from "../ipa-install.js";
import { IPA_FOOTER } from "../core/ipainstall.js";
import { appQueue } from "../app-queue.js";
import { appJob, appNavLabel, modifyActions, resignJob, MARK_NOT_INSTALLED, destructiveOf, sizeText as formatSize } from "../core/appqueue.js";
import { markedVersionOnSource, markedResignJob } from "../core/appqueue.js"; // F221
import { signatureState, signedIndex, resignWindow } from "../core/signing.js";
import { deviceError } from "../core/signing.js"; // B338
import { compareVersions } from "../core/apt.js";
import { altVersionList } from "../core/catalog.js"; // B232: Install Which Version? offers what Version History does
import { ignoreVersionLabel, withVersionButton, versionToStore, IGNORE_VERSION } from "../core/appupdates.js"; // F281
import { queueApp } from "./queue.js";
import { descriptionGroup } from "./description.js";
import { infoGroup, sourceHeader } from "./sourcepage.js"; // F384: one source page
import { storeHeader, headerLine, storeTabs, whatsNewGroup } from "./storepage.js";
import { appRows, moreInfoShown, detailRows, descGroup, changeButton, tileCells, footerGroup, detailsFooter, MORE_INFO_LABEL,
  PREVIEW_HEADER } from "./details.js"; // F350
import { rowIcon } from "../icons/rowicons.js";
import { reviewsTab } from "./reviews.js";
import { reviewsApi, reviewsBase, pageRating } from "../core/reviews.js";
import { needsCheck, savedInfo, withIpaInfo, checkIpa, ipaInfoUrl, ipaRaises } from "../core/ipainfo.js";
import { PUBLIC_SITE } from "../core/handoff.js";
import { lookupApp, lookupNeed, mergeDetails, pageLinks, lookupUrl, workerLookupUrl, regionOf, ownPageLinks,
  storeTrackId, storeReviews, reviewsFeedUrl, workerReviewsUrl } from "../core/applookup.js";
import { NAME, BUNDLE_ID } from "../brand.js";
import { addNavIcon } from "../nav/navbar.js";
import { haptic } from "../nav/haptic.js";
import { showHUD } from "../nav/hud.js";
import { showUndoBar } from "../nav/undobar.js"; // F242a
import { slideChange, isWatched } from "../nav/slide.js"; // B191
import { handleOf } from "../nav/go.js";
import { APP_MODE_LABEL } from "../core/appqueue.js"; // F242a
import { installedOnPhone } from "../core/appqueue.js"; // B136
import { whereFromGroup, reportBanner, reports, reportMalicious } from "./safety.js"; // F291
import { addTweaksGroup, installTweaksChoice } from "./tweaks.js"; // F302a
import { EASE, DURATION } from "../nav/motion.js";
import { nativeBridge } from "../native.js";

function img(url, cls) {
  const src = mediaUrl(url);
  if (!src) return null;
  const i = el("img", cls);
  i.alt = "";
  i.decoding = "async";
  i.loading = "lazy";
  i.referrerPolicy = "no-referrer";
  i.onerror = () => i.remove();
  i.src = src;
  return i;
}

const deeper = (route, seg) => format({ tab: route.tab, path: [...route.path, seg] });

// "com.apple.developer.kernel.increased-memory-limit" -> "Increased Memory Limit" (the full name goes below).
const entitlementLabel = (name) => (String(name).split(".").pop() || String(name)).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const formatDate = (t, locale) => (t ? new Date(t).toLocaleDateString(locale, { dateStyle: "medium" }) : null);

// "iOS 15.0 or later", "iOS 14.0 – 16", or null.
export function osRange(v) {
  if (v.minOSVersion && v.maxOSVersion) return `iOS ${v.minOSVersion} – ${v.maxOSVersion}`;
  if (v.minOSVersion) return `iOS ${v.minOSVersion} or later`;
  if (v.maxOSVersion) return `iOS ${v.maxOSVersion} or earlier`;
  return null;
}

function card(children, cls = "") {
  const g = el("div", "group");
  const t = el("div", `table grouped ${cls}`.trim());
  t.append(...children.filter(Boolean));
  g.append(t);
  return g;
}

// The install rows for a version (user 2026-11-17: iFizBox's own signing is the way in the app):
//   - jailbreak build: Install through the helper (F67, screens/ipa-install.js), the console titled with `name`
//   - a source's own signed link (itms-services): Install, signed by the source
//   - the sideload app: Install, signed with the user's certificate on the phone (signing-client signAndInstall;
//     without one it opens the Signing walkthrough)
//   - the website: F93's Install, signed in the browser with the user's certificate (signing-client signAndInstall).
//     F92 (user 2026-11-18): no hand-offs to iFizBox / AltStore / SideStore / Feather here; Share keeps those.
//   - always: Download IPA, to keep the file
// `opener` opens a URL outside the app (window.open on the site). `onInstall` runs first on any of them (F30: the
// Installed tab's record). F80: `queue`, when given, is what "Signed with your certificate" does instead (the app page
// queues the app and opens Confirm: appPageAction); it resolves false to sign and install straight away as before.
// F81: where the phone signs (the sideload app), any version with an IPA also gets "Custom Install": the look-first
// sheet (signing-sheet.js customInstall) to change the bundle ID, name or icon, or leave extensions out. `custom`
// overrides whether it shows, `customize` what it runs (tests; F84: the app page's appPageCustom, which queues).
// F96: on the website any app but iFizBox gets websign-gate.js's rows instead (Install in iFizBox, Download IPA, then
// Install on the Website behind its warning); `appId` is the app's package id for the ifizbox:// link (else the page's
// hash), `gate` makes the rows (tests).
// F129: `bundleId` is the app's own bundle ID (appBundleId), handed to signAndInstall so a wildcard profile's website
// install opens iOS's prompt from the Install tap (signing-client.js expectedBundleId); null where it isn't known.
// `sign` is what signs and installs (signing-client.js signAndInstall; tests pass a fake).
export function installRows(version, sourceUrl, opener = (u) => window.open(u, "_blank", "noopener"), onInstall = () => {},
  queue = null, name = "", { custom = localSigning() && !ipaInstallAvailable(), customize = null, jailbreak = ipaInstallAvailable(),
    ipaInstall = openIpaInstall, site = detectMode() === "site", needsCertificate = siteCertificateAlert, appId = null,
    gate = siteGateRows, bundleId = null, sign = signAndInstall, iconUrl = null } = {}) {
  const o = installOptions(version, sourceUrl);
  // F257: the listed size (and the icon, for Install IPAs' row) go to the website's Install, which checks the size first
  const own = { bundleId: bundleId || null, version: version?.version ?? "", size: Number(version?.size) || null, iconUrl: iconUrl || null };
  const rows = [];
  if (o.download && jailbreak) {
    // F88: the helper says whether it installed, so the record waits for its success (openIpaInstall's onInstalled)
    rows.push({ label: o.itms ? "Install IPA" : "Install", subtitle: "With the jailbreak",
      onClick: () => ipaInstall({ url: o.download, name, onInstalled: () => onInstall() }) });
  } else if (o.itms) {
    rows.push({ label: "Install", subtitle: "Signed by the source", onClick: () => { onInstall(); location.href = o.itms; } });
  } else if (o.download && site && !isSelfIpa(o.download)) {
    // F96: other apps go to iFizBox first; Install on the Website (F93's browser signing) waits for the warning.
    const install = () => sign({ url: o.download, name, ...own, onInstalled: () => onInstall() });
    return { rows: tapOnly(gate({ id: appId, install, download: downloadRow(o.download, opener) })), options: o, gated: true };
  } else if (o.download && site) {
    // F93: Install signs in the browser with the certificate in Settings > Signing (signing-client.js
    // signInBrowser). F92: no hand-offs follow it. F96: iFizBox itself always installs from the website.
    rows.push({ label: "Install", subtitle: SITE_INSTALL_SUBTITLE,
      onClick: () => sign({ url: o.download, name, ...own, onInstalled: () => { markiFizBoxInstalled(); onInstall(); } }) });
  } else if (o.download) {
    const direct = () => sign({ url: o.download, name, ...own, onInstalled: () => onInstall() });
    rows.push({ label: "Install", subtitle: "Signed with your certificate",
      onClick: queue ? async () => { if (!(await queue())) direct(); } : direct });
  }
  if (o.download && custom) {
    const run = customize ?? (async (opts) => (await import("../signing-sheet.js")).customInstall(opts));
    rows.push({ label: "Custom Install", subtitle: "Bundle ID, name, icon, extensions",
      onClick: () => run({ url: o.download, name, onInstalled: () => onInstall() }) });
  }
  if (o.download) rows.push(downloadRow(o.download, opener));
  return { rows: tapOnly(rows), options: o };
}

// B48: the install rows run on a tap only: a click that ends a drag or a scroll (a scroll that started on Install)
// does nothing (nav/tapguard.js).
const tapOnly = (rows) => rows.map((r) => (r.onClick ? { ...r, onClick: guarded(r.onClick) } : r));

// F129: an app's own bundle ID: its AltStore bundleIdentifier, else its package row's id without the `~name` suffix
// a source adds when two apps share one ID (core/altstore.js). null when neither is there.
// F257: on the website, a version whose listed size (versions[].size) is over what the website signs (core/websign.js
// IPA_MAX): its Size shows red with a footer, and Install opens the Too Big alert (signing-client.js tooBigAlert).
// The apps sign on the phone and have no such cap; a source's own signed link isn't signed here either.
export const siteTooBigApp = (v, { site = detectMode() === "site" } = {}) =>
  Boolean(site && v && !installOptions(v, null).itms && overSiteLimit(v.size));

export const appBundleId = (app, rowId = null) => app?.bundleIdentifier || String(rowId ?? "").split("~")[0] || null;

const downloadRow = (url, opener) => ({ label: "Download IPA", subtitle: decodeURIComponent(url.split("/").pop() || ""), onClick: () => opener(url) });

// ---- the source page -------------------------------------------------------------------------------------------

export async function renderAltSource(body, route, key, ctx = null) {
  // B177: a source whose refresh failed: the whole error and what to do, at the top; drawn again after Refresh
  const failedGroup = (source, status) => sourceErrorGroup(source, { status, ctx,
    onChange: () => { if (body.isConnected) { body.replaceChildren(); renderAltSource(body, route, key, ctx); } } });
  body.append(placeholder("page"));
  let meta, source;
  try {
    await catalog.ensure();
    [meta, source] = await Promise.all([catalog.altSource(key), getBackend().sources().then((l) => l.find((s) => s.key === key))]);
  } catch (e) {
    body.replaceChildren(note(e.message));
    return;
  }
  const status = catalog.status(key);
  // F16a: a source in a format only its own app reads (an encrypted GBox source): the reason, and Open in (F8).
  if (source?.unsupported) {
    body.replaceChildren(grouped([{ header: displayName(source), rows: [{ label: "Can't List Apps", subtitle: source.uri }],
      footer: source.unsupported }]));
    setSourceShare(body, source); // F76: Share in the nav bar (screens/handoff.js)
    return;
  }
  if (!meta) {
    const failed = source && failedGroup(source, status);
    if (failed) { body.replaceChildren(failed); setSourceShare(body, source); return; }
    body.replaceChildren(note(status?.error || source?.error || "This source could not be loaded. Tap Refresh on Sources."));
    return;
  }
  const page = el("div", "alt-source");
  if (meta.tintColor) page.style.setProperty("--alt-tint", meta.tintColor);

  // Header: the source's banner (headerURL) on its tint, with its icon, name and subtitle (screens/sourcepage.js, the
  // same card an APT repo's page draws).
  page.append(sourceHeader({ name: meta.name || (source ? displayName(source) : key), subtitle: meta.subtitle || "",
    banner: img(meta.headerURL, "alt-banner"),
    iconEl: img(meta.iconURL || (source && githubAvatarUrl(source)), "alt-icon") })); // F44: GitHub avatar fallback
  body.replaceChildren(page);
  // F384: what's in it first. Up to 5 apps right on the page (featured ones first), so a one-app source is never
  // an empty page with a lone All Apps row; All Apps only when there are more than fit. Only apps the source's list
  // shows (the ones that run on this iPhone), so the rows, the All Apps count and the footer agree; the featured
  // rows alone if the list can't be read.
  const appRow = (r) => ({ label: r.name, subtitle: r.short, detail: r.version, href: deeper(route, `package:${r.id}`),
    icon: { cls: "alt-app-icon", src: r.icon ? mediaUrl(r.icon) : "" } });
  const all = (await catalog.list(key, ALL).catch(() => null)) || null;
  const runs = all ? new Set(all.map((r) => r.id)) : null;
  const seen = new Set();
  const listed = [...meta.featured.filter((r) => r && (!runs || runs.has(r.id))), ...(all ?? [])]
    .filter((r) => r && !seen.has(r.id) && seen.add(r.id));
  const shown = listed.slice(0, 5).map(appRow);
  const total = all ? all.length : meta.count;
  if (total > shown.length) shown.push({ label: "All Apps", detail: String(total), href: deeper(route, `section:${ALL}`) });
  body.append(grouped([{ header: total === 1 ? "App" : "Apps", rows: shown,
    footer: total ? null : "No app on this source runs on this iPhone's iOS version." }]));

  if (meta.description) body.append(descriptionGroup(meta.description)); // F165: own group, long ones fold behind More

  // News, newest first: a card each; one about an app opens that app, one with a url opens it.
  if (meta.news.length) {
    const g = el("div", "group");
    g.append(el("h2", "group-header", "News"));
    for (const n of meta.news.slice(0, 3)) {
      const a = el(n.appID || n.url ? "a" : "div", "alt-news table grouped");
      if (n.appID) a.href = deeper(route, `package:${n.appID}`);
      else if (n.url) { a.href = n.url; a.target = "_blank"; a.rel = "noopener"; }
      if (n.tintColor) a.style.setProperty("--alt-tint", n.tintColor);
      const pic = img(n.imageURL, "alt-news-image");
      if (pic) a.append(pic);
      const t = el("div", "alt-news-text");
      t.append(el("span", "alt-news-title", n.title));
      if (n.caption) t.append(el("span", "alt-news-caption", n.caption));
      if (n.date) t.append(el("span", "alt-news-date", formatDate(n.date)));
      a.append(t);
      g.append(a);
    }
    body.append(g);
  }

  setSourceShare(body, source ?? { key });
  // F384: Trust, Website and when it was last reached in one Information group at the bottom (screens/sourcepage.js).
  // F76: Share in the nav bar (screens/handoff.js) above.
  body.append(infoGroup(source ?? { key, uri: key.slice(4) }, { website: meta.website }));
  const failed = source && failedGroup(source, status);
  if (failed) page.after(failed); // B177: under the header, above All Apps
  else if (status?.error) body.append(note(status.error));
}

// ---- the app page ----------------------------------------------------------------------------------------------

// F91: iFizBox's signing.installed record of this app (by installed or original bundle ID), in the sideload app; null
// anywhere else, for an app iFizBox didn't sign, or when the call fails.
export async function signedRecordOf(id, { mode = detectMode(), native = nativeBridge() } = {}) {
  if (mode !== "sideload" || !id || typeof native?.call !== "function") return null;
  try { return signedIndex(await native.call("signing.installed", {})).get(id) ?? null; } catch { return null; }
}

// F91: the Installed section's "Signature" row: the days left as the Installed tab's pill. Null without a date.
// F134: null too while Show Expiry Dates is off (`show`), unless the signature expired.
export function signatureRow(record, { now = new Date(), window = resignWindow((k) => settings.get(k)), show = settings.get("showExpiry") } = {}) {
  const sig = record ? signatureState(record.expires, { now, window }) : null;
  return sig && (show || sig.state === "expired") ? { label: "Signature", detail: sig.long, cls: `sig-row-${sig.state}` } : null;
}

// B338: `box.redraw()` draws it again (the nav bar's mark toggle calls it after a tap); `box.drawn` is the first draw.
// `store` and `signedOf` are where the section reads the record and the signature (tests hand in fakes).
export function trackingSection(app, pkg, source, body = null, { store = apps, signedOf = (id) => signedRecordOf(id) } = {}) {
  const box = el("div");
  const mark = (version) => apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version, key: pkg.key,
    source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).then(draw, () => {});
  // B372: while the toggle or Modify holds a forget, the section reads Not Installed, and Mark as Installed cancels it
  // (the records as they were, the signature's expiry too)
  const held = () => forgetHeld(app.bundleIdentifier);
  const remark = () => { cancelHeldForget(app.bundleIdentifier); return draw(); };
  async function draw() {
    let rec = null;
    const signed = held() ? null : await Promise.resolve().then(() => signedOf(app.bundleIdentifier)).catch(() => null);
    // B358: a custom bundle ID's record is under the installed ID, not the source's
    if (!held()) try { rec = recordOf(await (await store()).all(), app.bundleIdentifier, signed); } catch { /* no store */ }
    const sigRow = signatureRow(signed); // F91
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const byHand = handMarking(); // F242: the jailbreak app knows what's installed: no marking rows there
    const rows = rec
      ? [{ label: "Installed Version", detail: rec.version || "Unknown" },
        // B232: installs another of the source's versions (Install Which Version?), as Version History does
        ...(byHand && installWhichButtons(app, rec.version || "", currentDevice().ios ?? null).versions.some(Boolean) ? [{ label: "Change Installed Version", onClick: () => installWhichVersion(app, pkg, source, { installed: rec.version || "" }).catch(() => {}) }] : []),
        ...(byHand ? [{ label: MARK_NOT_INSTALLED_LABEL, onClick: () => apps().then((store) => removeInstall(store, rec.id)).then(draw, () => {}) }] : [])]
      : byHand ? [{ label: MARK_INSTALLED_LABEL, onClick: () => (held() ? remark() : versions.length > 1 ? pick() : mark(versions[0] ?? "")) }] : [];
    // The nav bar's button says what it will do, as Cydia's does: Upgrade when a newer version is out than the one
    // installed, Reinstall when it's the same, Install when it isn't installed.
    // F80: Modify while the app is queued, as Cydia's does (core/appqueue.js appNavLabel).
    // B358: an app iFizBox signed is installed even with no record matching the source's entry: Modify stays
    const label = appNavLabel({ queued: Boolean(appQueue.get(app.bundleIdentifier) || (signed?.bundleId && appQueue.get(signed.bundleId))),
      installed: rec ? rec.version || "" : signed ? signed.version || "" : null, newest: versions[0] });
    // (the Share icon sits beside it in the same corner: find the button by its label, on this page's own nav item)
    const relabel = () => {
      const b = handleOf(body)?.rightButton((x) => /^(Install|Upgrade|Reinstall|Modify)$/.test(x.textContent));
      if (b) b.textContent = label;
      return Boolean(b);
    };
    if (!relabel()) setTimeout(relabel, 0);
    if (sigRow) rows.splice(1, 0, sigRow);
    if (!rows.length) { box.replaceChildren(); return; } // F242: the jailbreak app, not installed: no section
    box.replaceChildren(grouped([{ header: "Installed", rows,
      footer: rec ? `${NAME} follows this app for updates: they show in Changes.` : `Installed it another way? Mark it, and ${NAME} follows it for updates.` }]));
  }
  async function pick() {
    const versions = app.versions.map((x) => x.version).filter(Boolean);
    const i = await showActionSheet({ title: MARK_WHICH_TITLE, buttons: versions });
    if (i >= 0) mark(versions[i]);
  }
  box.redraw = draw;
  box.drawn = draw();
  // F88: an install's record lands when the helper's install ends: redraw, and stop once the page is gone.
  const offApps = onAppsChange(() => { if (box.isConnected) draw(); else offApps(); });
  // B372: a forget held or cancelled from the toggle or Modify: redraw; the page gone, stop
  const offHeld = onHeldForget(() => { if (box.isConnected) draw(); else if (!body?.isConnected) offHeld(); });
  // F80: queuing or clearing this app relabels the nav button (Modify); the page gone, it stops listening.
  let shown = false;
  const off = appQueue.subscribe((e) => {
    if (!box.isConnected) { if (shown) off(); return; }
    shown = true;
    if (e.type === "clearAll" || e.id === app.bundleIdentifier || e.job?.id === app.bundleIdentifier) draw();
  });
  return box;
}

// ---- B232: the Installed section's Change Installed Version: install another of the source's versions ----------------
// An action sheet of the source's versions, newest first, the installed one marked and left alone (the nav bar's
// Reinstall covers it); a pick installs that version as Version History (browse.js renderVersions) and Modify's
// Downgrade do: the sideload app queues that version's job (appPageAction's `version`, then Confirm), the website signs
// it in the browser (siteInstallVersion). Recording a version installed some other way is Mark as Installed's picker.
export const INSTALL_WHICH_TITLE = "Install Which Version?";
export const MARK_WHICH_TITLE = "Which Version Did You Install?";

// -> { buttons, versions } : the sheet's labels and, at the same index, the version entry a tap installs (null for the
// installed one). As Version History greys them, versions that don't run on this iOS (`ios`; null: unknown, all run)
// or have nothing to install from are left out, and so are numberless ones; the order is newest first.
export function installWhichButtons(app, installed = "", ios = null) {
  const list = altVersionList(app, ios).filter((x) => x?.version && ((x.runs && x.installable) || (installed && x.version === installed)));
  const sorted = list.map((x, i) => [x, i]).sort((a, b) => compareVersions(b[0].version, a[0].version) || a[1] - b[1]).map(([x]) => x);
  return {
    buttons: sorted.map((x) => (installed && x.version === installed ? `${x.version} (Installed)` : x.version)),
    versions: sorted.map((x) => (installed && x.version === installed ? null : x)),
  };
}

// The sheet and the install. -> the version entry installed (queued or signed), or null (Cancel, the installed row).
// Sideload: the version's job is queued (Confirm); when nothing could be queued, the install rows' first one runs, as
// Version History falls back to its rows (siteInstallVersion picks the same first row).
export async function installWhichVersion(app, pkg, source, { installed = "", ask = showActionSheet, mode = detectMode(), ios = currentDevice().ios ?? null,
  queueVersion = (v) => appPageAction(pkg, source, { version: v.version }), siteInstall = (v) => siteInstallVersion(pkg, v, source),
  jailbreakInstall = null } = {}) {
  const { buttons, versions } = installWhichButtons(app, installed, ios);
  if (!versions.some(Boolean)) return null;
  if (mode === "jailbreak" && !jailbreakInstall) return null; // F346: the jailbreak app's hold brings its own install
  const i = await ask({ title: INSTALL_WHICH_TITLE, buttons });
  const v = i >= 0 ? versions[i] : null;
  if (!v) return null;
  if (mode === "sideload") { if (!(await queueVersion(v))) await siteInstall(v); }
  else if (mode === "site") await siteInstall(v);
  else if (mode === "jailbreak") await jailbreakInstall(v);
  else return null;
  return v;
}

// ---- B372: the app page's Mark as Not Installed waits until the page is left ----------------------------------------
// Forgetting an app iFizBox signed drops its signed record (signing.forget), and with it the signature's expiry; marking
// it installed again could only write a bare record. So on the app page (the nav bar's toggle, the Installed section's
// row, Modify's Mark as Not Installed) the forget is held: the page reads Not Installed at once, and the forget runs
// when the page leaves the document (popped), or the app or tab is hidden. Marking it installed again before that
// cancels the held forget, and the records stay as they were. Every reader on the page (the toggle, the Installed
// section, the nav label, Modify) treats a held app as not installed.
const heldForgets = new Map(); // bundle ID -> { run, body }
const heldListeners = new Set();
const appPageBodies = new Map(); // bundle ID -> the latest app page's body (renderApp), for Modify's hold
const heldNotify = () => { for (const f of [...heldListeners]) { try { f(); } catch { /* a listener's page is gone */ } } };

export const forgetHeld = (id) => Boolean(id) && heldForgets.has(id);
export function onHeldForget(fn) { heldListeners.add(fn); return () => heldListeners.delete(fn); }

// `run` does the forget; `body` is the app page whose leaving runs it.
export function holdForget(id, run, body) {
  heldForgets.set(id, { run, body });
  watchLeaving();
  heldNotify();
}

// -> true when a held forget was cancelled (nothing was forgotten).
export function cancelHeldForget(id) {
  if (!heldForgets.delete(id)) return false;
  heldNotify();
  return true;
}

// Runs the held forgets whose page is gone (`all`: every one, as the app or tab goes away).
export async function flushHeldForgets({ all = false } = {}) {
  const due = [...heldForgets].filter(([, h]) => all || h.body?.isConnected === false);
  for (const [id] of due) heldForgets.delete(id);
  if (due.length) heldNotify();
  for (const [, h] of due) { try { await h.run(); } catch { /* run reports its own failure */ } }
}

let leavingWatched = false;
function watchLeaving() {
  if (leavingWatched) return;
  const doc = globalThis.document, win = globalThis.window;
  if (!doc?.documentElement) return; // node tests: flushHeldForgets is called directly
  leavingWatched = true;
  // a popped page is taken out of the document (app.js drop)
  if (typeof globalThis.MutationObserver === "function") {
    new globalThis.MutationObserver(() => { if (heldForgets.size) flushHeldForgets(); })
      .observe(doc.documentElement, { childList: true, subtree: true });
  }
  win?.addEventListener?.("pagehide", () => flushHeldForgets({ all: true }));
  doc.addEventListener?.("visibilitychange", () => { if (doc.visibilityState === "hidden") flushHeldForgets({ all: true }); });
}

// The app page now up for `id`, when it is in the document.
function appPageOf(id) {
  const b = appPageBodies.get(id);
  return b?.isConnected ? b : null;
}

// ---- F210: the nav bar's one-tap Installed toggle, left of Install / Modify ----------------------------------------
// Not installed: an outline circled checkmark; a tap marks the app installed at the source's latest version (the record
// trackingSection's Mark as Installed writes, no version picker). Installed (by iFizBox or marked): filled; a tap
// forgets it (removeInstall, as Mark as Not Installed). No sheet: a haptic tick and a HUD, and the Installed section,
// the nav label and Changes follow through onAppsChange. Hidden for iFizBox's own app and an app with nothing to mark.
// B338: an app iFizBox signed counts as installed too (its signing.installed record, with or without an installed
// record), and the off tap forgets both, as Installed's Remove from List does (installed.js forgetApp): a signature
// left behind brings the record back (restoreSourceRecords) and the nav button keeps reading Modify.
export const MARK_INSTALLED_LABEL = "Mark as Installed";
export const MARK_NOT_INSTALLED_LABEL = "Mark as Not Installed";

const markRecordOf = (app, pkg, source, version) => ({ id: app.bundleIdentifier, name: app.name, version, key: pkg?.key ?? null,
  source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL });

// F242: marking an app installed by hand is for builds that can't ask the phone (the site, the sideload app); the
// jailbreak app can (dpkg, the helper, apps.isInstalled-style calls), so it has no toggle and no Mark rows.
export const handMarking = (mode = detectMode()) => mode !== "jailbreak";

export function markToggleApplies(app, { mode = detectMode() } = {}) {
  if (!handMarking(mode)) return false;
  const id = String(app?.bundleIdentifier ?? "");
  if (!id || !app.versions?.some((x) => x?.version)) return false;
  if (id === BUNDLE_ID || id.startsWith(`${BUNDLE_ID}.`)) return false; // iFizBox itself: always listed as it is
  return !app.versions.some((x) => isSelfIpa(x?.downloadURL));
}

async function markedRecord(app, store) {
  try { return (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { return null; }
}

// B338: Installed's Remove from List (installed.js forgetApp), loaded when first used (installed.js imports this file).
const forgetListed = async (r, native, remove) => (await import("./installed.js")).forgetApp(r, native, remove);
const signatureOf = async (app, signedOf) => {
  try { return (await signedOf(app.bundleIdentifier)) ?? null; } catch { return null; }
};

// The toggle's on/off: an installed record or a signature of iFizBox's.
async function markedOrSigned(app, store, signedOf) {
  if (forgetHeld(app.bundleIdentifier)) return false; // B372
  return Boolean(await markedRecord(app, store)) || Boolean(await signatureOf(app, signedOf));
}

// One tap's work: true when the app is now marked installed, false when it was forgotten.
// B372: with `body` (the app page), the forget is held until that page is left (holdForget); a tap while it is held
// cancels it, so the records (the signed one and its expiry too) stay. A held forget that fails shows `warn`.
export async function toggleMarked(app, pkg, source, { store = apps, signedOf = (id) => signedRecordOf(id), native = undefined,
  forget = forgetListed, body = null, warn = forgetWarning } = {}) {
  if (cancelHeldForget(app.bundleIdentifier)) return true;
  const s = await store();
  const signed = await signatureOf(app, signedOf);
  const rec = recordOf(await s.all(), app.bundleIdentifier, signed); // B358: by the installed bundle ID first
  if (rec || signed) {
    const run = () => forget({ id: rec?.id ?? app.bundleIdentifier, signed, signedOnly: !rec }, native ?? nativeBridge(), async (id) => removeInstall(s, id));
    if (body) {
      holdForget(app.bundleIdentifier, () => Promise.resolve().then(run).catch(async (e) => { try { await warn(e); } catch { /* no alert here */ } }), body);
      return false;
    }
    try {
      await run();
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { forgetFailed: true }); // markToggle says so
    }
    return false;
  }
  await recordInstall(s, markRecordOf(app, pkg, source, app.versions.map((x) => x.version).find(Boolean) ?? ""));
  return true;
}

const markFeedback = (text) => showHUD("").done(text, 900);
const forgetWarning = (e) => showAlert({ title: "Error", message: deviceError(e).message, buttons: ["OK"] });

// The button. `refresh()` redraws it from the record (renderApp calls it on every onAppsChange).
// B338: `after()` runs once a tap's change is written (renderApp redraws the Installed section and the nav label).
export function markToggle(app, pkg, source, { store = apps, signedOf = (id) => signedRecordOf(id), native = undefined, forget = forgetListed,
  after = null, buzz = haptic, feedback = markFeedback, warn = forgetWarning, body = null } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "bar-button bar-icon mark-toggle";
  const show = (on) => {
    b.classList.toggle("is-marked", on);
    b.setAttribute("aria-label", on ? MARK_NOT_INSTALLED_LABEL : MARK_INSTALLED_LABEL);
  };
  show(false);
  let busy = false;
  b.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try { buzz(); } catch { /* no haptics here */ }
    try {
      const on = await toggleMarked(app, pkg, source, { store, signedOf, native, forget, body, warn }); // B372: held on the page
      show(on);
      feedback(on ? "Marked as Installed" : "Marked as Not Installed");
      try { await after?.(); } catch { /* the page is gone */ }
    } catch (e) {
      // B338: signing.forget failed: an alert, as Installed's Remove from List shows; no store: nothing changed
      if (e?.forgetFailed) { try { await warn(e); } catch { /* no alert here */ } }
    } finally { busy = false; }
  });
  b.refresh = async () => show(await markedOrSigned(app, store, signedOf));
  b.refreshed = b.refresh();
  return b;
}

// ---- F242a: the jailbreak app page's queue toggle, where F210's mark toggle sits in the other builds ----------------
// A + bar button left of Install / Modify: a tap puts the app in the jailbreak app queue (B71a, app-queue.js, run by
// the helper from Confirm) quietly, as a row's swipe does (no Confirm sheet), with a haptic tick and F193's undo bar.
// The job is the one the nav button's Install / Upgrade / Reinstall queues (core/appqueue.js appJob at the newest
// version; its mode says which). While the app is queued (by this, a row's swipe, Modify or Confirm) it shows an x
// that takes it back out; it follows the queue live. Hidden for iFizBox's own app and an app with no IPA to install.
export const QUEUE_ADD_LABEL = "Add to Queue";
export const QUEUE_REMOVE_LABEL = "Remove from Queue";

export function queueToggleApplies(app, { mode = detectMode(), available = ipaInstallAvailable(mode) } = {}) {
  if (mode !== "jailbreak" || !available) return false;
  const id = String(app?.bundleIdentifier ?? "");
  if (!id || id === BUNDLE_ID || id.startsWith(`${BUNDLE_ID}.`)) return false;
  return !app.versions?.some((x) => isSelfIpa(x?.downloadURL));
}

// What a + tap queues: the newest version's job, its mode from the installed record (Install, Upgrade, Reinstall).
export async function queueToggleJob(pkg, source, { store = apps } = {}) {
  const app = pkg?.stanza?.ipa;
  const rec = app ? await markedRecord(app, store) : null;
  const job = appJob(pkg, { installed: rec ? rec.version || null : null, source: source ? displayName(source) : null });
  return job ? { app: "install", ...job } : null;
}

// The undo bar's line, as a row's swipe words it (browse.js swipeMessage): "Install Foo queued", "Upgrade Foo cancelled".
export function queueToggleMessage(job, name, added) {
  const label = job?.mode === "remove" ? "Remove" : APP_MODE_LABEL[job?.mode] ?? "Install";
  return `${label} ${name} ${added ? "queued" : "cancelled"}`;
}

const queueUndo = (opts) => showUndoBar(opts);

// The button. `refresh()` redraws it from the queue; the page's subscription calls it on every change.
export function queueToggle(pkg, source, { queue = appQueue, store = apps, buzz = haptic, undo = queueUndo } = {}) {
  const app = pkg?.stanza?.ipa;
  const id = app?.bundleIdentifier;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "bar-button bar-icon queue-toggle";
  const show = () => {
    const on = Boolean(queue.get(id));
    b.classList.toggle("is-queued", on);
    b.setAttribute("aria-label", on ? QUEUE_REMOVE_LABEL : QUEUE_ADD_LABEL);
    return on;
  };
  show();
  let busy = false;
  b.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try {
      const prev = queue.get(id);
      let job = null;
      if (!prev) {
        job = await queueToggleJob(pkg, source, { store });
        if (!job) return; // nothing to install: leave the queue as it is
      }
      try { buzz(); } catch { /* no haptics here */ }
      const name = prev?.name || job?.name || app?.name || id;
      if (prev) queue.clear(id);
      else queue.add(job, { quiet: true });
      show();
      undo({ message: queueToggleMessage(prev ?? queue.get(id) ?? job, name, !prev), onUndo: () => {
        if (!prev) queue.clear(id);
        else { try { queue.add(prev, { quiet: true }); } catch { /* it can't be queued again */ } }
      } });
    } catch { /* the queue refused it: nothing changed */ } finally { busy = false; show(); }
  });
  b.refresh = show;
  return b;
}

// F80: the app page's nav button (browse.js packageActions) and its Install row, where the phone signs (the sideload
// app): Install / Upgrade / Reinstall queue the app and open Confirm (screens/queue.js); while it is queued the
// button reads Modify and offers Clear, as Cydia's does. False when the queue doesn't apply (the jailbreak build, the
// website, a source-signed link, no IPA): the caller
// does what it did before. F85: `version` (Version History's row) queues that version instead of the newest, with no
// Modify sheet: queuing it replaces whatever version of the app was queued.
// F94: an installed app's sheet ends with Mark as Not Installed (red), which forgets its record (`forget`); on the
// website (no queue) the sheet is siteModify's.
export async function appPageAction(pkg, source, { queue = appQueue, ask = showActionSheet, add = queueApp,
  mode = detectMode(), ready = async () => true, store = apps, version = null, signedOf = (id) => signedRecordOf(id, { mode }),
  forget = async (id) => removeInstall(await store(), id), siteInstall = siteInstallVersion, warn = originalWarning,
  iv = settings.ignoredVersions, tweaks = installTweaksChoice,
  forgetSigned = (s) => nativeBridge()?.call?.("signing.forget", { bundleId: s.bundleId }), body = null } = {}) {
  const app = pkg?.stanza?.ipa;
  // B372: an app whose forget is held reads as not installed; installing it again cancels the held forget first, so the
  // page being left doesn't forget the new install
  const held = forgetHeld(app?.bundleIdentifier);
  if (mode === "site" && app && !version) {
    if (held) { cancelHeldForget(app.bundleIdentifier); return false; } // Install: signed in the browser, as before
    return siteModify(pkg, source, { ask, store, forget, siteInstall, iv });
  }
  if (mode !== "sideload" || !app) return false; // F89: the website queues nothing
  let rec = null;
  const signed = held ? null : await Promise.resolve().then(() => signedOf(app.bundleIdentifier)).catch(() => null); // F91: Modify offers Re-sign
  if (!held) try { rec = recordOf(await (await store()).all(), app.bundleIdentifier, signed); } catch { /* no store */ } // B358
  const job = appJob(pkg, { installed: rec ? rec.version || null : null, version, source: source ? displayName(source) : null });
  if (!job || !(await ready())) return false;
  // F246: a fresh install (no record) asks F243's once-per-app question before it is queued; Cancel queues nothing.
  const addFresh = async () => {
    // F302a: the install popup, when the app has tweaks added or made for it: what goes in, Tweaks, Install
    if (!(await Promise.resolve().then(() => tweaks({ bundleId: job.id, name: job.name || app.name, version: job.version || "", ask })).catch(() => true))) return true;
    const j = rec ? job : await queueOriginalCheck(job, warn);
    if (j && held) cancelHeldForget(app.bundleIdentifier); // B372
    if (j) add(j, { queue });
    return true;
  };
  if (version) return addFresh();
  const newest = app.versions[0]?.version ?? null;
  // B358: signed by iFizBox with no record matching the source's entry: installed all the same
  const installed = rec ? rec.version || "" : signed ? signed.version || "" : null;
  const older = installed ? app.versions.map((x) => x.version).filter((v) => v && compareVersions(v, installed) < 0) : [];
  // F221: marked as installed (no signature of iFizBox's): Re-sign while the source still has the installed version
  const onSource = !signed && Boolean(markedVersionOnSource(pkg, installed));
  // B358: a Re-sign is queued under the installed bundle ID, which a custom one makes another than the source's
  const queuedId = queue.get(job.id) ? job.id : signed?.bundleId && queue.get(signed.bundleId) ? signed.bundleId : null;
  const state = { queued: Boolean(queuedId), installed, newest, older: older.length > 0, signed: Boolean(signed), onSource, build: "sideload" };
  if (!state.queued && installed == null && !state.signed) return addFresh();
  // Modify (installed or queued), as Cydia's: Upgrade/Reinstall, Downgrade (then which version), or Clear.
  const ver = versionButtonOf(modifyActions(state), { id: job.id, installed, newest, iv: state.queued ? null : iv });
  const { buttons } = ver;
  const i = await ask({ title: app.name, buttons, destructive: redWith(buttons, destructiveOf(buttons)) });
  if (i < 0) return true;
  if (ver.run(buttons[i])) return true;
  if (buttons[i] === "Clear") queue.clear(queuedId ?? job.id);
  else if (buttons[i] === MARK_NOT_INSTALLED) {
    // B358: iFizBox's signature goes too, or the app still reads as installed (Installed's Remove from List does both)
    const run = async () => {
      if (signed) await Promise.resolve().then(() => forgetSigned(signed)).catch(() => {});
      await Promise.resolve().then(() => forget(rec?.id ?? app.bundleIdentifier)).catch(() => {});
    };
    // B372: from the app page, held until the page is left (Mark as Installed meanwhile keeps the signature's expiry)
    const page = body ?? appPageOf(app.bundleIdentifier);
    if (page) holdForget(app.bundleIdentifier, run, page);
    else await run();
  }
  // B358: signing.resign finds the app by the bundle ID it is installed under (a custom one too), not the source's
  else if (buttons[i] === "Re-sign" && signed) add({ ...resignJob(signed), id: signed.bundleId || job.id, icon: job.icon }, { queue });
  else if (buttons[i] === "Re-sign") { // F221
    const r = markedResignJob(pkg, installed, { source: source ? displayName(source) : null });
    if (r) add(r, { queue });
  }
  else if (buttons[i] === "Downgrade") {
    const j = await ask({ title: "Downgrade to", buttons: older });
    const pick = j >= 0 ? appJob(pkg, { installed, version: older[j], source: source ? displayName(source) : null }) : null;
    if (pick) add(pick, { queue });
  } else add(job, { queue });
  return true;
}

// F246: F243's original-app warning (signing-client.js originalWarning) for a job the app page is about to queue.
// -> the job as it goes in (Install a Copy: options.edits.keepBundleId false, the old way, a copy beside the
// original), or null for Cancel. A failing check queues the job as it was.
export async function queueOriginalCheck(job, warn = originalWarning) {
  if (!job) return job;
  const choice = await Promise.resolve().then(() => warn({ bundleId: job.id, name: job.name || "" })).catch(() => "install");
  if (choice === "cancel") return null;
  if (choice !== "copy") return job;
  const edits = { ...(job.options?.edits ?? {}), keepBundleId: false };
  return { ...job, options: { ...(job.options ?? {}), edits } };
}

// B69: the jailbreak app's Modify for an installed app (a record in core/installed.js, as the nav label reads it):
// Cydia's sheet instead of installing at once. Upgrade or Reinstall, Ignore Upgrades (Settings' Ignored Upgrades,
// kept on the device: no dpkg hold for an app) while a newer version is out or once it's ignored, Remove (red: the
// Installed tab's Delete, which asks again), Downgrade (then which version) and Version History. `install(version)`
// installs one of the app's versions (browse.js: the helper's Install row), `history()` opens Version History (null:
// no row). Resolves false when the app isn't installed (Install keeps its one tap), true once the sheet took over.
export const IGNORE_UPGRADES = "Ignore Upgrades";
export const STOP_IGNORING = "Stop Ignoring Upgrades";
export function jailbreakModifyButtons({ installed = "", newest = null, held = false, older = false, history = false } = {}) {
  const upgrade = Boolean(newest && installed && compareVersions(newest, installed) > 0);
  return [...modifyActions({ installed, newest, build: "jailbreak" }).filter((b) => b !== "Remove"),
    ...(held ? [STOP_IGNORING] : upgrade ? [IGNORE_UPGRADES] : []), "Remove",
    ...(older ? ["Downgrade"] : []), ...(history ? ["Version History"] : [])];
}

// F281: Ignore This Version / Stop Ignoring This Version (core/appupdates.js) on an app's sheet, after Upgrade.
// -> { buttons, run(label) -> true when it was that button }. `iv`: core/settings.js ignoredVersions.
export function versionButtonOf(buttons, { id, installed, newest, held = false, iv = settings.ignoredVersions } = {}) {
  const label = id && iv ? ignoreVersionLabel({ installed, newest, ignored: iv?.get?.(id) ?? null, held }) : null;
  return {
    buttons: withVersionButton(buttons, label),
    run(b) {
      if (!label || b !== label) return false;
      iv.set(id, versionToStore(label, newest));
      return true;
    },
  };
}
const redWith = (buttons, more) => (buttons.includes(IGNORE_VERSION)
  ? [...[].concat(more), buttons.indexOf(IGNORE_VERSION)].filter((i) => i >= 0) : more);

export async function jailbreakModify(pkg, { install, history = null, ask = showActionSheet, store = apps, holds = settings.holds,
  remove = removeAppFromPhone, iv = settings.ignoredVersions } = {}) {
  const app = pkg?.stanza?.ipa;
  if (!app) return false;
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  if (!rec) return false;
  const installed = rec.version || "";
  const versions = app.versions.filter((x) => x?.version);
  const newest = versions[0]?.version ?? null;
  const older = installed ? versions.filter((x) => compareVersions(x.version, installed) < 0) : [];
  const held = holds.has(app.bundleIdentifier);
  const ver = versionButtonOf(jailbreakModifyButtons({ installed, newest, held, older: older.length > 0, history: Boolean(history) && versions.length > 1 }),
    { id: app.bundleIdentifier, installed, newest, held, iv });
  const { buttons } = ver;
  const i = await ask({ title: app.name, buttons, destructive: redWith(buttons, [buttons.indexOf(IGNORE_UPGRADES), buttons.indexOf("Remove")]) });
  if (i < 0) return true;
  const b = buttons[i];
  if (ver.run(b)) return true;
  if (b === "Upgrade" || b === "Install") await install(versions[0]);
  else if (b === "Reinstall") await install(versions.find((x) => x.version === installed) ?? versions[0]);
  else if (b === IGNORE_UPGRADES || b === STOP_IGNORING) await holds.set(app.bundleIdentifier, b === IGNORE_UPGRADES, { dpkg: false });
  else if (b === "Remove") await remove({ id: app.bundleIdentifier, name: app.name || rec.name || app.bundleIdentifier });
  else if (b === "Downgrade") {
    const j = await ask({ title: "Downgrade to", buttons: older.map((x) => x.version) });
    if (j >= 0) await install(older[j]);
  } else if (b === "Version History") history();
  return true;
}

// B69: Remove from the Modify sheet: the Installed tab's Delete (B46: the helper uninstalls the app behind a HUD once the
// sheet is confirmed; a record of an app that is gone is only forgotten).
async function removeAppFromPhone({ id, name }) {
  const [{ rememberedApps }, { confirmDelete }] = await Promise.all([import("../app-updates.js"), import("./installed.js")]);
  let r = null;
  try { r = (await rememberedApps({ mode: "jailbreak" })).find((x) => x?.id === id) ?? null; } catch { /* no records */ }
  await confirmDelete(r ?? { id, name }, { mode: "jailbreak" });
}

// F94: the website's Modify, for an app marked installed (core/installed.js's record): Upgrade or Reinstall resolve
// false, so the caller installs the newest as before (browse.js packageActions: the browser signs it); Downgrade asks
// which version and installs that one (`siteInstall`); Mark as Not Installed forgets the record. Not installed: false.
async function siteModify(pkg, source, { ask, store, forget, siteInstall, iv = settings.ignoredVersions }) {
  const app = pkg.stanza.ipa;
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  if (!rec) return false;
  const installed = rec.version || "";
  const newest = app.versions[0]?.version ?? null;
  const older = installed ? app.versions.filter((x) => x.version && compareVersions(x.version, installed) < 0) : [];
  const same = markedVersionOnSource(pkg, installed); // F221: Re-sign signs the installed version again in the browser
  const ver = versionButtonOf(modifyActions({ installed, newest, older: older.length > 0, onSource: Boolean(same), build: "site" }),
    { id: app.bundleIdentifier, installed, newest, iv });
  const { buttons } = ver;
  const i = await ask({ title: app.name, buttons, destructive: redWith(buttons, destructiveOf(buttons)) });
  if (i < 0) return true;
  if (ver.run(buttons[i])) return true;
  if (buttons[i] === MARK_NOT_INSTALLED) { await Promise.resolve().then(() => forget(app.bundleIdentifier)).catch(() => {}); return true; }
  if (buttons[i] === "Re-sign") { await siteInstall(pkg, same, source); return true; }
  if (buttons[i] === "Downgrade") {
    const j = await ask({ title: "Downgrade to", buttons: older.map((x) => x.version) });
    if (j >= 0) await siteInstall(pkg, older[j], source);
    return true;
  }
  return false;
}

// The website's Install of one version (installRows' first row: signed in the browser, or the source's own link),
// recorded once it installs, as browse.js recordApp does.
async function siteInstallVersion(pkg, v, source) {
  const app = pkg.stanza.ipa;
  const record = () => apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
    source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  const { rows, gated } = installRows(v, app.sourceUrl, undefined, record, null, app.name, { appId: pkg.row?.id ?? pkg.stanza.package,
    bundleId: appBundleId(app, pkg.row?.id), iconUrl: app.iconURL });
  // F96: once website installs are accepted the downgrade signs here; until then it's Install in iFizBox.
  const first = gated && websiteInstallsOn() ? rows.find((r) => r.label === "Install on the Website") : rows[0];
  if (first && first.label !== "Download IPA") return first.onClick();
}

// F84: the app page's Custom Install, where the phone signs: the options sheet (signing-sheet.js customInstall), whose
// Install queues the app with those options (kept on the job) and opens Confirm, as Install does. Elsewhere (no job:
// a source-signed link; not the sideload app) it signs straight away as F81's did. `opts` is installRows' { url,
// name, onInstalled }. -> what customInstall resolved. F85: `version` (Version History's row) queues that version.
export async function appPageCustom(pkg, source, opts, { queue = appQueue, add = queueApp, mode = detectMode(), store = apps, version = null,
  custom = async (o) => (await import("../signing-sheet.js")).customInstall(o) } = {}) {
  const app = pkg?.stanza?.ipa;
  let job = null;
  if (app && mode === "sideload") {
    let rec = null;
    try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
    job = appJob(pkg, { installed: rec ? rec.version || null : null, version, source: source ? displayName(source) : null });
  }
  if (!job) return custom(opts);
  return custom({ url: job.url, name: opts?.name || job.name || "", queue: (options) => add({ ...job, options }, { queue }) });
}

// The website's Install group (F93: it signs in the browser; F92: only Install and Download IPA).
export const SITE_INSTALL_SUBTITLE = "Signed in the browser with your certificate";
export const SITE_INSTALL_FOOTER = "Install signs the app here in the browser with your certificate (Settings > Signing).";

// F314: the app page's Install rows in the iOS 6 hint style (AGENTS.md, Hints): one or two short sentences under the
// rows they explain, never joined. The install rows (Install, Custom Install) get one footer, Download IPA a group of
// its own with none; on the website's gate (websign-gate.js siteGateRows: Install in NAME, Download IPA, Install on
// the Website) Install on the Website gets its own group too, with the slow note that only the site has.
export const LOCAL_INSTALL_FOOTER = "Signed with your certificate on this iPhone.";
export const ITMS_FOOTER = "Installs over the air with the source's signed link.";
export const GATE_FOOTER = `Opens in the ${NAME} app, which signs and installs it.`;
export const SITE_SLOW_FOOTER = "Signs here in the browser: slower, and can fail on big apps.";
export function installSections(rows, { gated = false, itms = false, jailbreak = false, local = false, download = true } = {}) {
  const isDownload = (r) => r.label === "Download IPA";
  if (gated) {
    return rows.map((r, i) => (i === 0 ? { header: "Install", rows: [r], footer: GATE_FOOTER }
      : isDownload(r) ? { rows: [r] } : { rows: [r], footer: SITE_SLOW_FOOTER }));
  }
  const footer = jailbreak ? IPA_FOOTER : itms ? ITMS_FOOTER : local ? LOCAL_INSTALL_FOOTER : download ? SITE_INSTALL_FOOTER : null;
  const keep = rows.filter(isDownload);
  return [{ header: "Install", rows: rows.filter((r) => !isDownload(r)), footer }, ...(keep.length ? [{ rows: keep }] : [])];
}

// F314: Information's hints, each under the rows it explains: past the website's size cap (F257) the rows through
// Size form the first group with TOO_BIG_FOOTER, the rest (Compatibility among them) the next with the fit detail.
export function infoSections(info, { fitDetail = null, tooBig = false } = {}) {
  const cut = tooBig ? info.findIndex((r) => r.label === "Size") + 1 : 0;
  if (!cut) return [{ header: "Information", rows: info, footer: fitDetail || null }];
  return [{ header: "Information", rows: info.slice(0, cut), footer: TOO_BIG_FOOTER },
    ...(info.length > cut ? [{ rows: info.slice(cut), footer: fitDetail || null }] : [])];
}
// F95: My IPAs' website Install (screens/myipas.js siteInstallSheet) still says the certificate is needed, with
// Download IPA beside OK.
export const SITE_CERT_TITLE = "Certificate Needed";
const SITE_CERT_MESSAGE = "Installing from the website signs the app with your own certificate in the browser. "
  + "That isn't here yet: Download IPA keeps the file for now.";

// The certificate alert, with Download IPA beside OK. -> whether it downloaded.
export async function siteCertificateAlert({ download = () => {}, alert = showAlert } = {}) {
  const { index } = await alert({ title: SITE_CERT_TITLE, message: SITE_CERT_MESSAGE, buttons: ["OK", "Download IPA"], cancel: 0 });
  if (index !== 1) return false;
  download();
  return true;
}

// F181: the iOS 6 App Store's page (screens/storepage.js): the header, then Details / Reviews / Related. `related`
// fills the Related tab (browse.js relatedPane); the Details pane is returned for what the caller adds to it.
// F350: Details in Cydia's style (screens/details.js): Add Tweaks with its tile, Preview, the description's dashed box,
// More Information (a long text, What's New, Permissions), Version with CHANGE (`onChange`: Install Which Version?)
// and Version History, Information with tiles, the install groups, Links with globe tiles, then `tail` (the caller's
// Wish List and Installed App) and the centred footer. -> { details, tabs, tail }
export function renderApp(body, route, pkg, source, { related = null, onChange = null } = {}) {
  const st = pkg.stanza;
  const app = st.ipa;
  const v = app.versions[0];
  const page = el("div", "alt-app");
  if (app.tintColor) page.style.setProperty("--alt-tint", app.tintColor);

  // Header: the large glossy icon, name, developer, the App Store's stars once known, "Version · size · Free".
  const icon = el("span", "pkg-icon large alt-app-icon");
  icon.append(el("span", "pkg-letter", app.name.charAt(0).toUpperCase()));
  const i = img(app.iconURL);
  if (i) { i.onload = () => i.classList.add("loaded"); icon.append(i); }
  // F160: no iOS range from the source: what the IPA itself said, kept on this device, else asked below (once).
  const ipaStore = localStore();
  // B74: the source's range is used too, unless the IPA's own MinimumOSVersion (read before) is higher.
  const keptAny = savedInfo(ipaStore, v.downloadURL);
  const keptInfo = needsCheck(v) || ipaRaises(v, keptAny) ? keptAny : null;
  let raised = ipaRaises(v, keptInfo);
  const fit = compat(keptInfo ? withIpaInfo(st, keptInfo) : st, currentDevice());
  const size = formatSize(v.size);
  const tooBig = siteTooBigApp(v); // F257: the website can't sign it (its listed size is over the cap)
  const sourceName = app.sourceName || (source ? displayName(source) : "") || app.sourceUrl;
  // F194: Share sits on the header, where the App Store's install button was (the nav bar keeps Install / Modify).
  const header = storeHeader({ art: icon, name: app.name, author: app.developerName || null,
    action: headerShareButton(source ?? { key: pkg.key }, { app: true }),
    line: headerLine({ version: `${v.version}${v.buildVersion ? ` (${v.buildVersion})` : ""}`, size, price: "Free" }) });
  page.append(header.head);

  const reviewApi = getBackend().reviews ?? reviewsApi({ base: reviewsBase(detectMode()) }); // F182
  const reviewId = appBundleId(app, pkg.row?.id);
  const oursFirst = reviewApi.list(reviewId, 0).catch(() => null);
  let storeRating = null; // F161: the App Store's average and count (core/applookup.js), once looked up
  let ratingKnown;
  const ratingReady = new Promise((res) => { ratingKnown = res; });
  const tabs = storeTabs({
    // F182: reviews written here (screens/reviews.js). B82: This Build | App Store, never averaged; the App Store's
    // written reviews are asked for only when its view first opens.
    reviews: (pane) => reviewsTab(pane, { id: reviewId, version: v.version ?? "", build: true, appStore: appStoreTab(ratingReady, looked), first: oursFirst, api: reviewApi,
      malicious: () => reportMalicious({ id: reviewId, version: v.version ?? "", name: app.name }), // F291
      onRating: (r) => header.setRating(r) }),
    related,
  });
  const details = tabs.panes.details;
  body.replaceChildren(page, ...tabs.nodes);

  // F161: the App Store's details by bundle ID (core/applookup.js), only now that the page is open; none when the
  // source already gives screenshots, developer and the app's own page.
  const ownLinks = ownPageLinks(app, appLinks(app));
  const need = lookupNeed(app, ownLinks);
  // B37: asked whatever `need` is, for the App Store's rating and reviews (need only gates the other details).
  const looked = storeLookup(appBundleId(app, pkg.row?.id));
  const merged = looked.then((store) => mergeDetails(app, store, need));
  merged.then((m) => {
    if (m.developer && !app.developerName) header.setAuthor(m.developer); // F161: the App Store's, when the source names none
    if (m.rating != null) storeRating = { average: m.rating, count: m.ratingCount ?? null, noun: "Ratings" };
    ratingKnown(storeRating);
  }, () => ratingKnown(null));
  // B82: the header stars: this build's when anyone rated it here, else the App Store's (marked "on the App Store");
  // never the two averaged. Drawn once both are known, so they don't flip from one to the other.
  Promise.all([ratingReady, oursFirst]).then(([store, ours]) => header.setRating(pageRating({ ours, appStore: store })));

  // F122: the source's screenshots, or (when it lists none) its GitHub repo's README and release pictures.
  // F161: when the source lists none, the App Store's screenshots come before the GitHub ones.
  // F302a: Add Tweaks, directly under the header's Install and above the screenshots (the sideload build)
  // (imported up front, so the row is there with the page and doesn't pop in; its count fills in when known)
  // F350: with its tile, and no footer naming every tweak (user 2026-11-21): the row's own detail says how many.
  const rowsPlan = appRows({ sideload: detectMode() === "sideload", bundleId: app.bundleIdentifier, versions: app.versions.length,
    version: `${v.version}${v.buildVersion ? ` (${v.buildVersion})` : ""}` });
  // F376: an update is out for this app: What's New in the newest version at the very top of Details.
  details.append(updateNewsSlot(app, { href: deeper(route, `versions:${pkg.row.id}`) }, { alive: () => body.isConnected }));
  if (rowsPlan.addTweaks) {
    const tw = addTweaksGroup({ bundleId: app.bundleIdentifier, name: app.name }).el;
    tw.querySelector(".group-footer")?.remove();
    details.append(tileCells(tw, "pkgTweaks"));
  }
  const previewKey = `app:${pkg.key}:${pkg.row?.id ?? app.bundleIdentifier}`;
  const shots = altShots(app);
  if (shots.length || need !== "full") details.append(previewSlot(previewKey, { shots, gh: appGithub(app) }));
  else { // B54: the loading strip while the App Store answers, not an empty slot swapped later
    details.append(previewSlot(previewKey, merged.then((m) => ({ shots: m.screenshots.map((url) => ({ url, from: "appstore" })), gh: appGithub(app) }))));
  }

  // F350: the description in Cydia's dashed box, its first lines (the App Store's when the source has none, F161);
  // More Information has the whole text, What's New and Permissions.
  const perm = app.permissions ?? { privacy: [], entitlements: [] };
  const nPerm = perm.privacy.length + perm.entitlements.length;
  const descSlot = el("div");
  const moreSlot = el("div");
  details.append(descSlot, moreSlot);
  const showMore = () => moreSlot.replaceChildren(grouped([{ rows: [{ label: MORE_INFO_LABEL, icon: rowIcon("pkgMore"),
    href: deeper(route, `info:${pkg.row.id}`) }] }]));
  const drawText = (text) => {
    descSlot.replaceChildren(...(text ? [descGroup(text, { onOverflow: () => { if (!moreSlot.firstChild) showMore(); } })] : []));
    if (moreInfoShown({ text, whatsNew: Boolean(v.localizedDescription), permissions: nPerm })) showMore();
    else moreSlot.replaceChildren();
  };
  drawText(app.localizedDescription || "");
  if (!app.localizedDescription) merged.then((m) => { if (m.description && body.isConnected) drawText(m.description); });

  // Version with CHANGE (Install Which Version?), and Version History (F29: its own page, browse.js renderVersions,
  // every versions[] entry, older ones installable).
  const versionBox = grouped([{ header: "Version", rows: detailRows(rowsPlan.version, {
    history: { href: deeper(route, `versions:${pkg.row.id}`) } }), footer: v.date ? `Updated ${formatDate(v.date)}` : null }]).firstElementChild;
  if (onChange) changeButton(versionBox, onChange, { disabled: !rowsPlan.change });
  details.append(versionBox);

  // F161: Information is drawn again once the App Store's facts are in (developer, category, its version and iOS).
  // F160: and once the IPA has been read (Compatibility: what it says, and where that came from).
  const detailsBox = el("div");
  let lastStore = {};
  let lastFit = fit;
  let ipaRow = keptInfo ? ipaCompatText(withIpaInfo(v, keptInfo), keptInfo) : needsCheck(v) ? "Checking…" : null;
  const drawDetails = (m = lastStore) => {
    lastStore = m;
    // F350: each row with its tile. Works On: B74's IPA range when the IPA needs more than the source says.
    const worksOn = (raised && ipaRow) || osRange(v) || ipaRow || lastFit.range || "";
    const info = detailRows(appRows({ bundleId: app.bundleIdentifier, source: sourceName, category: m.category || pkg.row.section,
      worksOn, size, tooBig, storeVersion: m.version || null,
      storeRequires: m.minimumOs ? `iOS ${m.minimumOs} or later` : null }).info, { // F257: Size red past the website's cap
      source: route.tab === "sources" && route.path[0] === pkg.key ? {} : { href: format({ tab: "sources", path: [pkg.key] }) } });
    detailsBox.replaceChildren(grouped(infoSections(info, { fitDetail: lastFit.detail, tooBig })));
  };
  drawDetails();
  details.append(detailsBox);
  merged.then(drawDetails);
  const drawFit = (f) => {
    lastFit = f;
    drawDetails();
  };

  // F30: without a jailbreak (the site, the sideload build) nothing can ask the phone what it has, so tapping an
  // install row records the app on the device for the Installed tab. F88: the jailbreak app records it too, once the
  // helper's install succeeds (dpkg doesn't list IPAs); I4's real version (backend.installedApps) then corrects it.
  const record = () => {
    apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
      source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  };
  // F291: Where It Comes From (the source's trust label, public source code, reports), right above Install; a version
  // enough devices reported as malicious gets the red card at the top of Details.
  const where = whereFromGroup({ source, sourceName: app.sourceName || (source ? displayName(source) : ""), sourceUrl: app.sourceUrl,
    github: appGithub(app) });
  details.append(where.node);
  reports().summary(reviewId, v.version ?? "").then((s) => {
    if (!body.isConnected) return;
    where.setReports(s);
    const card = reportBanner(s);
    if (card) details.prepend(card);
  }, () => {});
  const queued = detectMode() !== "jailbreak"; // the app queue (F80) and Custom Install (F84) aren't in the jailbreak build
  const { rows, options, gated } = installRows(v, app.sourceUrl, undefined, record, queued ? () => appPageAction(pkg, source) : null, app.name,
    { ...(queued ? { customize: (o) => appPageCustom(pkg, source, o) } : {}), appId: pkg.row?.id ?? st.package ?? app.bundleIdentifier,
      bundleId: appBundleId(app, pkg.row?.id), iconUrl: app.iconURL });
  const installGroup = grouped(installSections(rows, { gated, itms: Boolean(options.itms),
    jailbreak: Boolean(options.download && ipaInstallAvailable()), local: localSigning(), download: Boolean(options.download) }));
  const installBox = installGroup.firstElementChild; // grouped() gives a fragment, empty once appended
  details.append(installGroup);
  // B72: the IPA's own MinimumOSVersion (the source's can be wrong) on the jailbreak Install row
  if (options.download && ipaInstallAvailable()) markIpaNeeds(installBox, options.download);

  // Mark as Installed: an app installed some other way (Feather, AltStore, another device's backup) can be put on
  // the Installed list by hand, so Changes and the update checks follow it; Mark as Not Installed takes it off.
  // F242: not in the jailbreak app, which can tell what's installed: there the section only shows the installed version.
  appPageBodies.set(app.bundleIdentifier, body); // B372: Modify's Mark as Not Installed holds its forget on this page
  const tracking = trackingSection(app, pkg, source, body);
  details.append(tracking);
  // F210: and the same in one tap from the nav bar (sideload and site only, F242).
  if (markToggleApplies(app)) {
    // B338: the page follows at once; B372: the forget waits until the page is left
    const toggle = markToggle(app, pkg, source, { after: () => tracking.redraw(), body });
    if (!addNavIcon(body, toggle, "mark")) setTimeout(() => addNavIcon(body, toggle, "mark"), 0);
    const offMark = onAppsChange(() => { if (body.isConnected && toggle.isConnected) toggle.refresh(); else offMark(); });
    const offHeld = onHeldForget(() => { if (body.isConnected && toggle.isConnected) toggle.refresh(); else if (!body.isConnected) offHeld(); });
  }
  // F242a: the jailbreak build puts a queue toggle there instead, following the app queue while the page is up.
  if (queueToggleApplies(app) && appJob(pkg)) {
    const toggle = queueToggle(pkg, source);
    if (!addNavIcon(body, toggle, "queue")) setTimeout(() => addNavIcon(body, toggle, "queue"), 0);
    let placed = false;
    const offQueue = appQueue.subscribe(() => {
      if (toggle.isConnected) { placed = true; toggle.refresh(); } else if (placed) offQueue(); // the page is gone
    });
  }

  if (needsCheck(v) && !keptInfo) {
    const bundleId = appBundleId(app, pkg.row?.id);
    ipaCheck(v.downloadURL, { store: ipaStore, text: [app.subtitle, app.localizedDescription, v.localizedDescription].filter(Boolean).join("\n"),
      fallback: () => (need === "none" ? storeLookup(bundleId) : looked).then((m) => m?.minimumOs ?? null) })
      .then((info) => {
        if (!body.isConnected) return;
        if (!info) { ipaRow = null; drawDetails(); return; }
        ipaRow = ipaCompatText(withIpaInfo(v, info), info);
        drawDetails();
        drawFit(compat(withIpaInfo(st, info), currentDevice()));
        catalog.setIpaInfo({ [v.downloadURL]: info }); // the rows follow (core/catalog.js setIpaInfo)
      }, () => {});
  } else if (!needsCheck(v) && !keptAny && ipaInfoUrl(v.downloadURL)) {
    // B74: the source gives a range, but it can be too low: the IPA itself is asked (only its own answer counts, no
    // App Store or description guess; the same question as the jailbreak Install row's, asked once per IPA).
    ipaCheck(v.downloadURL, { store: ipaStore })
      .then((info) => {
        if (!body.isConnected || !ipaRaises(v, info)) return;
        raised = true;
        ipaRow = ipaCompatText(withIpaInfo(v, info), info);
        drawFit(compat(withIpaInfo(st, info), currentDevice()));
        catalog.setIpaInfo({ [v.downloadURL]: info });
      }, () => {});
  }

  // Links (F161, after F122): this app's own page (its GitHub or website, else the App Store), then the source's page
  // in iFizBox, then the source's website when it is another page. Never two rows to one page (core/applookup.js).
  const sourceRow = { label: sourceName, subtitle: app.sourceUrl, icon: rowIcon("sources"),
    href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) };
  const linksBox = el("div");
  const drawLinks = (store, sourceWebsite) => linksBox.replaceChildren(appLinksGroup(pageLinks({ ownLinks, store, source: sourceRow,
    sourceWebsite, appUrls: [app.sourceUrl] })));
  drawLinks(null, null);
  details.append(linksBox);
  Promise.all([looked, catalog.altSource(pkg.key).then((m) => m?.website ?? null, () => null)])
    .then(([store, site]) => drawLinks(store, site), () => {});
  // F350: the caller's rows (Wish List, Installed App) go in `tail`, above the centred footer.
  const tail = el("div", "alt-app-tail");
  details.append(tail, footerGroup(detailsFooter(app.bundleIdentifier, sourceName, pkg.row.section)));
  return { details, tabs, tail };
}

// F350: an app's More Information: the whole description in the dashed box (the App Store's when the source has
// none, F161), What's New in the newest version with its date, and every Permission the source lists.
export const PERMISSIONS_FOOTER = "What this app asks for, as its source lists it.";
export function permissionRows(app) {
  const perm = app.permissions ?? { privacy: [], entitlements: [] };
  return [...perm.privacy.map((p) => ({ label: p.name, subtitle: p.description || null })),
    ...perm.entitlements.map((e) => ({ label: entitlementLabel(e.name), subtitle: e.description || e.name }))];
}
export function appInfoNodes(app, { lookup = (id) => storeLookup(id) } = {}) {
  const v = app.versions[0] ?? {};
  const out = [];
  if (app.localizedDescription) out.push(descGroup(app.localizedDescription, { full: true }));
  else if (app.bundleIdentifier) {
    const slot = el("div");
    out.push(slot);
    Promise.resolve(lookup(app.bundleIdentifier)).then((m) => { if (m?.description) slot.replaceChildren(descGroup(m.description, { full: true })); }, () => {});
  }
  const news = v.localizedDescription ? whatsNewGroup({ version: v.version, date: formatDate(v.date), notes: v.localizedDescription }) : null;
  if (news) out.push(news);
  const rows = permissionRows(app);
  if (rows.length) out.push(grouped([{ header: "Permissions", rows, footer: PERMISSIONS_FOOTER }]).firstElementChild);
  return out;
}

// F376: the update's What's New on top of an app's Details. Shown only when the app's installed record (core/installed.js
// apps()) is older than the newest version on the source and that version has notes; More Information keeps its own.
export function updateNewsShown(app, installedVersion) {
  const v = app?.versions?.[0];
  const have = installedVersion == null ? "" : String(installedVersion);
  return Boolean(v?.version && String(v.localizedDescription ?? "").trim() && have.trim() && compareVersions(String(v.version), have) > 0);
}
export function updateNewsGroup(app, record, history = null) {
  if (!record || record.id !== app?.bundleIdentifier || !updateNewsShown(app, record.version)) return null;
  const v = app.versions[0];
  return whatsNewGroup({ version: v.version, date: formatDate(v.date), notes: v.localizedDescription,
    history: history ? { label: "Version History", ...history } : null });
}
// The slot, filled once the installed list is read and again whenever it changes (Mark as Installed, an install).
export function updateNewsSlot(app, history = null, { store = apps, onChange = onAppsChange, alive = () => true } = {}) {
  const slot = el("div", "alt-update-news");
  const draw = () => Promise.resolve().then(store).then((s) => s.all()).then((list) => {
    const card = updateNewsGroup(app, (list ?? []).find((r) => r?.id === app.bundleIdentifier) ?? null, history);
    if (!card && !slot.firstChild) return;
    slideChange(slot, () => slot.replaceChildren(...(card ? [card] : [])));
  }, () => {});
  slot.drawn = draw();
  const off = onChange?.(() => { if (alive()) slot.drawn = draw(); else off?.(); });
  return slot;
}

// F161: an app's App Store details on this device: the website asks the Worker (/api/applookup, cached at the edge),
// the app asks Apple itself; cached a week per bundle ID (core/applookup.js lookupApp). Null when it fails.
export function storeLookup(bundleId, { backend = getBackend(), fetchFn = globalThis.fetch,
  locale = globalThis.navigator?.language, store = globalThis.localStorage ?? null } = {}) {
  const get = backend.kind === "http"
    ? (id, c) => fetchFn(workerLookupUrl(id, c)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    : (id, c) => backend.text(lookupUrl(id, c));
  return lookupApp(bundleId, { country: regionOf(locale), get, store }).catch(() => null);
}

// B37: the App Store's recent written reviews for a looked-up app: the website asks the Worker (/api/appreviews,
// cached at the edge a day), the app asks Apple itself (core/applookup.js storeReviews). [] when it fails.
export function appStoreReviews(store, { backend = getBackend(), fetchFn = globalThis.fetch, locale = globalThis.navigator?.language } = {}) {
  const id = storeTrackId(store);
  if (!id) return Promise.resolve([]);
  const get = backend.kind === "http"
    ? (t, c) => fetchFn(workerReviewsUrl(t, c)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
    : (t, c) => backend.text(reviewsFeedUrl(t, c));
  return storeReviews(id, { country: regionOf(locale), get }).catch(() => []);
}

// B37: the Reviews tab's appStore: the App Store's rating (ratingReady) with its written reviews, or null.
export function withStoreReviews(ratingReady, looked, opts = {}) {
  const list = Promise.resolve(looked).then((s) => (s ? appStoreReviews(s, opts) : []), () => []);
  return Promise.all([Promise.resolve(ratingReady).catch(() => null), list])
    .then(([r, reviews]) => (r || reviews.length ? { ...(r ?? {}), reviews } : null));
}

// B82: the Reviews tab's App Store view: Apple's rating (ratingReady), the app's App Store name and seller, and its
// written reviews as a function, asked only when the view first opens. Null when the App Store doesn't have the app
// (the tab then shows This Build alone, no toggle).
export function appStoreTab(ratingReady, looked, opts = {}) {
  return Promise.all([Promise.resolve(ratingReady).catch(() => null), Promise.resolve(looked).catch(() => null)])
    .then(([r, s]) => (s ? { ...(r ?? {}), name: s.trackName || null, seller: s.developer || null, reviews: () => appStoreReviews(s, opts) } : null));
}

// F160: localStorage, or null where it's blocked.
function localStore() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// F160: read an IPA's Info.plist through the Worker's /api/ipainfo (core/ipainfo.js checkIpa): the website asks its
// own origin, the app asks PUBLIC_SITE (the Worker answers any origin). The answer's JSON, error codes included.
export function ipaCheck(url, { backend = getBackend(), fetchFn = globalThis.fetch, store = null, text = "", fallback = null } = {}) {
  const get = (u) => fetchFn(ipaInfoUrl(u, backend.kind === "http" ? "" : PUBLIC_SITE)).then((r) => r.json());
  return checkIpa(url, { get, store, text, fallback }).catch(() => null);
}

// F160: the Details row for a range the IPA (or a fallback) gave: "iOS 15.0 or later (from the app)", "iPad only".
function ipaCompatText(v, info) {
  const where = { ipa: "from the app", appstore: "App Store", text: "from its description" }[info.from];
  const fam = Array.isArray(info.deviceFamily) && info.deviceFamily.length && !info.deviceFamily.includes(1) ? "iPad only" : null;
  const range = osRange(v);
  if (!range && !fam) return "Not known";
  return [fam, range].filter(Boolean).join(", ") + (where && range ? ` (${where})` : "");
}

// F161: core/applookup.js pageLinks' rows as the Links group: a link row opens out, the source row opens its page.
// F350: the source isn't repeated here: it is Information's Source row on the Details page.
function appLinksGroup(links) {
  const rows = links.filter((l) => l.kind !== "source")
    .map((l) => ({ label: l.label, subtitle: l.detail || l.url, icon: rowIcon("pkgLink"), onClick: () => openOut(l.url), chevron: true }));
  if (!rows.length) return document.createDocumentFragment();
  const g = grouped([{ header: "Links", rows }]);
  g.firstElementChild?.classList.add("links-group");
  return g;
}

// ---- Links and the screenshots gallery (F122), shared with browse.js's package pages ---------------------------

// A link out opens in its own app or Safari (app.js's window.open in the Home Screen app, LinkOut in the shell).
const openOut = (url) => window.open(url, "_blank", "noopener");

// The Links group: `source` (a row opening the source's page, or null) and core/previews.js's links, in that order.
export function linksGroup(source, links) {
  const rows = [];
  if (source) rows.push({ ...source, chevron: true });
  for (const l of links) rows.push({ label: l.label, subtitle: l.detail || l.url, onClick: () => openOut(l.url), chevron: true });
  const g = grouped([{ header: "Links", rows }]);
  g.firstElementChild?.classList.add("links-group");
  return g;
}

// One picture of the gallery: sized by the source's width/height or, failing that, the picture's own; an https
// picture its host won't serve to us (hotlink rules) tries once more through the site's proxy.
// B54: it loads off the page (eager: a lazy picture outside the document never loads) and `i.ready` settles true
// once it has loaded and decoded, false when it failed for good or was an icon: only ready ones go on the page.
export function galleryImage(s, { backend = getBackend } = {}) {
  const src = mediaUrl(s.url);
  if (!src) return null;
  const i = el("img", "alt-shot");
  i.alt = "";
  i.decoding = "async";
  i.loading = "eager";
  i.referrerPolicy = "no-referrer";
  let settle;
  i.ready = new Promise((r) => { settle = r; });
  const ratio = (w, h) => {
    i.style.aspectRatio = `${w} / ${h}`;
    i.classList.toggle("wide", w > h);
  };
  if (s.width && s.height) ratio(s.width, s.height);
  i.onload = () => {
    if (i.naturalWidth && i.naturalWidth < 120 && i.naturalHeight < 120) { settle(false); return gone(i); } // an icon after all
    if (!(s.width && s.height) && i.naturalWidth && i.naturalHeight) ratio(i.naturalWidth, i.naturalHeight);
    const d = typeof i.decode === "function" ? i.decode() : null;
    if (d && typeof d.then === "function") d.then(() => settle(true), () => { settle(false); gone(i); });
    else settle(true);
  };
  let retried = false;
  i.onerror = () => {
    const b = backend();
    if (!retried && b.kind === "http" && b.assetUrl && /^https:/i.test(s.url)) { retried = true; i.src = b.assetUrl(s.url); return; }
    settle(false);
    gone(i);
  };
  i.src = src;
  return i;
}

function gone(i) {
  const group = i.closest(".shots-group");
  i.remove();
  if (group && !group.querySelector(".alt-shot")) group.remove();
}

// F181: the strip scrolls sideways, snapping one picture at a time, with page dots under it (one per picture; the
// one in view dark) and a tap on a picture zooms it to the full screen.
// B54: `pics0` are pictures already loaded (galleryImage's ready).
function galleryGroup(pics0) {
  const strip = el("div", "alt-shots");
  strip.append(...pics0);
  if (!strip.childElementCount) return null;
  const g = el("div", "group shots-group");
  const dots = el("div", "shot-dots");
  dots.setAttribute("aria-hidden", "true");
  g.append(el("h2", "group-header", PREVIEW_HEADER), strip, dots); // F350: not always screenshots
  const pics = () => [...strip.querySelectorAll(".alt-shot")];
  const drawDots = () => {
    const n = pics().length;
    if (dots.childElementCount !== n) dots.replaceChildren(...Array.from({ length: n }, () => el("span", "shot-dot")));
    dots.hidden = n < 2;
    markDot();
  };
  // The picture whose left edge is nearest the strip's: transform/opacity aren't touched, only a class on a 7px dot.
  let frame = 0;
  const markDot = () => {
    frame = 0;
    const list = pics();
    const x = strip.scrollLeft;
    let at = 0;
    list.forEach((p, i) => { if (Math.abs(p.offsetLeft - strip.offsetLeft - x) < Math.abs(list[at].offsetLeft - strip.offsetLeft - x)) at = i; });
    // The last one, at the end. B107: not while the strip is still detached (no width yet: 0 + 0 >= 0 - 2 would
    // light the last dot at open, and no scroll event follows to fix it).
    if (strip.clientWidth > 0 && strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2) at = list.length - 1;
    [...dots.children].forEach((d, i) => d.classList.toggle("on", i === at));
  };
  strip.addEventListener("scroll", () => { if (!frame && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(markDot); }, { passive: true });
  strip.addEventListener("click", (e) => {
    const pic = e.target?.closest?.(".alt-shot");
    if (pic) zoomShots(pics(), pics().indexOf(pic));
  });
  // Pictures that fail drop out (gone()): the dots follow.
  if (typeof MutationObserver === "function") new MutationObserver(drawDots).observe(strip, { childList: true });
  drawDots();
  return g;
}

// F181: tap-to-zoom. A black full-screen layer with the pictures at full size, sideways and snapping like the strip,
// opened on the one tapped: it grows out of the thumbnail (transform from its box) and fades in; a tap closes it the
// same way back. Transform and opacity only (120 Hz).
export function zoomShots(list, index = 0) {
  if (!list.length || typeof document === "undefined" || !document.body) return null;
  const layer = el("div", "shot-zoom");
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-label", PREVIEW_HEADER);
  const track = el("div", "shot-zoom-track");
  for (const p of list) {
    const page = el("div", "shot-zoom-page");
    const big = el("img", "shot-zoom-img");
    big.alt = "";
    big.decoding = "async";
    big.referrerPolicy = "no-referrer";
    big.src = p.currentSrc || p.src;
    page.append(big);
    track.append(page);
  }
  layer.append(track);
  document.body.append(layer);
  track.scrollLeft = index * track.clientWidth;
  const from = list[index]?.getBoundingClientRect?.();
  const to = track.children[index]?.firstElementChild?.getBoundingClientRect?.();
  const grow = from && to && to.width ? [
    { transform: `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width})` },
    { transform: "none" }] : [{ transform: "scale(.9)" }, { transform: "none" }];
  const img = track.children[index]?.firstElementChild;
  const ease = { duration: DURATION, easing: EASE };
  layer.animate?.([{ opacity: 0 }, { opacity: 1 }], ease);
  img?.animate?.(grow, ease);
  const close = () => {
    layer.removeEventListener("click", close);
    const fade = layer.animate?.([{ opacity: 1 }, { opacity: 0 }], { ...ease, fill: "forwards" });
    if (fade) fade.onfinish = () => layer.remove(); else layer.remove();
  };
  layer.addEventListener("click", close);
  return { layer, close };
}

// Text for core/previews.js: GitHub's raw and API hosts answer with CORS, so on the site the browser asks them
// itself (its own rate limit, not the proxy's shared one) and goes through the proxy only when that fails to connect.
export function previewText(url, { backend = getBackend(), fetchFn = globalThis.fetch } = {}) {
  if (backend.kind === "http" && fetchFn && /^https:\/\/(raw\.githubusercontent\.com|api\.github\.com)\//.test(url)) {
    return fetchFn(url, { headers: /api\.github/.test(url) ? { Accept: "application/vnd.github+json" } : {} }).then(
      (r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))),
      () => backend.text(url));
  }
  return backend.text(url);
}

// The gallery's place on a page, filled once the pictures are known (at once for a source's own; after a fetch for
// a depiction page's or a GitHub repo's, cached per app by core/previews.js).
// B54: it starts as a short loading strip (iOS 6's grey spinner, 44px: altstore.css .shots-loading) and never shows
// a blank picture frame: only pictures that loaded and decoded go in. Once the first is ready and the rest have
// settled (or settleMs passed), the slot grows once to the gallery's height (one height transition on the slot) and
// the gallery fades in; a picture that loads later joins the strip sideways. When none load the strip shrinks to
// nothing. `sources` may be a promise of them (an app page waiting for the App Store's screenshots), or null.
// slot.gallery settles when every picture has: { shown, grows } (pictures on the page, height changes made).
export function previewSlot(key, sources, { load = loadPreviews, text = previewText, image = galleryImage, settleMs = 1200 } = {}) {
  const slot = el("div", "preview-slot");
  const pending = typeof sources?.then === "function";
  if (!pending && !sources?.shots?.length && !sources?.html && !sources?.gh) {
    slot.gallery = Promise.resolve({ shown: 0, grows: 0 });
    return slot; // nothing to look in: no strip at all
  }
  const spin = el("div", "shots-loading");
  spin.setAttribute("role", "progressbar");
  spin.setAttribute("aria-label", `Loading ${PREVIEW_HEADER}`);
  spin.append(el("span", "shots-spinner"));
  slot.classList.add("shots-pending");
  slot.append(spin);
  const shots = pending
    ? Promise.resolve(sources).then((s) => (s ? load(key, s, { text: (u) => text(u) }) : []))
    : sources.shots?.length ? Promise.resolve(dedupeShots(sources.shots)) : load(key, sources, { text: (u) => text(u) });
  slot.gallery = shots.catch(() => []).then((list) => fillGallery(slot, list ?? [], { image, settleMs }));
  return slot;
}

// B54: make the pictures off the page, put in only the ready ones, grow (or collapse) the slot. -> { shown, grows }
function fillGallery(slot, shots, { image, settleMs }) {
  const pics = shots.map((s) => image(s)).filter(Boolean);
  const ready = new Set();
  let group = null;
  let strip = null;
  let grows = 0;
  let timer = null;
  const resize = (change) => { if (resizeSlot(slot, change)) grows++; };
  const show = () => {
    if (group || !ready.size) return;
    clearTimeout(timer);
    group = galleryGroup(pics.filter((p) => ready.has(p)));
    strip = group.querySelector(".alt-shots");
    resize(() => { slot.classList.remove("shots-pending"); slot.replaceChildren(group); });
    fadeIn(group);
  };
  const join = (p) => { // a late one: into its place in the strip, faded in; the slot follows if the strip got taller
    const next = pics.slice(pics.indexOf(p) + 1).find((q) => q.parentNode === strip);
    resize(() => strip.insertBefore(p, next ?? null));
    fadeIn(p);
  };
  return new Promise((resolve) => {
    let left = pics.length;
    const settled = () => {
      if (--left > 0) return;
      if (group) return resolve({ shown: ready.size, grows });
      if (ready.size) show();
      else resize(() => { slot.classList.remove("shots-pending"); slot.replaceChildren(); });
      resolve({ shown: ready.size, grows });
    };
    if (!left) { left = 1; settled(); return; }
    for (const p of pics) {
      Promise.resolve(p.ready ?? true).then((ok) => {
        if (ok) {
          ready.add(p);
          if (group) join(p);
          else if (!timer) timer = setTimeout(show, settleMs); // the first is in: wait a little for the rest
        }
        settled();
      });
    }
  });
}

// B54: change what's in the slot in one step, so the page below slides once instead of jumping. B191: the slot takes
// its new height at once and nav/slide.js slides what's below it from its old place (a transform: 120 Hz never
// animates height); slideChange measures before and after, so the slide starts in the same frame. -> whether the
// height changed.
function resizeSlot(slot, change) {
  const from = slot.offsetHeight || 0;
  const watched = isWatched(slot);
  slideChange(slot, change);
  const to = slot.offsetHeight || 0;
  if (watched && to > from) revealSlot(slot, to - from);
  return to !== from;
}

// B195: the slot grew by `by` px at once while the rows below start `by` px up and slide down (nav/slide.js); left
// alone the full-height gallery shows under and over them as they go. So the slot clips its content and its box
// slides down from `by` px up while its content slides the other way: the content stays put and only the clip's
// bottom edge moves, in step with the rows below (the same .3s curve, started in the same frame). It reads as the
// gallery opening downward with nothing overlapping. Transform only (120 Hz).
const revealing = new WeakMap(); // slot -> its running reveal (the last one clears the clip)
export function revealSlot(slot, by) {
  if (typeof slot.animate !== "function" || !(by > 0)) return null;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return null;
  // The slot itself sliding too (something above it changed in the same step): a second transform would replace
  // slide.js's, so it opens as before (still in step, unclipped) rather than out of step.
  if (slot.getAnimations?.().some((a) => a.playState === "running" && !revealing.has(slot))) return null;
  const timing = { duration: DURATION, easing: EASE };
  const box = slot.animate([{ transform: `translateY(${-by}px)` }, { transform: "none" }], timing);
  const inner = [...slot.children].map((c) => c.animate?.([{ transform: `translateY(${by}px)` }, { transform: "none" }], timing));
  // not `clip`: iOS 15's WebKit lacks it; the slot is already a flow-root, so no reflow. The empty band the box
  // holds above the slot while it opens lets taps through to the rows there; the gallery itself stays tappable.
  Object.assign(slot.style, { overflow: "hidden", pointerEvents: "none" });
  for (const c of slot.children) c.style && (c.style.pointerEvents = "auto");
  revealing.set(slot, box);
  const done = () => {
    if (revealing.get(slot) !== box) return;
    revealing.delete(slot);
    Object.assign(slot.style, { overflow: "", pointerEvents: "" });
    for (const c of slot.children) c.style && (c.style.pointerEvents = "");
  };
  box.onfinish = done;
  box.oncancel = done;
  return { box, inner };
}

function fadeIn(node) {
  node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
}

// ---- F213: a list row's swipe and hold menu queue an app in the sideload build -------------------------------------
// The job the app page's Install would queue (appPageAction: appJob with the installed record from the apps store),
// for browse.js's row swipe and hold menu. -> { job, installed, newest } (job null: nothing to sign here: no IPA, a
// source-signed link), or null when it isn't an app or this isn't the sideload build (F89: the website queues nothing).
// B136: a record is checked against the phone's own app list (`onPhone(bundleId)` -> true | false | null, apps.isInstalled
// asked fresh): a record left by an install iOS never finished doesn't count (core/appqueue.js installedOnPhone).
export async function rowAppJob(pkg, source, { store = apps, mode = detectMode(), onPhone = appOnPhone } = {}) {
  const app = pkg?.stanza?.ipa;
  if (mode !== "sideload" || !app) return null;
  let rec = null;
  try { rec = (await (await store()).all()).find((r) => r.id === app.bundleIdentifier) ?? null; } catch { /* no store */ }
  let phone;
  if (rec && !rec.self) { try { phone = await onPhone(app.bundleIdentifier); } catch { phone = null; } }
  const installed = installedOnPhone(rec, phone);
  const job = appJob(pkg, { installed: installed || null, source: source ? displayName(source) : null });
  return { job, installed, newest: app.versions?.[0]?.version ?? null };
}

// B136: whether iOS has the app now (the shell's apps.isInstalled, not backend-native's session cache: an install
// can land or fail within a session). null where it can't be asked (the website, an older shell).
export async function appOnPhone(bundleId, native = nativeBridge()) {
  if (!native?.call || !bundleId) return null;
  const v = (await native.call("apps.isInstalled", { bundleIds: [bundleId] }))?.installed?.[bundleId];
  return typeof v === "boolean" ? v : null;
}
