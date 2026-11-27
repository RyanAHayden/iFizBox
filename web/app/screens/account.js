// F97: Settings > Account (iOS 6 grouped tables). iFizBox Account keeps this device's sources, the settings that
// travel, Ignored Upgrades, the Wish List, installed-app records, repo sign-ins (tokens only) and the signing certificate on the site (brand.js DOMAIN), encrypted with an account
// key only the user's devices have (core/account.js has the rules; worker/src/account.js the storage).
//
//   accountSection()          the root Settings page's row: iFizBox Account, Signed In / Off; pushes #/settings/account
//   drawAccount(el)           the page: Create Account / Sign In With Key; signed in: Sync Now, Last Synced, the Sync
//                             Certificate switch, Show Account Key, Sign Out, Delete Account
//   startAccountSync()        once at start: read on launch; save when the app goes to the background or the page is
//                             hidden, only if something changed (the free tier's 1,000 writes a day)
//   signInFromLink(url)       ifizbox://account?k=… (incoming.js): Sign In With Key, filled in
//   accountSync()             the controller, wired to this build's stores
//
// Where things live: the key in the Keychain in the app (account.key.* in native/Sources/Account.swift; IndexedDB in
// an older shell), in IndexedDB on the website; the sync state (version, what was last synced, without the
// certificate) in localStorage.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { format, settingsRoute } from "../router.js";
import { showAlert, alertOK } from "../nav/alert.js";
import { showHUD } from "../nav/hud.js";
import { copyText } from "../nav/menu.js";
import { onPageOpen } from "../nav/pagestate.js";
import { go as navGo } from "../nav/go.js";
import { qrSvg } from "../core/qr.js";
import { createAccountSync, keyLink, parseKey, identityOf, identityFiles, ACCOUNT_BASE } from "../core/account.js";
import { createCredentialStore } from "../core/payment.js"; // F309: repo sign-ins
import { detectMode, TRAVELS } from "../core/settings.js";
import { exportLine } from "../core/sourcelist.js";
import { toBase64 } from "../core/signing.js";
import { createWishlist } from "../core/wishlist.js";
import { versionLines, applyVersionLines } from "../core/appupdates.js"; // F281
import { apps, recordInstall, removeInstall } from "../core/installed.js";
import { getBackend } from "../backend.js";
import { loadIdentity, saveIdentity } from "../signing/identity.js";
import { settings } from "../settings-store.js";
import { createSwitch } from "../nav/switch.js";
import { NAME, DOMAIN } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";
import { nativeBridge } from "../native.js";
import { KEYS } from "../core/storagekeys.js";

const STATE_KEY = KEYS.account;

// ---- where the key lives ----------------------------------------------------------------------------------------

function idbKeys(name = "ifizbox-account") {
  const run = (mode, f) => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("kv", mode);
      const r = f(tx.objectStore("kv"));
      tx.oncomplete = () => { db.close(); resolve(r?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  return {
    get: async () => (await run("readonly", (s) => s.get("key"))) ?? null,
    set: (code) => run("readwrite", (s) => s.put(code, "key")),
    remove: () => run("readwrite", (s) => s.delete("key")),
  };
}

// The app's Keychain (no Face ID: the key is read at every launch), or IndexedDB in a shell without account.key.*.
export function keyStore(native = nativeBridge()) {
  const idb = idbKeys();
  if (!native?.call) return idb;
  let old = false;
  const via = (method, params, fallback) => (old ? fallback() : native.call(method, params).catch((e) => {
    if (!/unknown|no handler|not found/i.test(String(e?.message ?? e))) throw e;
    old = true;
    return fallback();
  }));
  return {
    get: () => via("account.key.get", {}, idb.get).then((v) => (typeof v === "string" ? v : v?.key ?? null)),
    set: (code) => via("account.key.set", { key: code }, () => idb.set(code)),
    remove: () => via("account.key.remove", {}, idb.remove),
  };
}

const stateStore = (storage = globalThis.localStorage) => ({
  get: () => { try { return JSON.parse(storage.getItem(STATE_KEY) ?? "null"); } catch { return null; } },
  set: (v) => { try { if (v) storage.setItem(STATE_KEY, JSON.stringify(v)); else storage.removeItem(STATE_KEY); } catch { /* full */ } },
});

// ---- this device's things ---------------------------------------------------------------------------------------

// A source line as every device writes it: a bare host gets its "/", so "https://a" and "https://a/" are one source.
// Anything with a path stays as it is (an AltStore source's …/apps.json is a file, not a directory).
export const sourceLine = (line) => (/^https?:\/\/[^/\s]+$/i.test(line) ? line + "/" : line);

const certBuild = (mode = detectMode()) => mode === "site" || mode === "sideload";

// F309: the repo sign-ins the payment screens keep (screens/extras.js, screens/tweaks.js use the same keys). No
// Keychain here: the account carries tokens only, and a token it brings comes without a payment secret.
const repoLogins = () => { try { return createCredentialStore({ storage: globalThis.localStorage }); } catch { return null; } };

export async function collectHere({ syncCert = true, backend = getBackend(), store = settings, native = nativeBridge(),
  mode = detectMode(), appStore = apps, load = loadIdentity, wishes = createWishlist(), logins = repoLogins() } = {}) {
  const sources = (await backend.sources().catch(() => [])).filter((s) => s?.uri).map((s) => sourceLine(exportLine(s)));
  const values = {};
  for (const k of TRAVELS) if (store.isShown(k)) values[k] = store.get(k);
  const recs = await (await appStore()).all().catch(() => []);
  const out = { sources: [...new Set(sources)], settings: values, holds: store.holds.list(), wishlist: wishes.list(),
    ...(store.ignoredVersions?.all && Object.keys(store.ignoredVersions.all()).length ? { ignoredVersions: versionLines(store.ignoredVersions.all()) } : {}), // F281
    apps: recs.filter((r) => r?.id && !r.self).map(({ id, name, version, key, source, sourceName, icon, date }) =>
      ({ id, name, version, key: key ?? null, source: source ?? null, sourceName: sourceName ?? null, icon: icon ?? null, date: date ?? 0 })) };
  // F309: repo sign-ins (core/payment.js's store, this origin's localStorage), the token only
  let held = {};
  try { held = logins?.logins() ?? {}; } catch { held = {}; }
  if (Object.keys(held).length) out.repoLogins = Object.fromEntries(Object.entries(held).map(([b, token]) => [b, { token }]));
  if (!certBuild(mode)) return out; // the jailbreak app signs nothing: it leaves the account's certificate as it is
  if (!syncCert) return { ...out, identity: null };
  let id = null;
  try {
    if (mode === "site") id = identityOf(await load());
    else {
      const e = await native.call("signing.export", {});
      const names = (await load().catch(() => null)) ?? {};
      if (e?.p12 && e?.profile) id = { p12: b64toUrl(e.p12), profile: b64toUrl(e.profile), password: e.password ?? "",
        p12Name: names.p12Name ?? "", profileName: names.profileName ?? "" };
    }
  } catch { id = null; }
  return { ...out, identity: id };
}
const b64toUrl = (b64) => String(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function applyHere(c, { backend = getBackend(), store = settings, native = nativeBridge(), mode = detectMode(),
  appStore = apps, wishes = createWishlist(), logins = repoLogins(),
  added = async () => (await import("./manage.js")).sourcesChanged() } = {}) {
  // F309: a repo sign-in from another device (kept only where this device didn't sign in itself), or a sign-out
  for (const { base, token } of c.adoptLogins ?? []) await Promise.resolve().then(() => logins?.adopt(base, token)).catch(() => {});
  for (const base of c.dropLogins ?? []) await Promise.resolve().then(() => logins?.drop(base)).catch(() => {});
  if (c.removeSources.length) {
    const have = await backend.sources().catch(() => []);
    for (const line of c.removeSources) {
      const s = have.find((x) => x?.uri && sourceLine(exportLine(x)) === line);
      if (s) await backend.removeSource(s.key).catch(() => {}); // a source in a file iFizBox doesn't change stays
    }
  }
  for (const line of c.addSources) await backend.addSource(line).catch(() => {}); // offline, or gone: next sync tries again
  if (c.addSources.length && mode === "jailbreak") await added(); // B446: apt gets their lists at once
  for (const [k, v] of Object.entries(c.settings)) { try { if (store.isShown(k)) store.set(k, v); } catch { /* not in this build */ } }
  for (const p of c.addHolds) await Promise.resolve(store.holds.set(p, true)).catch(() => {});
  for (const p of c.removeHolds) await Promise.resolve(store.holds.set(p, false)).catch(() => {});
  if ((c.addVersions?.length || c.removeVersions?.length) && store.ignoredVersions) { // F281: Ignore This Version
    try { store.ignoredVersions.replace(applyVersionLines(store.ignoredVersions.all(), { add: c.addVersions, remove: c.removeVersions })); } catch { /* next sync */ }
  }
  for (const p of c.addWishes ?? []) { try { wishes.set(p, true); } catch { /* storage full: the next sync tries again */ } }
  for (const p of c.removeWishes ?? []) { try { wishes.set(p, false); } catch { /* as above */ } }
  if (c.identity) {
    try {
      if (mode === "site") await saveIdentity({ ...identityFiles(c.identity), passwordOk: null });
      else if (mode === "sideload") {
        const f = identityFiles(c.identity);
        await native.call("signing.import", { p12: toBase64(f.p12), profile: toBase64(f.profile), password: f.password ?? "" });
        await saveIdentity({ p12Name: f.p12Name, profileName: f.profileName }).catch(() => {});
      }
    } catch { /* a certificate this device can't take: the next sync tries again */ }
  }
  const db = await appStore();
  for (const r of c.putApps) await recordInstall(db, r, r.date ?? Date.now()).catch(() => {});
  for (const id of c.removeApps) await removeInstall(db, id).catch(() => {});
}

let shared = null;
function accountSync() {
  shared ??= createAccountSync({
    keys: keyStore(), state: stateStore(), collect: (o) => collectHere(o), apply: (c) => applyHere(c),
    base: detectMode() === "site" ? "" : ACCOUNT_BASE,
  });
  return shared;
}

// ---- lifecycle --------------------------------------------------------------------------------------------------

let started = false;
export function startAccountSync({ acct = accountSync, doc = globalThis.document, win = globalThis.window } = {}) {
  if (started || !doc) return;
  started = true;
  const quiet = (p) => p.catch((e) => { if (e?.code === "gone") forgetGone(acct()); });
  acct().status().then((s) => { if (s.signedIn) quiet(acct().sync({ write: false })).then(redraw); }).catch(() => {});
  const save = () => { quiet(acct().save()); };
  doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "hidden") save(); });
  win?.addEventListener?.("pagehide", save);
}

async function forgetGone(a) {
  await a.forget().catch(() => {});
  redraw();
}

// ---- the page ---------------------------------------------------------------------------------------------------

const pages = new Set();
function redraw() {
  for (const el of pages) { if (el.isConnected) drawAccount(el); else pages.delete(el); }
}

export function lastSyncedText(t, now = Date.now()) {
  if (!t) return "Never";
  const m = Math.round((now - t) / 60000);
  return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}

// B148: the detail is live (nav/pagestate.js liveText): Back from the Account page after Sign In or Sign Out says
// On / Off in place.
export const accountDetail = (acct = accountSync) => acct().status().then((s) => (s?.signedIn ? "On" : "Off"), () => "Off");
export function accountSection({ acct = accountSync } = {}) {
  const box = document.createElement("div");
  box.append(grouped([{ rows: [{ label: `${NAME} Account`, detail: "", live: () => accountDetail(acct),
    href: format(settingsRoute(["account"])), icon: rowIcon("account") }] }]));
  return box;
}

// F309: one hint per group (AGENTS.md, Hints): what the account keeps under Create Account, repo sign-ins in their own
// sentence; how it signs in under Sign In With Key.
export const CREATE_FOOTER = "Keeps your sources, settings and certificate the same on every iPhone and on the website. "
  + "Repo sign-ins come too; payment details stay on each iPhone.";
export const SIGN_IN_FOOTER = `No email or password: your account key is the account, and ${DOMAIN} can't read what it stores.`;
const KEY_WARNING = `Save this key somewhere safe. It is the only way into your account: if you lose it, nobody can get your data back, ${DOMAIN} included.`;
const CERT_FOOTER = `Your certificate is encrypted with your account key before it leaves this device: ${DOMAIN} can't read it. Off takes it out of your account.`;

let reveal = false; // Show Account Key: the key's group stays open until the page is left
// B43: an Account page pushed again opens with the key hidden (nav/pagestate.js).
export const isAccountPage = (r) => r.tab === "settings" && r.path.length === 1 && r.path[0] === "account";
onPageOpen(isAccountPage, () => { reveal = false; });

export async function drawAccount(el) {
  pages.add(el);
  const a = accountSync();
  const s = await a.status().catch(() => ({ signedIn: false }));
  if (!s.signedIn) {
    reveal = false;
    el.replaceChildren(grouped([
      { rows: [{ label: "Create Account", onClick: () => createFlow(el), icon: rowIcon("createAccount") }], footer: CREATE_FOOTER },
      { rows: [{ label: "Sign In With Key", onClick: () => signInFlow(el), icon: rowIcon("signInKey") }], footer: SIGN_IN_FOOTER },
    ]));
    return;
  }
  const parts = [grouped([{ rows: [{ label: "Sync Now", onClick: () => syncNow(el), icon: rowIcon("syncNow") },
    { label: "Last Synced", detail: lastSyncedText(s.lastSynced), icon: rowIcon("lastSynced") }],
    footer: `${NAME} saves to your account when you leave it, and reads it when it opens.` }])];
  if (certBuild()) {
    const g = grouped([{ rows: [{ label: "Sync Certificate", icon: rowIcon("syncCert") }], footer: CERT_FOOTER }]);
    const cell = g.querySelector(".cell-inner");
    cell.append(createSwitch({ label: "Sync Certificate", checked: s.syncCert, onToggle: (on) => { a.setSyncCert(on); } }));
    cell.classList.add("has-switch");
    parts.push(g);
  }
  parts.push(grouped([{ rows: [{ label: reveal ? "Hide Account Key" : "Show Account Key", icon: rowIcon(reveal ? "hidden" : "showKey"),
    onClick: () => { reveal = !reveal; drawAccount(el); } }] }]));
  if (reveal && s.code) parts.push(keyBlock(s.code));
  const out = document.createElement("div"); // F286: Sign Out, above Delete Account, the action sheet's plain button
  out.className = "account-signout-wrap";
  const outBtn = Object.assign(document.createElement("button"), { type: "button", className: "action-button account-signout", textContent: "Sign Out" });
  outBtn.addEventListener("click", () => signOutFlow(el));
  out.append(outBtn);
  parts.push(out);
  const del = document.createElement("div");
  del.className = "account-delete-wrap";
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "action-button destructive account-delete", textContent: "Delete Account" });
  btn.addEventListener("click", () => deleteFlow(el));
  del.append(btn);
  parts.push(del);
  el.replaceChildren(...parts);
}

// The key as a code, a link and a QR code another device's Camera opens in iFizBox.
function keyBlock(code) {
  const box = document.createElement("div");
  const link = keyLink(parseKey(code));
  box.append(grouped([{ header: "Account Key", rows: [{ label: code, cls: "account-code" },
    { label: "Copy Key", onClick: () => copyText(code) }, { label: "Copy Link", onClick: () => copyText(link) }], footer: KEY_WARNING }]));
  try {
    const qr = document.createElement("div");
    qr.className = "manage-qr account-qr"; // manage.css draws the code
    const img = new Image();
    img.alt = "QR code of your account link";
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg(link, { ecc: "M" }));
    const note = Object.assign(document.createElement("p"), { className: "group-footer",
      textContent: `Scan it with another iPhone's Camera to sign in there in ${NAME}.` });
    qr.append(img, note);
    box.append(qr);
  } catch { /* a 26-letter link always fits */ }
  return box;
}

const problem = (e) => e?.message ?? String(e);

async function createFlow(el) {
  const { index } = await showAlert({ title: "Create Account", message: `${NAME} makes an account key on this device. ${KEY_WARNING}`,
    buttons: ["Cancel", "Create"], cancel: 0 });
  if (index !== 1) return;
  const hide = showHUD("Creating");
  try {
    await accountSync().create();
    hide.done ? hide.done("Created") : hide();
    reveal = true; // shown once, now
    await drawAccount(el);
  } catch (e) { hide(); await alertOK("Can't Create Account", problem(e)); }
}

async function signInFlow(el, prefill = "") {
  const { index, value } = await showAlert({ title: "Sign In With Key", message: "Your account key, or the ifizbox://account link you saved.",
    input: { placeholder: "XXXX-XXXX-XXXX-…", value: prefill, paste: true }, buttons: ["Cancel", "Sign In"], cancel: 0 });
  if (index !== 1) return;
  const hide = showHUD("Signing In");
  try {
    await accountSync().signIn(value);
    hide.done ? hide.done("Signed In") : hide();
  } catch (e) { hide(); await alertOK("Can't Sign In", problem(e)); }
  if (el) await drawAccount(el);
}

async function syncNow(el) {
  const hide = showHUD("Syncing");
  try {
    await accountSync().sync({ write: true });
    hide.done ? hide.done("Synced") : hide();
  } catch (e) {
    hide();
    if (e?.code === "gone") { await accountSync().forget(); await alertOK("Account Deleted", "This account was deleted on another device."); }
    else await alertOK("Can't Sync", problem(e));
  }
  await drawAccount(el);
}

// F286: Sign Out. Only this device: the account, and every other device signed in to it, stay as they are.
export const SIGN_OUT_ALERT = {
  title: "Sign Out?",
  message: `This iPhone stops syncing with your ${NAME} Account. What's on it stays. To sign in again you need your account key.`,
  buttons: ["Cancel", "Sign Out"], cancel: 0,
};

export async function signOutFlow(el, { acct = accountSync(), ask = showAlert, hud = showHUD, draw = drawAccount } = {}) {
  const { index } = await ask({ ...SIGN_OUT_ALERT, buttons: [...SIGN_OUT_ALERT.buttons] });
  if (index !== 1) return false;
  const hide = hud("Signing Out");
  try {
    await acct.signOut();
    hide.done ? hide.done("Signed Out") : hide();
  } catch (e) { hide(); await alertOK("Can't Sign Out", problem(e)); }
  reveal = false;
  if (el) await draw(el);
  return true;
}

async function deleteFlow(el) {
  const { index } = await showAlert({ title: "Delete Account?", message: `Your saved sources, settings, apps, repo sign-ins and certificate are deleted from ${DOMAIN}, and every device is signed out. What's on this device stays.`,
    buttons: ["Cancel", "Delete"], cancel: 0 });
  if (index !== 1) return;
  const hide = showHUD("Deleting");
  try {
    await accountSync().remove();
    hide.done ? hide.done("Deleted") : hide();
  } catch (e) { hide(); await alertOK("Can't Delete Account", problem(e)); }
  await drawAccount(el);
}

// ifizbox://account?k=… : the Account page, and Sign In With Key filled in.
export async function signInFromLink(url, { open = navGo } = {}) {
  const bytes = parseKey(url);
  open(format(settingsRoute(["account"])));
  if (!bytes) { await alertOK("Can't Sign In", "That account link is damaged."); return; }
  const s = await accountSync().status().catch(() => ({}));
  const code = url.replace(/^.*[?&]k=([^&#]+).*$/, "$1");
  if (s.code && parseKey(s.code)?.join() === bytes.join()) return; // already this account
  await signInFlow([...pages].find((p) => p.isConnected) ?? null, decodeURIComponent(code));
}
