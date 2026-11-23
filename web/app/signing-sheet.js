// Look first, then sign (F68): the sideload build's Custom Install on an AltStore app (F81: plain Install signs
// straight away, signing-client.js signAndInstall; this sheet is the app page's "Custom Install" row). signing.inspect downloads the IPA and
// says what it is and asks for; this sheet shows that as an iOS 6 grouped table (its permissions, its entitlements,
// what the user's profile can't give it, its extensions with a switch each to leave one out) with the Name, Bundle
// ID and Icon to sign it as; Install (top right) sends signing.install {token, ...edits} (core/signing.js installParams)
// and then follows iOS's own install with signing.progress {bundleId}. docs/signing.md "Before and around signing".
//
//   await inspectAndInstall({ url, name, onInstalled })   true once iOS was asked to install, false otherwise
//   await customInstall({ url, name, onInstalled })       the same, after F75's first-install check (the row's tap)
//   await customInstall({ url, name, queue })             F84: the sheet's Install queues instead: queue(options) with
//                                                         core/appqueue.js's job options, then Confirm signs it in turn
//   await inspectToQueue({ url, name, queue })            that sheet, without the first-install check
//
// The sheet's buttons (F81, user 2026-11-17): Install at the top right of its nav bar, a red Cancel at the bottom,
// and a plain Cancel at the top left of the nav bar as well (user 2026-11-20).
//
// The bridge comes from native.js nativeBridge(); an older shell without signing.inspect installs straight away as before.
// SPDX-License-Identifier: GPL-3.0-or-later
import { showSheet } from "./nav/sheet.js";
import { showAlert } from "./nav/alert.js";
import { liveHUD } from "./nav/hud.js";
import { grouped, el, row } from "./nav/ui.js";
import { format, settingsRoute } from "./router.js";
import { installOnDevice } from "./signing/route.js";
import { openSigning } from "./signing/device.js";
import { askInsecure } from "./signing/common.js"; // B104
import { createSwitch } from "./nav/switch.js";
import { phaseLabel, deviceError, inspectGroups, installParams, installedId, signsAsFor, isCgBI, fromBase64, notLandedText, SENT_TO_IOS } from "./core/signing.js";
import { NAME } from "./brand.js";
import { selfLevels } from "./core/progress.js";
import { lockSelfUpdate } from "./nav/progress.js";
import { storedKeep, withKeep, sheetNotes, originalState, OLD_WAY_ALERT, OLD_WAY_TEXT, GUIDE_LINK } from "./core/keepid.js";
import { keepGuideHref, openAppHelp } from "./screens/guides.js";
import { tweaksGroup } from "./screens/tweaks.js"; // F288
import { tweakParams } from "./core/tweaks.js";
import { toBase64 } from "./core/signing.js";
import { loadStyle, EASE, DURATION } from "./nav/motion.js";
import { nativeBridge } from "./native.js";

const ICON_SIZE = 180; // the 60pt @3x icon; the signer writes the same PNG as @2x and @3x

function style() { loadStyle("signsheet.css"); }

// An older shell answers "unknown method signing.inspect" (Bridge.swift).
const unknownMethod = (e) => /unknown method/i.test(String(e?.message ?? e ?? ""));

export async function inspectAndInstall({ url, name = "", onInstalled = () => {} },
  { native = nativeBridge(), hud = liveHUD, alert = showAlert, install = installOnDevice, sheet = openSignSheet, later = setTimeout } = {}) {
  const h = hud("Downloading");
  let info;
  try {
    info = await askInsecure((extra) => native.call("signing.inspect", withKeep({ url, ...extra }), (ev) => { const t = phaseLabel(ev); if (t) h.set(t); }), { alert, url });
  } catch (e) {
    h.hide();
    if (e?.code === "cancelled") return false; // B104: Cancel on This Download Is Not Secure
    if (unknownMethod(e)) return install({ url, name, onInstalled });
    const why = deviceError(e, name);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") openSigning(); // B39: back to this page once it's set up
    return false;
  }
  h.hide();
  return new Promise((resolve) => {
    let started = false;
    const close = sheet(info, {
      fallbackName: name,
      async onSign(edits) {
        let params;
        try {
          params = installParams(info, edits);
        } catch (e) {
          await alert({ title: "Can't Sign", message: e.message, buttons: ["OK"] });
          return;
        }
        started = true;
        close();
        const shown = params.name || info.app?.name || name;
        resolve(await install({ url, name: shown, onInstalled, params,
          after: (result, hh) => followInstall(native, installedId(result, params, info), hh, { later, name: shown, device: result?.device }) }));
      },
      onClose: () => { if (!started) resolve(false); },
    });
  });
}

// The Custom Install row's tap: the Signing walkthrough first when something is missing (F75), else the sheet. With
// `opts.queue` (F84, the app page) the sheet's Install queues the app with its options instead of signing now.
export async function customInstall(opts, { check = null, inspect = inspectAndInstall, toQueue = inspectToQueue } = {}) {
  const missing = check ? await check() : await (await import("./signing/device.js")).firstInstallCheck();
  if (missing) return false;
  return opts?.queue ? toQueue(opts) : inspect(opts);
}

// F84: look first, then the sheet; its Install hands `queue` the job's options (core/appqueue.js: token and when it
// was looked at, the edits, the name to show, the ID iOS will know it by) and closes. True once queued, false on
// Cancel or an error (shown). An older shell without signing.inspect queues it plain (queue(null)), as Install would.
export async function inspectToQueue({ url, name = "", queue },
  { native = nativeBridge(), hud = liveHUD, alert = showAlert, sheet = openSignSheet, now = Date.now } = {}) {
  const h = hud("Downloading");
  let info;
  try {
    info = await askInsecure((extra) => native.call("signing.inspect", withKeep({ url, ...extra }), (ev) => { const t = phaseLabel(ev); if (t) h.set(t); }), { alert, url });
  } catch (e) {
    h.hide();
    if (e?.code === "cancelled") return false; // B104: Cancel on This Download Is Not Secure
    if (unknownMethod(e)) { queue(null); return true; }
    const why = deviceError(e, name);
    await alert({ title: why.title, message: why.message, buttons: ["OK"] });
    if (why.open === "signing") openSigning(); // B39: back to this page once it's set up
    return false;
  }
  h.hide();
  return new Promise((resolve) => {
    let queued = false;
    const close = sheet(info, {
      fallbackName: name,
      async onSign(edits) {
        let params;
        try {
          params = installParams(info, edits);
        } catch (e) {
          await alert({ title: "Can't Sign", message: e.message, buttons: ["OK"] });
          return;
        }
        queued = true;
        close();
        const { token, ...rest } = params;
        queue({ token, at: now(), edits: rest, name: params.name || info.app?.name || name || null,
          signsAs: installedId(null, params, info) });
        resolve(true);
      },
      onClose: () => { if (!queued) resolve(false); },
    });
  });
}

// The sheet's chrome (F81): `right` (the nav bar's right side) gets Install, done-styled, in place of Done; `box` (the
// scroll content) ends with a red Cancel. `left` (the nav bar's left side, B145) gets a plain Cancel bar button too,
// closing it the same way. -> { install, cancel, barCancel }.
export function signSheetButtons({ right, left = null, box, onInstall, onCancel, doc = document }) {
  const install = doc.createElement("button");
  install.type = "button";
  install.className = "bar-button done ss-install";
  install.textContent = "Install";
  install.addEventListener("click", () => onInstall());
  right?.replaceChildren(install);
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "ss-cancel";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => onCancel());
  box.append(cancel);
  const barCancel = doc.createElement("button");
  barCancel.type = "button";
  barCancel.className = "bar-button ss-bar-cancel";
  barCancel.textContent = "Cancel";
  barCancel.addEventListener("click", () => onCancel());
  left?.replaceChildren(barCancel);
  return { install, cancel, barCancel };
}

// Once iOS has the install link, the page says Done and ends on Return: iOS's own install is the user's from there
// (user 2026-11-18: "after we give the install just say its done"). B27-B29 followed iOS's progress over
// signing.progress, which could sit on "iOS has the whole IPA" long after the app was in.
// The button is Close (progressHUD's).
// B49: for iFizBox itself it ends locked on "Closing iFizBox" (nav/progress.js lockSelfUpdate) until iOS closes it.
// F236/F252: `device` (signing.install's, or signing.status's profile.device): when the shell couldn't tell whether
// this iPhone is in the profile, a grey "Not on the Home Screen?" line with Help (page.help; `help(page)` opens
// Guides > "An app won't install") goes under the last step. No Retry: iOS already has the app.
export async function followInstall(_native, bundleId, h, { later = setTimeout, name = "", device = null, help = openAppHelp } = {}) {
  const own = selfLevels([bundleId]).length > 0;
  if (own && typeof h.finish === "function") { lockSelfUpdate(h, { later }); return null; }
  h.set(SENT_TO_IOS);
  const cause = notLandedText(name, device);
  if (cause) h.page?.help?.(cause, { action: help });
  if (typeof h.finish === "function") h.finish({ status: SENT_TO_IOS });
  else later(h.hide, 1200);
  return null;
}

// The sheet itself. `onSign(edits)` with { name, bundleId, icon (base64 PNG | null), removeExtensions: [path] }.
// Returns the sheet's close().
function openSignSheet(info, { onSign, onClose = () => {}, fallbackName = "" } = {}) {
  style();
  const app = info?.app ?? {};
  // F237: keepBundleId, the Keep Bundle ID switch below, starts as the global setting (inspect echoes what it got)
  const keep0 = typeof info?.keepBundleId === "boolean" ? info.keepBundleId : storedKeep();
  const edits = { name: app.name || fallbackName, bundleId: signsAsFor(info, keep0), icon: null, removeExtensions: [], keepBundleId: keep0 };
  const box = el("div", "sheet-scroll page-body grouped sign-sheet");

  // The head: the icon, the name and what it signs as, like an App Store page's top.
  const head = el("div", "ss-head");
  const iconBox = el("span", "ss-icon");
  const title = el("span", "ss-title", edits.name || "App");
  const sub = el("span", "ss-sub", [app.version ? `Version ${app.version}` : null, app.bundleId].filter(Boolean).join(" · "));
  const words = el("span", "ss-words");
  words.append(title, sub);
  head.append(iconBox, words);
  box.append(head);

  const ipaIcon = typeof info?.icon === "string" && info.icon ? info.icon : null;
  const placeholder = () => {
    iconBox.replaceChildren(el("span", "ss-icon-letter", (edits.name || "?").trim().charAt(0).toUpperCase() || "?"));
    iconBox.classList.add("is-placeholder");
  };
  const showIcon = (b64) => {
    const img = new Image();
    img.alt = "";
    img.onerror = placeholder;
    img.src = `data:image/png;base64,${b64}`;
    iconBox.classList.remove("is-placeholder");
    iconBox.replaceChildren(img);
  };
  const drawIcon = () => {
    if (edits.icon) showIcon(edits.icon);
    // Apple's CgBI PNG (most IPAs' icons) is byte-swapped and premultiplied: no browser draws it.
    else if (ipaIcon && !isCgBI(fromBase64(ipaIcon))) showIcon(ipaIcon);
    else placeholder();
  };
  drawIcon();

  // Install As: the three things the user may change.
  const g = el("div", "group");
  g.append(el("h2", "group-header", "Install As"));
  const ul = el("ul", "table grouped");
  const field = (label, value, set, extra = {}) => {
    const li = el("li", "cell");
    const row = el("label", "cell-inner sign-row ss-field");
    const input = Object.assign(el("input", "sign-value"), { type: "text", value, ...extra });
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.spellcheck = false;
    input.addEventListener("input", () => set(input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    row.append(el("span", "cell-label", label), input);
    li.append(row);
    return li;
  };
  ul.append(field("Name", edits.name, (v) => { edits.name = v; title.textContent = v.trim() || app.name || "App"; if (iconBox.classList.contains("is-placeholder")) placeholder(); },
    { placeholder: app.name || "" }));
  const idLi = field("Bundle ID", edits.bundleId, (v) => { edits.bundleId = v; }, { placeholder: edits.bundleId || app.bundleId || "", inputMode: "url" });
  ul.append(idLi);
  const iconLi = el("li", "cell sign-files-cell");
  const iconRow = el("div", "cell-inner sign-row ss-icon-row");
  const iconState = el("span", "sign-value", "");
  const setIconState = () => {
    iconState.textContent = edits.icon ? "Chosen" : ipaIcon && !isCgBI(fromBase64(ipaIcon)) ? "The App's" : "The App's (not shown)";
  };
  setIconState();
  iconRow.append(el("span", "cell-label", "Icon"), iconState);
  const file = Object.assign(el("input", "visually-hidden"), { type: "file", accept: "image/*" });
  file.id = "ssi" + Math.random().toString(36).slice(2);
  const choose = Object.assign(el("label", "bar-button sign-browse", "Choose"), { htmlFor: file.id });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      edits.icon = await iconPNG(f);
      drawIcon();
      setIconState();
    } catch {
      await showAlert({ title: "Can't Use This Image", message: `${NAME} couldn't read it. Choose a PNG or JPEG.`, buttons: ["OK"] });
    }
  });
  iconLi.append(iconRow, file, choose);
  ul.append(iconLi);
  g.append(ul);
  const asText = () => {
    const s = signsAsFor(info, edits.keepBundleId);
    return s && s !== app.bundleId ? ` Your profile signs it as ${s}.` : "";
  };
  const asFoot = el("p", "group-footer", "");
  const drawAs = () => { asFoot.textContent = `Change the name on the Home Screen, the bundle ID (to install a second copy) or the icon (made ${ICON_SIZE}×${ICON_SIZE}).${asText()}`; };
  drawAs();
  g.append(asFoot);
  box.append(g);

  // F237: Keep Bundle ID, the global setting per app, with what the profile can't do and the original-app warning.
  const kg = el("div", "group ss-keep");
  const kul = el("ul", "table grouped");
  const kli = el("li", "cell");
  const kinner = el("div", "cell-inner has-switch");
  const idInput = idLi.querySelector?.("input");
  kinner.append(el("span", "cell-label", "Keep Bundle ID"), createSwitch({ label: "Keep Bundle ID", checked: keep0, onToggle: async (on) => {
    if (!on) { // the old way, said plainly first
      const { index } = await showAlert({ title: OLD_WAY_ALERT.title, message: OLD_WAY_TEXT(edits.name || app.name, info?.appIdAs || ""),
        buttons: OLD_WAY_ALERT.buttons, cancel: 0 });
      if (index !== 1) { kinner.querySelector?.(".switch")?.setAttribute("aria-checked", "true"); return; }
    }
    const before = signsAsFor(info, edits.keepBundleId);
    edits.keepBundleId = on;
    // a Bundle ID left as it was follows the switch; one the user typed stays
    if (String(edits.bundleId).trim() === before) {
      edits.bundleId = signsAsFor(info, on);
      if (idInput) { idInput.value = edits.bundleId; idInput.placeholder = edits.bundleId; }
    }
    drawAs();
    drawKeep();
  } }));
  kli.append(kinner);
  kul.append(kli);
  const guideLi = row({ label: GUIDE_LINK, chevron: true,
    onClick: () => { close(); if (globalThis.location) globalThis.location.hash = keepGuideHref().replace(/^#/, ""); } });
  const kfoot = el("p", "group-footer", "");
  kg.append(kul, kfoot);
  box.append(kg);
  let orig = { installed: false, ours: false };
  function drawKeep() {
    const { notes, guide } = sheetNotes(info, { keep: edits.keepBundleId, ...orig, name: edits.name || app.name });
    kfoot.textContent = notes.length ? notes.map((n) => n.text).join(" ")
      : "The app keeps its own ID: it replaces the original and can get its notifications.";
    if (guide && !guideLi.parentNode) kul.append(guideLi);
    else if (!guide && guideLi.parentNode) guideLi.remove();
  }
  drawKeep();
  originalState(nativeBridge(), app.bundleId).then((s) => { orig = s; drawKeep(); }, () => {});

  box.append(grouped(inspectGroups(info)));
  // The missing group's rows are a warning: red, as Settings' warnings are.
  for (const grp of box.querySelectorAll(".group")) {
    if (grp.querySelector(".group-header")?.textContent === "Your Profile Can't Give It") grp.classList.add("ss-missing");
  }

  // F288: Inject Tweaks, kept per app (screens/tweaks.js)
  const tg = tweaksGroup({ bundleId: app.bundleId || "" });
  box.append(tg.el);

  // Extensions: on means signed and kept; off leaves the bundle out.
  const exts = Array.isArray(app.extensions) ? app.extensions : [];
  if (exts.length) {
    const eg = el("div", "group");
    eg.append(el("h2", "group-header", "Extensions"));
    const eul = el("ul", "table grouped");
    for (const x of exts) {
      const li = el("li", "cell");
      const inner = el("div", "cell-inner has-switch ss-ext");
      const text = el("span", "cell-text");
      text.append(el("span", "cell-label", x.name || x.path.split("/").pop()), el("span", "cell-subtitle", x.point || x.bundleId || x.path));
      inner.append(text, createSwitch({ label: `Keep ${x.name || x.path}`, checked: true, onToggle: (on) => {
        const set = new Set(edits.removeExtensions);
        if (on) set.delete(x.path); else set.add(x.path);
        edits.removeExtensions = [...set];
      } }));
      li.append(inner);
      eul.append(li);
    }
    eg.append(eul, el("p", "group-footer", "Widgets, share sheets, Watch apps. Turn one off to leave it out: each needs an App ID of its own, which a free account may not have to spare."));
    box.append(eg);
  }

  const close = showSheet({ title: edits.name || "Install", body: box, onClose, cls: "sign-sheet-modal" });
  signSheetButtons({ right: close.right, left: close.left, box,
    onInstall: async () => {
      let tweaks = null; // F288: prepared here (the .debs unpacked), sent to the signer as files
      try { const p = await tg.prepared(); tweaks = p ? tweakParams(p, toBase64) : null; } catch (e) {
        await showAlert({ title: "Can't Inject These Tweaks", message: String(e?.message ?? e), buttons: ["OK"] });
        return;
      }
      await tg.save();
      onSign?.({ ...edits, removeExtensions: [...edits.removeExtensions], ...(tweaks ? { tweaks } : {}) });
    }, onCancel: () => close() });
  return close;
}

// A picked image as a 180x180 PNG, base64 (no data: prefix): drawn centred and cropped to a square.
export async function iconPNG(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const canvas = Object.assign(document.createElement("canvas"), { width: ICON_SIZE, height: ICON_SIZE });
    const ctx = canvas.getContext("2d");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("empty image");
    ctx.fillStyle = "#fff"; // iOS draws a transparent icon's holes black: white is kinder
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- F385: Sign <NAME> First ----------------------------------------------------------------------------------
// The website's Install <NAME> App with no signing set up (screens/home.js installApp): an iOS 6 action sheet that
// says the app has to be signed first and lists the ways, each with one short hint under it (AGENTS.md Hints):
// Import Certificate, Use a Free Apple ID (only while the Apple relay is on, as Settings > Signing shows it) and
// Developer Account. A pick opens Settings > Signing at that way's group (focusSigningGroup).
//
//   signFirstOptions({ free })   pure: [{ id: "certificate" | "free" | "account", label, hint }] in order
//   await signFirstSheet({ free })  the picked id, or null for Cancel (a tap on the dimmed screen, Escape)
//   focusSigningGroup(id)        once Settings > Signing draws that group, scrolls it into view
export const SIGN_FIRST_TITLE = `Sign ${NAME} First`;
export const SIGN_FIRST_TEXT = `iOS only installs apps signed for your iPhone. Set up one of these, `
  + `then Settings > Signing offers to install ${NAME}.`;
export const FREE_HINT = "Signs up to 3 apps for 7 days at a time, no certificate needed. "
  + `They install from the ${NAME} app, not this website.`; // free-apple-id.js FREE_ENTRY_FOOTER's words
export function signFirstOptions({ free = false } = {}) {
  return [
    { id: "certificate", label: "Import Certificate",
      hint: "Get a .p12 and its .mobileprovision from a certificate seller or your Apple developer account. Then choose both files and the password." },
    ...(free ? [{ id: "free", label: "Use a Free Apple ID", hint: FREE_HINT }] : []),
    { id: "account", label: "Developer Account",
      hint: `With your developer account's App Store Connect API key, ${NAME} makes the certificate and profiles for you.` },
  ];
}

export function signFirstSheet({ free = false } = {}, { doc = globalThis.document } = {}) {
  style(); // .action-hint
  const options = signFirstOptions({ free });
  return new Promise((resolve) => {
    const make = (tag, cls, text) => Object.assign(doc.createElement(tag), { className: cls, ...(text != null ? { textContent: text } : {}) });
    const scrim = make("div", "action-scrim sign-first");
    const dim = make("div", "action-dim");
    const sheet = make("div", "action-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", SIGN_FIRST_TITLE);
    sheet.append(make("p", "action-title sign-first-title", SIGN_FIRST_TITLE), make("p", "action-title", SIGN_FIRST_TEXT));
    const list = make("div", "action-list");
    list.dataset.scroller = "";
    sheet.append(list);
    for (const o of options) {
      const b = make("button", "action-button", o.label);
      b.type = "button";
      b.dataset.way = o.id;
      b.addEventListener("click", (e) => { e.stopPropagation(); close(o.id); });
      list.append(b, make("p", "action-hint", o.hint));
    }
    const cancel = make("button", "action-button cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", (e) => { e.stopPropagation(); close(null); });
    sheet.append(cancel);
    dim.addEventListener("click", () => close(null));
    scrim.append(dim, sheet);
    doc.body.append(scrim);
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(null); } };
    doc.addEventListener("keydown", onKey);
    dim.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: "ease-out" });
    sheet.animate?.([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: DURATION, easing: EASE });
    cancel.focus?.({ preventScroll: true });
    let done = false;
    function close(id) {
      if (done) return;
      done = true;
      doc.removeEventListener("keydown", onKey);
      scrim.style.pointerEvents = "none";
      resolve(id); // answered before the slide-out, which can't hold it (actionsheet.js B202)
      let timer = 0;
      const end = () => { clearTimeout(timer); scrim.remove(); };
      try {
        dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
        const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 250, easing: EASE, fill: "forwards" });
        timer = setTimeout(end, 250 + 300);
        a.finished.then(end, end);
      } catch { end(); }
    }
  });
}

// Each way's group on Settings > Signing (screens/settings.js certificateGroup, devaccount.js accountGroup,
// free-apple-id.js freeRouteBlock), found by what it draws.
export const SIGNING_GROUP_OF = { certificate: ".sign-import", free: ".free-route", account: ".asc-add, .asc-guide-link" };
export function focusSigningGroup(id, { doc = globalThis.document, later = setTimeout, tries = 40 } = {}) {
  const sel = SIGNING_GROUP_OF[id];
  if (!sel || !doc) return;
  const look = (n) => {
    const hit = doc.querySelector(sel);
    const group = hit?.closest?.(".group") ?? hit;
    if (group) { group.scrollIntoView?.({ block: "center", behavior: "smooth" }); return; }
    if (n > 0) later(() => look(n - 1), 100);
  };
  later(() => look(tries), 350); // after the push slide (nav/motion.js DURATION)
}
