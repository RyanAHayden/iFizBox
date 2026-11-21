// Signing's shared helpers (signing-client.js re-exports the public ones): the bridge, the build checks, the
// insecure-download alert, the malware hash, and the progress page's Cancel.
import { detectMode } from "../core/settings.js";
import { showAlert } from "../nav/alert.js";
import { isInsecure, INSECURE_IPA_ALERT, INSTALL_ANYWAY } from "../core/insecureipa.js";
import { malwareHashes, rememberSigned } from "../core/malicious.js";
import { APP_SERVER, normalizeServer, LEGACY_SERVER, loggedBridge } from "../core/signing.js";
import { GITHUB_REPO, NAME } from "../brand.js";
import { nativeBridge } from "../native.js";

// B104: a bridge call that downloads an IPA (signing.install, signing.prepare, signing.inspect, library.add), sent by
// `send(extra)`. For an http link the shell tries the https twin first; when there is none it answers "insecure", and
// INSECURE_IPA_ALERT asks: Install Anyway sends it again with { insecure: true } (the shell's plain-http download),
// Cancel rejects with code "cancelled", as the progress page's own Cancel does. Any other answer passes through.
// `url` is the link: one the user let through in this session goes straight to http (Custom Install's look, then the
// queue's signing.prepare of the same link, asks once).
const httpAllowed = new Set();
export async function askInsecure(send, { alert = showAlert, url = null } = {}) {
  if (url && httpAllowed.has(url)) return send({ insecure: true });
  try {
    return await send({});
  } catch (e) {
    if (!isInsecure(e)) throw e;
    if ((await alert(INSECURE_IPA_ALERT))?.index !== INSTALL_ANYWAY) throw Object.assign(new Error("Cancelled"), { code: "cancelled" });
    if (url) httpAllowed.add(url);
    return send({ insecure: true });
  }
}

// F292: the IPA's SHA-256, as a signer answered it (the shell's signing.install / signing.prepare, the website's
// worker), kept for Report as Malicious under the app page's ID and version (`asked`: the caller's) and the IPA's own.
// The signers refuse a hash from MALWARE_IPAS before signing (refuseSha256), with code "malware".
export const KNOWN_MALWARE = "Known Malware";
// { refuseSha256 } for a signer, only while MALWARE_IPAS lists a hash (a call stays as it was otherwise)
export const refusing = () => { const h = malwareHashes(); return h.length ? { refuseSha256: h } : {}; };
export function keepIpaHash(storage, result, asked = {}) {
  if (!result?.sha256) return;
  rememberSigned(storage, { sha256: result.sha256,
    ids: [asked.bundleId, result.originalBundleId, result.originalId, result.bundleId],
    versions: [asked.version, result.version] });
}

// F151: a job's error on the progress page (the HUD interface's fail, nav/progress.js) before its alert; a HUD
// without one (liveHUD, the tests') just goes.
export const failed = (h, message) => (typeof h.fail === "function" ? h.fail(message) : h.hide());

// F188: the progress page's Cancel (top right all through, nav/progress.js progressHUD) ends the job at once: `p`, or a
// rejection with code "cancelled" the moment it is tapped, so nothing waits on a bridge call, a download or the
// signer that no one wants any more (and installOnDevice's one-at-a-time lock comes free). A HUD without Cancel
// (liveHUD, the tests') just waits for `p`.
export function untilCancel(h, p) {
  if (typeof h?.onCancel !== "function") return p;
  return new Promise((resolve, reject) => {
    h.onCancel(() => reject(Object.assign(new Error("Cancelled"), { code: "cancelled" })));
    Promise.resolve(p).then(resolve, reject);
  });
}

// F188: asks the shell to stop its signing job (download, signing, the local server's keep-alive). Shells without
// signing.cancel refuse it, and the job then runs out on its own; its answer is ignored either way.
export function stopNative(native) {
  try { Promise.resolve(bridge(native).call("signing.cancel", {})).catch(() => {}); } catch { /* no bridge */ }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const localSigning = () => detectMode() === "sideload";

export const bridge = (native) => {
  const n = native ?? nativeBridge();
  if (!n?.call) throw Object.assign(new Error("This build has no signer."), { code: "internal" });
  return loggedBridge(n); // F361: each sign and install kept in Console Logs as it goes
};

// The shell (native CloseForUpdate) closes iFizBox only once iOS has fetched the whole new IPA from the Signing
// Server; signing.selfUpdate streams how far it is. The locked page (lockSelfUpdate) gets a line a step, and when iOS
// never took the update (notStarted, stalled) its buttons back with Try Again (`retry`). An older shell, without the
// call, leaves the page as B49 does. -> the last state, or null.
export const storageOf = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export const browserSigning = () => detectMode() === "site";
// Bytes as an ArrayBuffer of their own, for the signing worker (early.js re-exports it).
export const buffer = (b) => (b instanceof Uint8Array ? b.slice().buffer : b instanceof ArrayBuffer ? b.slice(0) : new Uint8Array(b ?? []).buffer);

// ---- C37: helpers several signing/ modules share, here so those modules don't import one another ----------------
// (browser.js, install.js, identity.js and queue.js re-export theirs, so their importers are unchanged). In this
// module, not one each, so app.js's startup closure (module-graph.test.js) doesn't grow.

// The website signer's error every signing step throws (browser.js, early.js, prompt.js).
export const signFail = (code, message) => Object.assign(new Error(message), { code });

// The Web Worker, as one call: resolves the worker's answer ({ ipa, bundleId, name, version }), or throws its error.
// F188: `signal` (the progress page's Cancel) ends the worker, and zsign with it, mid-signing.
export function runInWorker(job, { make = () => new Worker(new URL("../signing-worker.js", import.meta.url), { type: "module" }), onProgress = () => {}, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signFail("cancelled", "Cancelled")); return; }
    let w;
    try { w = make(); } catch (e) { reject(signFail("unsupported", `This browser can't sign apps (${e?.message ?? e}).`)); return; }
    signal?.addEventListener?.("abort", () => { w.terminate?.(); reject(signFail("cancelled", "Cancelled")); }, { once: true });
    w.onmessage = (e) => {
      const m = e.data ?? {};
      if (m.progress) { onProgress(m.progress); return; }
      w.terminate?.();
      if (m.ok) resolve(m); else reject(signFail(m.code ?? "sign_failed", m.error ?? "Signing failed."));
    };
    w.onerror = (e) => { w.terminate?.(); reject(signFail("sign_failed", `The signer stopped: ${e?.message ?? "no reason given"}.`)); };
    const t = [job.ipa, job.p12, job.profile].filter((b) => b instanceof ArrayBuffer);
    w.postMessage(job, t);
  });
}

// A request that failed for want of a connection (Safari: "Load failed") is tried again, up to `tries` times with a
// pause, as phones drop a request now and then mid-upload (user 2026-11-18: an upload stopped after its second part).
// An answer from the server, even an error, is final.
export async function retrying(send, { tries = 3, wait = (ms) => new Promise((r) => setTimeout(r, ms)), signal = null } = {}) {
  for (let i = 1; ; i++) {
    try { return await send(); } catch (e) {
      if (i >= tries || signal?.aborted) throw e; // F188: Cancel isn't a dropped request
      await wait(800 * i);
    }
  }
}

// F72: an IPA of iFizBox itself (its GitHub releases, where iFizBox's own source points).
// Only iFizBox's own IPA files count: a release's ${NAME}.ipa, or the test source's <name>-<version>.ipa (F180: no
// old asset names). Other files under the test-fixtures pre-release (Test Alpha, Test Beta...) are ordinary apps.
const SELF_IPA = new RegExp(`^https://github\\.com/${GITHUB_REPO.replace(/[.]/g, "\\.")}/releases/(?:latest/)?download/(?:[^/]+/)?(?:${NAME}|${NAME}-[\\d.]+)\\.ipa$`, "i");
export const isSelfIpa = (url) => SELF_IPA.test(String(url ?? ""));

// Settings > Signing's Signing Server. A saved website address (LEGACY_SERVER, the website's old signer) means the
// default too.
const SERVER_KEY = "ifizbox.signingServer";
export function defaultServer() { return APP_SERVER; }
export function getServer() {
  let saved = null;
  try { saved = normalizeServer(localStorage.getItem(SERVER_KEY)); } catch { /* private */ }
  if (!saved || saved === LEGACY_SERVER) return defaultServer();
  return saved;
}

export function setServer(s) {
  const n = normalizeServer(s);
  try {
    if (!n || n === APP_SERVER || n === LEGACY_SERVER) localStorage.removeItem(SERVER_KEY);
    else localStorage.setItem(SERVER_KEY, n);
  } catch { /* private mode: this session only */ }
  return n && n !== LEGACY_SERVER ? n : APP_SERVER;
}

// B111: signing.install's {here: "copying" | "installing", progress} event (This iPhone) -> { label } for the page's
// step and bar ("Copying to iPhone 40%", "Installing 75%"), or null
export function hereLabel(ev) {
  const word = { copying: "Copying to iPhone", installing: "Installing" }[ev?.here];
  if (!word) return null;
  const p = Math.round(Math.max(0, Math.min(1, Number(ev.progress) || 0)) * 100);
  return { label: p > 0 && p < 100 ? `${word} ${p}%` : word };
}

// B150: the name an install's page shows: the caller's (a source's app name, the variant it was picked as, or Custom
// Install's), else the signed IPA's own (`result.name`, its Info.plist). A bare file name ("App.ipa") isn't a name:
// the IPA's own wins over it.
export function shownName(name, result) {
  const given = String(name ?? "").trim();
  return (given && !/\.ipa$/i.test(given) ? given : "") || result?.name || given;
}

// B111: the single install's end on This iPhone: installd has the app, so "Installed <app>", the bar full, and
// Open <app> (signing.openApp) above the Return button.
export function finishHere(h, result, { native, name = "", later = setTimeout } = {}) {
  const app = shownName(name, result) || "the app"; // B150: the source's name before the IPA's
  const text = `Installed ${app}`;
  const bid = result?.bundleId;
  if (typeof h.finish === "function") {
    h.set(`${text} 100%`);
    const open = () => { try { Promise.resolve(bridge(native).call("signing.openApp", { bundleId: bid })).catch(() => {}); } catch { /* no bridge */ } return false; };
    h.finish({ status: text, ...(bid ? { also: { label: `Open ${app}`, action: open } } : {}) });
  } else later(() => (h.done ? h.done(text) : h.hide()), 1200);
}
