// F374: Installed Apps, the jailbreak app's list of the apps on this iPhone, under Install IPAs:
//
//   #/installed/myipas/userapps                     the apps (ifizbox-helper user-apps, core/userapps.js): App Store,
//                                                   then Other Apps, A-Z, each with its Home Screen icon (apps.icon)
//                                                   and a line: version, Encrypted / Decrypted copy in My IPAs
//   #/installed/myipas/userapps/userapp:<id>        an app's page: Details, Decrypt, Inject Tweaks
//
// Decrypt runs on the black progress page (nav/progress.js): ifizbox-helper decrypt-app's lines as they come, then the
// shell zips the IPA into My IPAs (native/Sources/InstalledApps.swift); Complete opens the new IPA's page. A file
// FairPlay wouldn't decrypt is a yellow line, and an extension still encrypted is left out of the IPA; only the main
// executable failing ends in an error. Tweaks go in with the sign options' Inject Tweaks group (screens/tweaks.js
// tweaksGroup, kept per app, bundled ElleKit when a tweak needs CydiaSubstrate) and a row that builds a copy of the
// decrypted IPA with them in (library.addTweaks): it lands in My IPAs, where its page has Install (the helper, ldid
// signs it) and Share. Nothing replaces the app on this iPhone unless that copy is installed from its page.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, placeholder, el, note } from "../nav/ui.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { showAlert } from "../nav/alert.js";
import { openProgress } from "../nav/progress.js";
import { loadStyle } from "../nav/motion.js";
import { format } from "../router.js";
import { go as navGo } from "../nav/go.js";
import { getBackend } from "../backend.js";
import { nativeBridge } from "../native.js";
import { libraryCall } from "../signing/library.js";
import { toBase64 } from "../core/signing.js";
import { MYIPAS, ipaToken } from "../core/myipas.js";
import { USERAPPS, PAGE_TITLE, userAppToken, userAppSections, copiesOf, LIST_FOOTER, EMPTY_TEXT, DECRYPT_FOOTER,
  NOT_ENCRYPTED_FOOTER, TWEAKS_FOOTER, decryptLabel, decryptLine, decryptStatus, decryptError, rememberNames } from "../core/userapps.js";

export { USERAPPS, PAGE_TITLE };

let cache = null; // the last list, for an app's page and its title before the helper answers again
const icons = new Map(); // bundleId -> data: URL | null

const listPath = () => [MYIPAS, USERAPPS];
export const appHref = (bundleId) => format({ tab: "installed", path: [...listPath(), userAppToken(bundleId)] });
export const ipaHref = (file) => format({ tab: "installed", path: [MYIPAS, ipaToken(file)] });
export const appName = (bundleId) => cache?.find((a) => a.bundleId === bundleId)?.name || bundleId;

async function loadApps({ backend = getBackend() } = {}) {
  if (typeof backend?.userApps !== "function") throw new Error("Installed Apps needs the jailbreak app.");
  cache = await backend.userApps();
  rememberNames(cache);
  return cache;
}

async function libraryList() {
  try { return (await libraryCall("list", {}))?.ipas ?? []; } catch { return []; }
}

// The Home Screen icon of each row's app, put into its icon box as it comes (one call per app, kept for the visit).
async function fillIcons(rows, boxes, { native = nativeBridge() } = {}) {
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].bundleId, box = boxes[i];
    if (!box) continue;
    if (!icons.has(id)) {
      let png = null;
      try { png = (await native.call("apps.icon", { bundleId: id }))?.png ?? null; } catch { png = null; }
      icons.set(id, png ? `data:image/png;base64,${png}` : null);
    }
    const src = icons.get(id);
    if (!src || box.querySelector("img")) continue;
    const img = el("img");
    img.alt = "";
    img.onload = () => img.classList.add("loaded");
    img.src = src;
    box.append(img);
  }
}

// ---- the list ---------------------------------------------------------------------------------------------------

export function renderUserApps(body) {
  loadStyle("appicon.css");
  const page = el("div", "userapps");
  const bar = searchBar({ placeholder: "Search Apps", ariaLabel: "Search installed apps", delay: 120,
    onQuery: (q) => draw(q) });
  const list = el("div", "userapps-list");
  list.append(placeholder("list"));
  page.append(list);
  pinned(body, bar).append(page);
  let apps = null, ipas = [];
  function draw(q = "") {
    if (!apps) return;
    const sections = userAppSections(apps, { query: q, ipas });
    const rows = sections.flatMap((s) => s.rows);
    const groups = sections.map((s, i) => ({ header: s.header,
      rows: s.rows.map((r) => ({ label: r.label, subtitle: r.subtitle, href: appHref(r.bundleId), icon: { cls: "app-icon-thumb" } })),
      footer: i === sections.length - 1 ? LIST_FOOTER : "" }));
    if (!groups.length) groups.push({ footer: q.trim() ? "No Results" : EMPTY_TEXT });
    list.replaceChildren(grouped(groups));
    fillIcons(rows, [...list.querySelectorAll(".cell-icon")]);
  }
  Promise.all([loadApps(), libraryList()]).then(([a, l]) => { apps = a; ipas = l; draw(bar.querySelector("input")?.value ?? ""); },
    (e) => list.replaceChildren(note(e?.message || String(e))));
}

// ---- an app's page ----------------------------------------------------------------------------------------------

export function appGroups(app, { ipas = [] } = {}) {
  const { decrypted, tweaked } = copiesOf(app.bundleId, ipas);
  const details = [
    { label: "Version", detail: [app.version, app.build && app.build !== app.version ? `(${app.build})` : ""].filter(Boolean).join(" ") || "—", chevron: false },
    { label: "Bundle ID", detail: app.bundleId, chevron: false },
    { label: "From", detail: app.store ? "App Store" : "Other", chevron: false },
    { label: "Encrypted", detail: app.encrypted === true ? "Yes" : app.encrypted === false ? "No" : "—", chevron: false },
  ];
  const decrypt = [{ label: decryptLabel(decrypted), onClick: null, chevron: false, key: "decrypt" }];
  if (decrypted) decrypt.push({ label: decrypted.file, subtitle: "Decrypted IPA in My IPAs", href: ipaHref(decrypted.file) });
  return {
    details: { header: "Details", rows: details },
    decrypt: { header: "Decrypt", rows: decrypt, footer: app.encrypted === false ? NOT_ENCRYPTED_FOOTER : DECRYPT_FOOTER },
    decrypted, tweaked,
  };
}

export async function renderUserApp(body, route, bundleId) {
  loadStyle("appicon.css");
  body.append(placeholder("page", 4));
  let app, ipas;
  try {
    [app, ipas] = await Promise.all([(cache ? Promise.resolve(cache) : loadApps()).then((l) => l.find((a) => a.bundleId === bundleId)), libraryList()]);
  } catch (e) {
    body.replaceChildren(note(e?.message || String(e)));
    return;
  }
  if (!app) { body.replaceChildren(note(`${bundleId} isn't installed on this iPhone.`)); return; }
  body.replaceChildren();
  const g = appGroups(app, { ipas });
  const decryptRows = g.decrypt.rows.map((r) => (r.key === "decrypt" ? { ...r, onClick: () => decryptApp(app, { body, route }) } : r));
  body.append(grouped([g.details, { ...g.decrypt, rows: decryptRows }]));

  // Inject Tweaks (the sign options' group, kept for this app), then the row that builds the copy, then the copy
  const { tweaksGroup } = await import("./tweaks.js");
  const tg = tweaksGroup({ bundleId, onChange: () => { tg.save(); } });
  body.append(tg.el);
  const build = [{ label: "Build IPA with Tweaks", chevron: false, onClick: () => buildWithTweaks(app, tg, { body, route }) }];
  if (g.tweaked) build.push({ label: g.tweaked.file, subtitle: "IPA with tweaks in My IPAs", href: ipaHref(g.tweaked.file) });
  body.append(grouped([{ rows: build, footer: TWEAKS_FOOTER }]));
}

function rerender(body, route) {
  if (!body?.isConnected) return;
  body.replaceChildren();
  renderUserApp(body, route, route.path.at(-1).slice("userapp:".length));
}

// ---- Decrypt ----------------------------------------------------------------------------------------------------

// The progress page over library.decrypt. -> the shell's reply ({ file, left, ipas }), or null when it failed.
export async function decryptApp(app, { body = null, route = null, backend = getBackend(), open = openProgress } = {}) {
  const p = open({ title: "Decrypting" });
  p.line("step", `Decrypting ${app.name}`);
  p.status("Decrypting");
  let r = null;
  try {
    r = await backend.decryptApp(app.bundleId, (ev) => {
      for (const one of Array.isArray(ev) ? ev : [ev]) {
        const st = decryptStatus(one);
        if (st) { p.progress(st.percent); p.status(st.text); continue; }
        const l = decryptLine(one);
        if (l) p.line(l.kind, l.text);
      }
    });
  } catch (e) {
    const why = decryptError(e, app.name);
    p.line("error", why);
    p.finish({ status: "Couldn't decrypt" });
    return null;
  }
  p.progress(100);
  p.status("Done");
  const file = r?.file;
  p.finish({ label: file ? "Open in My IPAs" : undefined, status: "Decrypted", action: () => { if (file) navGo({ tab: "installed", path: [MYIPAS, ipaToken(file)] }); } });
  if (body && route) rerender(body, route);
  return r;
}

// ---- Build IPA with Tweaks --------------------------------------------------------------------------------------

// The decrypted copy (decrypting first when there is none, after asking), then library.addTweaks with the prepared
// tweaks; the new IPA's page opens. -> its file name, or null.
export async function buildWithTweaks(app, tg, { body = null, route = null, backend = getBackend(), alert = showAlert,
  list = libraryList, decrypt = decryptApp, open = openProgress } = {}) {
  const items = tg.items();
  if (!items.length) {
    await alert({ title: "No Tweaks Yet", message: "Add a .deb, .dylib or zipped .framework tweak first.", buttons: ["OK"] });
    return null;
  }
  let { decrypted } = copiesOf(app.bundleId, await list());
  if (!decrypted) {
    const r = await alert({ title: `Decrypt ${app.name} First?`,
      message: "Tweaks go into a decrypted IPA of the app. Decrypt makes one in My IPAs.", buttons: ["Cancel", "Decrypt"], cancel: 0 }).catch(() => null);
    if (r?.index !== 1) return null;
    const d = await decrypt(app, { backend, open });
    if (!d?.file) return null;
    decrypted = { file: d.file };
  }
  let prepared;
  try { prepared = await tg.prepared(); } catch (e) {
    await alert({ title: "Can't Add These Tweaks", message: String(e?.message ?? e), buttons: ["OK"] });
    return null;
  }
  const { tweakParams } = await import("../core/tweaks.js");
  const p = open({ title: "Adding Tweaks" });
  p.line("step", `Adding ${items.length === 1 ? "1 tweak" : `${items.length} tweaks`} to ${decrypted.file}`);
  let r;
  try { r = await backend.addTweaksTo(decrypted.file, tweakParams(prepared, toBase64)); } catch (e) {
    p.line("error", String(e?.message ?? e).replace(/^[a-z_]+:\s*/, ""));
    p.finish({ status: "Couldn't add the tweaks" });
    return null;
  }
  for (const i of r?.injected ?? []) p.line("raw", `Injected ${i}`);
  p.line("step", `Added ${r.file} to My IPAs`);
  p.finish({ label: "Open in My IPAs", status: "Done", action: () => { navGo({ tab: "installed", path: [MYIPAS, ipaToken(r.file)] }); } });
  if (body && route) rerender(body, route);
  return r.file;
}
