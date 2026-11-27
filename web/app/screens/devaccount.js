// Settings > Installation & Signing: Apple Developer Account. With an App Store Connect API key (AuthKey_<KeyID>.p8,
// the Key ID read from its name, the Issuer ID from a .txt picked with it, the clipboard or typed) iFizBox makes each app's App ID and Ad Hoc profile itself, with
// Push, and registers this iPhone (core/asc.js; in the app native/Sources/ASC.swift does it while it signs).
//   app       the key goes into the Keychain (asc.key.set) and never comes back to the page
//   website   the key stays in this browser (localStorage, like the .p12), and calls go through the site's
//             /apple/api.appstoreconnect.apple.com pass-through (Apple sends no CORS headers)
//
//   accountGroup({ native, redraw })     the group for the Signing page
//   await autoProfileSite({ ipa, id, bundleId, keep, log })   the website's sign-time step: the profile bytes made for
//                                        this app, or null to sign with the imported one
//   await makeCertificateFlow(native)    Make Certificate: a new Apple Distribution certificate + own profile, kept
//   await profileFromKey(native)         a .p12 picked without a profile: the own App ID's profile from the key
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showAlert, alertOK } from "../nav/alert.js";
import { NAME, DOMAIN } from "../brand.js";
import { sortKeyFiles, issuerFromText, UUID_RE } from "../core/certfiles.js";
import { makeJwt, httpTransport, ensureProfile, appIdPrefix, appIdFor, profileRows, profileSerials, findCertificate, ensureDevice,
  makeOwnSigning, profileForP12, profileForAnyP12, LIMIT_TEXT, REVOKE_WARNING } from "../core/asc.js";
import { parseProfile, fromBase64, toBase64, normalUdid } from "../core/signing.js";
import { showHUD } from "../nav/hud.js";
import { storedUdid, startUdid, watchUdid } from "./signing.js";
import { ascGuideHref, ASC_GUIDE_LINK } from "./guides.js";
import { nativeBridge } from "../native.js";
import { KEYS } from "../core/storagekeys.js";

const KEY = KEYS.asc;
const CACHE = KEYS.ascProfiles;
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const readJson = (k) => { try { return JSON.parse(ls()?.getItem(k) ?? "null"); } catch { return null; } };
const writeJson = (k, v) => { try { v == null ? ls()?.removeItem(k) : ls()?.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } };
const nativeOf = (native) => native ?? nativeBridge() ?? null;

export const siteKey = () => { const k = readJson(KEY); return k?.p8 && k.keyId && k.issuerId ? k : null; };
export function siteRequest(k = siteKey(), { origin = globalThis.location?.origin ?? "", fetcher } = {}) {
  return httpTransport({ base: `${origin}/apple/api.appstoreconnect.apple.com/v1`, token: () => makeJwt(k), ...(fetcher ? { fetcher } : {}) });
}
// The shell's errors carry "asc_<status>" (ASC.swift); core/asc.js reads `.status` (404 App ID gone, 403/409 for
// Make Certificate), so it's set from that.
export const nativeRequest = (n) => (method, path, body) => n.call("asc.request", { method, path: `/v1${path}`, ...(body ? { body } : {}) })
  .catch((e) => {
    const m = /^asc_(\d{3})$/.exec(String(e?.code ?? ""));
    if (m && e && typeof e === "object" && e.status == null) { try { e.status = Number(m[1]); } catch { /* frozen */ } }
    throw e;
  });

async function keyInfo(native) {
  const n = nativeOf(native);
  if (n?.call) { try { return await n.call("asc.key.info", {}); } catch { return null; } }
  const k = siteKey();
  return k ? { keyId: k.keyId, issuerId: k.issuerId } : null;
}
async function cache(native) {
  const n = nativeOf(native);
  if (n?.call) { try { return (await n.call("asc.profiles", {})) ?? {}; } catch { return {}; } }
  return readJson(CACHE) ?? {};
}

// F277: the Issuer ID without retyping. It isn't in the .p8 and no Apple call made without it returns it, so it comes
// from a .txt picked with the key (core/certfiles.js sortKeyFiles), else the clipboard when it holds a UUID:
//   app       never (B171): reading another app's copy unasked shows iOS's Allow Paste, and iOS can't say without
//             reading whether the copy is a UUID; the field's Paste button reads it when tapped
//   website   navigator.clipboard.readText only once the browser says clipboard-read is granted (Chromium): Safari
//             can't say, and reading there unasked raises its Paste bubble (screens/sources.js keeps to the same rule).
//             The field's Paste button covers it.
// Resolves with the lowercase UUID, or null.
export async function issuerPrefill({ native, clipboard = globalThis.navigator?.clipboard, permissions = globalThis.navigator?.permissions } = {}) {
  const n = nativeOf(native);
  let text = null;
  try {
    if (n?.call) return null;
    if (clipboard?.readText && (await permissions?.query?.({ name: "clipboard-read" }))?.state === "granted") text = await clipboard.readText();
  } catch { return null; }
  return text ? issuerFromText(text) : null;
}
export const ISSUER_FULL = new RegExp(`^${UUID_RE.source}$`, "i");

// The picked files ({ name, bytes }, or File objects) as one key: { p8, keyId, issuerId } or { error }.
export async function readKeyPick(files, opts) {
  const list = await Promise.all([...files].map(async (f) => (f.bytes ? f : { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const k = await sortKeyFiles(list, opts);
  if (!k.p8) return { error: "Pick the AuthKey_<Key ID>.p8 you downloaded from App Store Connect > Users and Access > Integrations (and a .txt holding the Issuer ID, if you saved one)." };
  return { p8: k.p8.text, keyId: k.keyId, issuerId: k.issuerId };
}

// The .p8 picked (with a .txt or in a .zip), then the Issuer ID asked, prefilled; saved only once Apple takes a token
// made from them.
async function addKey(files, native, redraw) {
  const pick = await readKeyPick(files);
  if (pick.error) return alertOK("Not an API Key", pick.error);
  const { p8, keyId } = pick;
  let kid = keyId;
  if (!kid) {
    const r = await showAlert({ title: "Key ID", message: "The file name doesn't hold the Key ID. Type it (10 characters).", input: { type: "text", placeholder: "ABC123DEF4" }, buttons: ["Cancel", "Next"], cancel: 0 });
    if (r.index !== 1) return;
    kid = String(r.value ?? "").trim().toUpperCase();
  }
  const shown = showAlert({ title: "Issuer ID", message: pick.issuerId
    ? `Key ${kid}. The Issuer ID from your .txt:`
    : `Key ${kid}. Paste the Issuer ID shown above the keys in App Store Connect > Users and Access > Integrations.`,
  input: { type: "text", placeholder: "69a6de7e-...-5b8c7c11a4d1", value: pick.issuerId ?? "", paste: (t) => issuerFromText(t) ?? "" },
  buttons: ["Cancel", "Save"], cancel: 0 });
  if (!pick.issuerId) prefillField([...(globalThis.document?.querySelectorAll(".alert-field") ?? [])].pop(), native);
  const r = await shown;
  if (r.index !== 1) return;
  const issuerId = String(r.value ?? "").trim().toLowerCase();
  if (!ISSUER_FULL.test(issuerId)) return alertOK("Not an Issuer ID", "An Issuer ID looks like 69a6de7e-1234-47e3-e053-5b8c7c11a4d1. Copy it from above the keys in App Store Connect > Users and Access > Integrations > App Store Connect API.");
  const n = nativeOf(native);
  try {
    if (n?.call) await n.call("asc.key.set", { p8, keyId: kid, issuerId });
    else {
      const k = { p8, keyId: kid, issuerId };
      await siteRequest(k)("GET", "/certificates?limit=1"); // Apple must take it before it's kept
      writeJson(KEY, k);
    }
  } catch (e) {
    return alertOK("Key Not Accepted", withRoleHint(e));
  }
  redraw();
}

// Fills the alert's field from the clipboard once it answers, only while it's still empty, untouched and on screen.
export async function prefillField(field, native, read = issuerPrefill) {
  if (!field) return false;
  let typed = false;
  field.addEventListener?.("input", () => { typed = true; }, { once: true });
  const id = await read({ native });
  if (!id || typed || field.isConnected === false || field.value) return false;
  field.value = id;
  return true;
}

async function removeKey(native, redraw) {
  const { index } = await showAlert({ title: "Remove API Key?", message: `${NAME} stops making profiles. The profiles it made stay in your account.`,
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  const n = nativeOf(native);
  if (n?.call) await n.call("asc.key.remove", {}).catch(() => null);
  else { writeJson(KEY, null); writeJson(CACHE, null); }
  redraw();
}

// Where the UDID comes from when it's really needed: the Pairing row shows only once This iPhone is picked.
export const PAIR_HINT = "This iPhone's UDID isn't known: in Settings > Installation & Signing, pick Install Apps With: This iPhone, "
  + "then pair it under This iPhone > Pairing, and check again.";
const SITE_HINT = "This iPhone's UDID isn't known: use Find This iPhone's UDID under the profile.";

// Check Account's line about this iPhone. With its UDID: register it if missing. Without one but with candidates (the
// devices in the running app's own profile, one of them this iPhone, all of them the team's): every one registered
// and enabled means this iPhone is too; otherwise name the ones that aren't. Neither: say how to get the UDID.
export async function deviceLine(request, { udid = null, candidates = [], app = true } = {}) {
  if (udid) {
    const { made } = await ensureDevice(request, udid, "iPhone");
    return made ? `This iPhone (${normalUdid(udid)}) was added to the account.` : "This iPhone is in the account.";
  }
  const want = [...new Set([].concat(candidates ?? []).map(normalUdid).filter(Boolean))];
  if (!want.length) return app ? PAIR_HINT : SITE_HINT;
  const devices = (await request("GET", "/devices?limit=200")).data ?? [];
  const status = new Map(devices.map((d) => [normalUdid(d.attributes?.udid), d.attributes?.status ?? "ENABLED"]));
  const missing = want.filter((u) => !status.has(u));
  const disabled = want.filter((u) => status.has(u) && status.get(u) !== "ENABLED");
  const iphones = want.length === 1 ? "the iPhone" : `one of the ${want.length} iPhones`;
  if (!missing.length && !disabled.length) return `This iPhone is in the account (${iphones} in this app's profile).`;
  const parts = [];
  if (missing.length) parts.push(`not in the account: ${missing.join(", ")}`);
  if (disabled.length) parts.push(`disabled: ${disabled.join(", ")}`);
  return `This iPhone is ${iphones} in this app's profile. Of those, ${parts.join("; ")}. If one of them is this iPhone, `
    + `the profiles ${NAME} makes leave it out: pair it (Settings > Installation & Signing > Install Apps With: This iPhone, `
    + "then This iPhone > Pairing) and check again to add it.";
}

// F277: an iPhone whose app came from another team (its embedded profile's devices aren't in this account) and that
// isn't paired: the website's Profile Service visit (worker/src/udid.js), started from the app. Safari installs the
// profile, iOS sends the UDID to the Worker, and this page polls for it (screens/signing.js startUdid / watchUdid);
// then the UDID is kept by the shell (device.udid.set, PhoneID.swift) and registered in the account.
export const SITE_ORIGIN = `https://${DOMAIN}`;
export const FIND_UDID_BUTTON = "Find UDID";
export const FIND_UDID_TEXT = `${FIND_UDID_BUTTON} opens ${NAME}'s website in Safari, which downloads a small profile. Install it `
  + `in the Settings app > Profile Downloaded (it says "Not Verified", which is fine, and iOS keeps no profile), then come `
  + `back here: ${NAME} adds this iPhone to your account.`;
// Check Account's device line left this iPhone unknown (no UDID, and not shown to be in the account).
export const udidUnknown = (udid, line) => !udid && !/^This iPhone is in the account/.test(String(line ?? ""));

export async function findUdidViaSite(native, { fetcher = (...a) => globalThis.fetch(...a), store, open, watch = watchUdid,
  request, alert = alertOK } = {}) {
  const n = nativeOf(native);
  const url = await startUdid({ origin: SITE_ORIGIN, fetcher, store });
  const opened = open ? await open(url) : (await n?.call?.("app.openURL", { url }).catch(() => null))?.opened === true;
  if (!opened) return alert("Open in Safari", `Open this link in Safari to send this iPhone's UDID:\n\n${url}`).then(() => false);
  watch(async () => {
    const udid = storedUdid(store)?.udid;
    if (!udid) return;
    await alert("Developer Account", await registerUdid(n, udid, { request }));
  }, { fetcher, store });
  return true;
}

// A UDID found by the visit: kept by the shell (an older one without device.udid.set keeps it in localStorage only,
// which Check Account also reads), then registered in the account. Resolves with Check Account's line.
export async function registerUdid(native, udid, { request } = {}) {
  const n = nativeOf(native);
  await n?.call?.("device.udid.set", { udid }).catch(() => null);
  try { return await deviceLine(request ?? (n?.call ? nativeRequest(n) : siteRequest()), { udid }); } catch (e) { return String(e?.message ?? e).replace(/^\w+: /, ""); }
}

// ---- F276: Make Certificate (an API key and no .p12 of this account) ----
// The RSA key and the CSR are made here (the app's WebView or the browser); only the CSR goes to Apple. The .p12
// (random password) is packed here and imported with the profile for the app's own App ID (core/asc.js makeOwnSigning):
//   app       signing.import (it needs a profile with the .p12), into the Keychain
//   website   saveIdentity (IndexedDB, as an imported .p12)
// At Apple's limit the user picks the certificate to revoke (pickRevoke), with the warning; nothing is revoked unasked.
export const MAKE_CERT_BUTTON = "Make Certificate";
export const P12_NAME = `${NAME} Distribution.p12`;
export const PROFILE_FILE = `${NAME} (made with your API key).mobileprovision`;
export const makeCertText = (app) => `${NAME} makes a new Apple Distribution certificate in your account and signs with it. `
  + `Its private key is made ${app ? "on this iPhone" : "in this browser"} and never leaves it: only a signing request goes to Apple. `
  + "Needs an API key with the Admin role.";

// The picker at Apple's limit: one button per certificate (UIAlertView-style stacked), then the warning and Revoke.
// Resolves with the picked certificate's id, or null.
export async function pickRevoke(certs, { alert = showAlert } = {}) {
  if (!certs?.length) return null;
  const label = (c) => `${c.kind}${c.expires ? `, until ${String(c.expires).slice(0, 10)}` : ""}${c.ours ? " (in use)" : ""}`;
  const names = certs.map((c, i) => `${i + 1}. ${c.name}: ${label(c)}`);
  const pick = await alert({ title: "Certificate Limit", message: [LIMIT_TEXT, ...names].join("\n\n"),
    buttons: [...certs.map((c, i) => `Revoke ${i + 1}`), "Cancel"], cancel: certs.length, stacked: true });
  const c = certs[pick?.index];
  if (!c) return null;
  const sure = await alert({ title: `Revoke ${label(c)}?`, message: [c.name, REVOKE_WARNING,
    ...(c.ours ? [`It's the certificate ${NAME} signs with now.`] : [])].join("\n\n"),
  buttons: ["Cancel", "Revoke"], cancel: 0, colors: { 1: "red" } });
  return sure?.index === 1 ? c.id : null;
}

// B121: the website's certificate serial, read from the .p12 itself (signing-client.js identityCert, kept with the
// identity), else every certificate its profile lists (one of them is the .p12's; F276's profile from a key lists all).
export async function siteSerials(id, { save, cert } = {}) {
  const read = cert ?? (await import("../signing/password.js")).identityCert;
  const c = await Promise.resolve(read(id, save ? { save } : {})).catch(() => null);
  if (c?.serial) return [c.serial];
  return id?.profile ? profileSerials(id.profile) : [];
}

// The serials this app signs with now (the picker marks that certificate "in use").
async function currentSerials(n, load, save) {
  if (n?.call) {
    const st = await n.call("signing.status", {}).catch(() => null);
    return st?.identity?.serial ? [st.identity.serial] : [];
  }
  const id = await load().catch(() => null);
  return siteSerials(id, { save });
}
const identityApi = async () => { const m = await import("../signing/identity.js"); return { load: m.loadIdentity, save: m.saveIdentity }; };
const message = (e) => String(e?.message ?? e).replace(/^\w+: /, "");

// Puts a made (or picked) .p12 and its profile (base64 or bytes) where signing finds it.
export async function keepIdentity(n, { p12, password, profile }, { save } = {}) {
  const prof = typeof profile === "string" ? fromBase64(profile) : profile;
  if (n?.call) {
    await n.call("signing.import", { p12: toBase64(p12), profile: toBase64(prof), password: password ?? "" });
    await save({ p12Name: P12_NAME, profileName: PROFILE_FILE }).catch(() => {});
  } else {
    await save({ p12, p12Name: P12_NAME, password: password ?? "", passwordOk: true, profile: prof, profileName: PROFILE_FILE });
  }
}

// The whole flow. Resolves true once the certificate is kept. `deps` swap the request, alerts, HUD and identity store.
export async function makeCertificateFlow(native, { request, alert = showAlert, hud = showHUD, identity, udid = null, confirm = true } = {}) {
  const n = nativeOf(native);
  const app = !!n?.call;
  const req = request ?? (app ? nativeRequest(n) : siteRequest());
  const { load, save } = identity ?? (await identityApi());
  if (confirm) {
    const go = await alert({ title: `${MAKE_CERT_BUTTON}?`, message: makeCertText(app), buttons: ["Cancel", "Make"], cancel: 0 });
    if (go?.index !== 1) return false;
  }
  const ownSerials = await currentSerials(n, load, save);
  let made = null;
  let revokeId = null;
  for (let round = 0; !made && round < 4; round++) {
    const hide = hud("Making Certificate");
    try {
      made = await makeOwnSigning({ request: req, udid, deviceName: "iPhone", cache: {}, revokeId, ownSerials });
    } catch (e) {
      if (e?.code === "cert-limit" || e?.code === "cert-gone") {
        hide();
        if (e.code === "cert-gone") await alertOK("Certificate Gone", e.message, alert);
        revokeId = await pickRevoke(e.certs, { alert });
        if (!revokeId) return false;
        continue;
      }
      await alertOK("Couldn't Make Certificate", message(e), alert);
      return false;
    } finally { hide(); }
  }
  if (!made) return false;
  // The .p12 is only in memory: a failed profile step is retried here rather than losing it.
  let profile = made.profile;
  let problem = made.profileError;
  while (!profile) {
    const again = await alert({ title: "Certificate Made, No Profile", message: `${NAME} made the certificate, but not the profile `
      + `to go with it: ${message(problem)}${app ? "" : " The certificate is kept in this browser anyway."}`,
    buttons: [app ? "Discard" : "Later", "Try Again"], cancel: 0 });
    if (again?.index !== 1) {
      if (!app) await save({ p12: made.p12, p12Name: P12_NAME, password: made.password, passwordOk: true }).catch(() => {});
      return false;
    }
    const hide = hud("Making Profile");
    try {
      profile = (await profileForP12({ request: req, serials: [made.serial], team: made.team, udid, deviceName: "iPhone", cache: {} })).entry.content;
    } catch (e) { problem = e; } finally { hide(); }
  }
  try {
    await keepIdentity(n, { p12: made.p12, password: made.password, profile }, { save });
  } catch (e) {
    await alertOK("Couldn't Import", message(e), alert);
    return false;
  }
  await alertOK("Certificate Made", `${NAME} made an Apple Distribution certificate${made.expires ? ` (until ${String(made.expires).slice(0, 10)})` : ""} `
    + `and signs with it now. Its key lives only ${app ? "in this iPhone's Keychain" : "in this browser"}.`, alert);
  return true;
}

// Whether a certificate is there to sign with (app: in the Keychain; website: a .p12 kept). Unknown counts as yes, so
// the Make Certificate row shows only when there's surely none.
export async function hasCertificate(native, { load } = {}) {
  const n = nativeOf(native);
  try {
    if (n?.call) {
      let st = await n.call("signing.status", {});
      if (typeof st === "string") st = JSON.parse(st);
      return !st || typeof st !== "object" || !("identity" in st) || Boolean(st.identity);
    }
    const id = await (load ?? (await identityApi()).load)();
    return Boolean(id?.p12);
  } catch { return true; }
}

// F276: a key user picked a .p12 and no .mobileprovision: the profile for the app's own App ID comes from the key.
// B121: for the .p12's own certificate when its serial can be read here (identityCert); else listing every
// distribution certificate in the account.
// Saves it with the staged identity; resolves true when it did. Quiet (false) without a key or when nothing is missing.
export async function profileFromKey(native, { request, identity, alert = showAlert, hud = showHUD, info = keyInfo, cert = undefined } = {}) {
  const n = nativeOf(native);
  const { load, save } = identity ?? (await identityApi());
  const id = await load().catch(() => null);
  if (!id?.p12 || id.profile) return false;
  if (!(await info(native))) return false;
  const hide = hud("Making Profile");
  try {
    const req = request ?? (n?.call ? nativeRequest(n) : siteRequest());
    const read = cert ?? (await import("../signing/password.js")).identityCert;
    const own = await Promise.resolve(read(id, { save })).catch(() => null);
    const r = own?.serial && own.team
      ? await profileForP12({ request: req, serials: [own.serial], team: own.team, udid: null, deviceName: "iPhone", cache: {} })
      : await profileForAnyP12({ request: req, udid: null, deviceName: "iPhone", cache: {} });
    await save({ profile: fromBase64(r.entry.content), profileName: PROFILE_FILE });
    return true;
  } catch (e) {
    hide();
    await alertOK("No Profile Made", `The API key couldn't make a profile for this .p12: ${message(e)}`, alert);
    return false;
  } finally { hide(); }
}

// Check Account: is the certificate in the account, is this iPhone registered (and register it).
async function checkAccount(native, redraw = () => {}) {
  const n = nativeOf(native);
  const lines = [];
  let find = false;
  let noCert = false; // F276: none imported, or not in this account: offer Make Certificate
  let udid = null;
  try {
    const request = n?.call ? nativeRequest(n) : siteRequest();
    let serials = [], candidates = [];
    if (n?.call) {
      const st = await n.call("signing.status", {}).catch(() => null);
      serials = st?.identity?.serial ? [st.identity.serial] : [];
      const dev = await n.call("device.udid", {}).catch(() => null);
      udid = dev?.udid ?? null;
      candidates = Array.isArray(dev?.candidates) ? dev.candidates : [];
      if (!udid) udid = (await n.call("asc.udid", {}).catch(() => null))?.udid ?? null;
      if (!udid) udid = storedUdid()?.udid ?? null; // F277: a website visit made from the app, kept by an older shell
    } else {
      const id = await (await import("../signing/identity.js")).loadIdentity();
      serials = await siteSerials(id);
      udid = storedUdid()?.udid ?? null;
    }
    if (serials.length) {
      const c = await findCertificate(request, serials);
      lines.push(c ? `Certificate: in the account (${c.attributes?.displayName || c.attributes?.name || c.id}).`
        : `Certificate: not in this account. Import the .p12 of one of this account's certificates (Apple Distribution), or ${MAKE_CERT_BUTTON}.`);
      noCert = !c;
    } else { lines.push("Certificate: none imported yet."); noCert = true; }
    const line = await deviceLine(request, { udid, candidates, app: !!n?.call });
    lines.push(line);
    find = !!n?.call && udidUnknown(udid, line);
  } catch (e) {
    lines.push(withRoleHint(e)); // F316: the role hint only when the check fails
  }
  if (!find && !noCert) return alertOK("Developer Account", lines.join("\n\n"));
  // F277: not paired, and the app's own profile doesn't show this iPhone in the account: offer the website's visit
  const buttons = ["OK", ...(find ? [FIND_UDID_BUTTON] : []), ...(noCert ? [MAKE_CERT_BUTTON] : [])];
  const { index } = await showAlert({ title: "Developer Account", message: [...lines, ...(find ? [FIND_UDID_TEXT] : [])].join("\n\n"),
    buttons, cancel: 0 });
  if (buttons[index] === MAKE_CERT_BUTTON) {
    if (await makeCertificateFlow(native, { udid }).catch((e) => alertOK("Couldn't Make Certificate", message(e)).then(() => false))) redraw();
    return;
  }
  if (buttons[index] !== FIND_UDID_BUTTON) return;
  try { await findUdidViaSite(native); } catch (e) { await alertOK("UDID Not Found", String(e?.message ?? e).replace(/^\w+: /, "")); }
}

// F316 (AGENTS.md Hints): two short sentences under the key rows; with no key, what one is for. The role the key
// needs is said only when Apple refuses it (withRoleHint: Key Not Accepted, Check Account's failure).
export const ROLE_HINT = "Use a key with the Admin or App Manager role.";
// Only for a refusal about the key's rights (403 / forbidden / permission), not a network error or a typo'd ID.
export const roleRefusal = (e) => e?.status === 403 || e?.code === "key-role"
  || /\b403\b|forbidden|permission|not allowed|role/i.test(String(e?.message ?? e));
export const withRoleHint = (e) => {
  const m = String(e?.message ?? e).replace(/^\w+: /, "").trim();
  if (!roleRefusal(e) || m.includes(ROLE_HINT)) return m;
  return `${m}${/[.!?]$/.test(m) || !m ? "" : "."} ${ROLE_HINT}`.trim();
};
export function accountFooter({ key = false, app = true } = {}) {
  if (!key) return `With an App Store Connect API key, ${NAME} makes a profile with Push for each app you sign.`;
  return `${NAME} makes a profile with Push for each app you sign. `
    + (app ? "The key stays in this iPhone's Keychain." : "The key stays in this browser.");
}

export function accountGroup({ native, redraw = () => {} } = {}) {
  const box = document.createElement("div");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".p8,.txt,.zip";
  input.multiple = true; // F277: the .p8 and a .txt holding the Issuer ID, or the .zip they came in
  input.hidden = true;
  input.addEventListener("change", () => { const f = [...(input.files ?? [])]; input.value = ""; if (f.length) addKey(f, native, redraw); });
  (async () => {
    const info = await keyInfo(native);
    const footer = accountFooter({ key: Boolean(info), app: Boolean(nativeOf(native)?.call) });
    const rows = info
      ? [{ label: "API Key", detail: info.keyId }, { label: "Issuer ID", subtitle: info.issuerId },
        { label: "Check Account", onClick: () => checkAccount(native, redraw) },
        ...((await hasCertificate(native)) ? [] : [{ label: MAKE_CERT_BUTTON, subtitle: "No certificate yet: make one with this key", chevron: true,
          onClick: () => makeCertificateFlow(native).then((ok) => { if (ok) redraw(); }, (e) => alertOK("Couldn't Make Certificate", message(e))) }]),
        { label: "Remove API Key", onClick: () => removeKey(native, redraw) }]
      : [{ label: "Add API Key", subtitle: "AuthKey_<Key ID>.p8, recommended", chevron: true, cls: "asc-add", onClick: () => input.click() }];
    const made = info ? profileRows(await cache(native)) : [];
    const frag = grouped([{ header: "Apple Developer Account", rows, footer }, ...(made.length ? [{ header: `Profiles Made by ${NAME}`, rows: made }] : [])]);
    frag.querySelector(".asc-add")?.append(input);
    // F277: the how-to (screens/guides.js) linked from the footer, while there is no key to add one
    const foot = info ? null : frag.querySelector(".group-footer");
    if (foot) {
      const a = Object.assign(document.createElement("a"), { href: ascGuideHref(), textContent: ASC_GUIDE_LINK, className: "asc-guide-link" });
      foot.append(" ", a);
    }
    box.replaceChildren(frag);
  })();
  return box;
}

// ---- the website's sign-time step ----
// B121: a cached per-app profile that doesn't list the .p12's own certificate (made before its serial was read, for
// whichever certificate the imported profile listed first) is forgotten, so ensureProfile makes it again.
export function dropOtherCertProfile(cache, identifier, serials) {
  const e = cache?.[identifier];
  if (!e?.content || serials?.length !== 1) return false;
  let listed;
  try { listed = profileSerials(fromBase64(e.content)); } catch { return false; }
  const norm = (s) => String(s).toUpperCase().replace(/^0+/, "");
  if (!listed.length || listed.map(norm).includes(norm(serials[0]))) return false;
  delete cache[identifier];
  return true;
}

export async function autoProfileSite({ ipa, id, bundleId = null, keep = true, log = () => {}, cert = undefined, request = undefined }) {
  const k = siteKey();
  if (!k || !keep || !id?.profile) return null;
  let own = bundleId;
  if (!own) {
    try { own = (await (await import("../core/ipainfo.js")).readIpaFile(ipa)).bundleId; } catch { return null; }
  }
  const base = parseProfile(id.profile);
  const c = readJson(CACHE) ?? {};
  const prefix = appIdPrefix(base.appId, base.teamId);
  const serials = await siteSerials(id, { cert });
  dropOtherCertProfile(c, appIdFor(own, prefix), serials);
  const r = await ensureProfile({ request: request ?? siteRequest(k), bundleId: own, prefix,
    udid: storedUdid()?.udid ?? null, deviceName: "iPhone", serials, cache: c, log });
  writeJson(CACHE, c);
  log(r.made ? `Profile ${r.appId}: made by ${NAME} (${r.reason})${r.deviceMade ? ", this iPhone added to the account" : ""}` : `Profile ${r.appId}: made by ${NAME}, reused`);
  return fromBase64(r.entry.content);
}
