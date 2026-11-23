// ---- the website (F93): signed in the browser ----------------------------------------------------------------
//
//   browserSigning()                   true on the website (common.js)
//   await signInBrowser({ url, name, onInstalled, bring, bytes }, deps)
//       F197: `bytes` (an IPA kept in this browser, or a function answering it) is signed instead of downloading `url`.
//       the progress page (F151; was a HUD): "Downloading" (the IPA through the Worker's /api/fetch?kind=ipa: most hosts send no CORS headers),
//       "Signing" (signing-worker.js: zsign as WebAssembly, with the certificate from IndexedDB), "Uploading" (the
//       signed IPA to the Worker's /sign/upload, in parts, kept 10 minutes), then a Ready to Install alert whose
//       Install tap opens iOS's install prompt (itms-services, from the tap). F121: when the bundle ID is known at the
//       tap (expectedBundleId; `bundleId` is the app's own ID where the caller knows it), iOS's prompt opens at once
//       instead, for a link the upload fills later, and there's no alert. true once iOS was asked; false after an error, shown in an alert (zsign's own reason when
//       it can't sign the app). bring: iFizBox's own IPA carries the certificate (ifizbox-identity.plist), and always
//       the website's sources and settings (web/transfer.link): the app imports both on its first launch.
//
// The .p12, password and profile go only into the Web Worker (this browser), and with bring into iFizBox's signed
// IPA, which waits on the Worker for those 10 minutes as the old server signer's copy did.
import { createDownloadMeter, downloadLine, rateText } from "../core/downloadmeter.js"; // B262
import { IPA_MAX, overSiteLimit, overMemoryLimit, memoryLimit, IFIZBOX_ID, noteSigned, isOutOfMemory,
  noteOutOfMemory, profileInfo, signingIds } from "../core/websign.js";
import { withKeep, siteSigned, rememberSiteSigned, resignNote, RESIGN_TITLE, RESIGN_BUTTONS, installWarningText,
  INSTALL_WARNING_TITLE, INSTALL_WARNING_BUTTONS } from "../core/keepid.js";
import { progressHUD } from "../nav/progress.js";
import { noteSiteSignature } from "../core/installed.js"; // F342
import { showAlert } from "../nav/alert.js";
import { KNOWN_MALWARE, failed, keepIpaHash, refusing, storageOf, untilCancel } from "./common.js";
import { identityNow, loadIdentity } from "./identity.js";
import { isSelfIpa } from "./common.js";
import { openRoute } from "./device.js";
import { EARLY_WINDOW, buffer, dropEarly, earlyLink, expectedBundleId, iconLeftText, keptBytes, reserveUpload,
  siteCause, siteRefusal, siteUdid } from "./early.js";
import { memoryNote, tooBigAlert, tooLargeText } from "./toobig.js";
import { watchInstall } from "./watch.js";
import { eitherSignal, iosCancelled, promptStop, watchPrompt, websiteTransfer } from "./prompt.js";

import { signFail, runInWorker, retrying } from "./common.js";
export { signFail, runInWorker, retrying };

async function answerError(res) {
  let b = null;
  try { b = await res.json(); } catch { /* not JSON */ }
  return signFail(b?.code ?? "network", b?.error ?? `The server answered HTTP ${res.status}.`);
}

// The IPA's bytes through /api/fetch, the label following the download ("Downloading 40%").
// F188: `signal` (the progress page's Cancel) aborts the download.
// B87: `retrying` covers a request until its answer starts; a body that breaks off after that (Safari's bare "Load
// failed" from the reader, the first Install's error) or ends short of the Worker's X-IPA-Length is fetched once more,
// from the start. Once, because what breaks is a cold download: the first request for a release file streams from
// GitHub through Cloudflare while the edge keeps a copy (worker/src/index.js RELEASE_CACHE), and the second comes from
// that copy (user 2026-11-19: Install failed the first time, then worked). A second break says so in words.
// B95: the Worker now hands the body on untouched (it used to run out of CPU on big apps, cutting them short), so the
// cap and the length are checked only here. A body that broke off is resumed from the bytes already here (Range:
// bytes=n-, which the Worker passes on), up to CUT_TRIES times while each try brings more; an answer that isn't the
// asked-for part (200) starts again from byte 0. A try that brings nothing new ends it, in words.
// F257: up to CUT_TRIES more tries in all, whatever each brought (a big app's download may break more than once), and
// `onCut({ attempt, of, at })` before each (at: the bytes already here), for the log's "Reconnecting (try 1 of 3)".
export const CUT_TEXT = "The app's download broke off before the end. Check the connection and tap Install again.";
export const CUT_TRIES = 3;
export async function downloadIpa(url, opts = {}) {
  const got = { buf: null, n: 0 };
  for (let tries = 0; ; tries++) {
    try { return await downloadIpaOnce(url, opts, got); } catch (e) {
      if (e?.code !== "cut" || opts.signal?.aborted) throw e;
      if (tries >= CUT_TRIES) throw signFail("network", CUT_TEXT);
      try { opts.onCut?.({ attempt: tries + 1, of: CUT_TRIES, at: got.n }); } catch { /* the log only */ }
    }
  }
}

// F257: the log's lines for a resumed download (signInBrowser's onCut).
export const reconnectText = (attempt, of = CUT_TRIES) => `Reconnecting (try ${attempt} of ${of})`;
export const droppedText = (bytes) => {
  const mb = Number(bytes) / 1048576;
  return `The connection dropped at ${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB.`;
};
export const grayIconText = (app) => `If a gray ${app ? `${app} ` : ""}icon was left on your Home Screen, delete it.`;

// B262: `onBytes(n, total)` after each piece (total 0 when the Worker sent no length), for the MB/s.
async function downloadIpaOnce(url, { base = "", fetcher = globalThis.fetch, onProgress = () => {}, onBytes = () => {}, max = IPA_MAX, wait = undefined, signal = null } = {}, got = { buf: null, n: 0 }) {
  let res;
  const init = { cache: "no-store", ...(got.n ? { headers: { Range: `bytes=${got.n}-` } } : {}), ...(signal ? { signal } : {}) };
  try { res = await retrying(() => fetcher(`${base}/api/fetch?${new URLSearchParams({ url, kind: "ipa" })}`, init), { wait, signal }); } catch {
    if (signal?.aborted) throw signFail("cancelled", "Cancelled");
    throw signFail("network", "The app couldn't be downloaded: no connection to the server.");
  }
  if (!res.ok) throw await answerError(res);
  const head = (k) => res.headers?.get?.(k);
  // a resume goes on only from the asked-for byte; anything else is the whole app again
  const resumed = got.n > 0 && res.status === 206 && Number(/^bytes (\d+)-/.exec(head("content-range") ?? "")?.[1]) === got.n;
  if (!resumed) { got.n = 0; }
  const total = Number(head("x-ipa-length") || (resumed ? 0 : head("content-length")) || 0);
  if (total > max) throw signFail("too_large", tooLargeText(total, max));
  const cut = (e) => (signal?.aborted ? signFail("cancelled", "Cancelled") : signFail("cut", `The download broke off: ${e?.message ?? e}`));
  if (!res.body?.getReader) {
    let whole;
    try { whole = new Uint8Array(await res.arrayBuffer()); } catch (e) { throw cut(e); }
    if (resumed) { const b = new Uint8Array(got.n + whole.length); b.set(got.buf.subarray(0, got.n)); b.set(whole, got.n); whole = b; }
    if (whole.length > max) throw signFail("too_large", tooLargeText(whole.length, max));
    got.buf = whole; got.n = whole.length;
    if (total && whole.length < total) throw cut(`${whole.length} of ${total} bytes`);
    return whole;
  }
  const reader = res.body.getReader();
  let buf = resumed ? got.buf : new Uint8Array(total || 1 << 20), n = resumed ? got.n : 0;
  if (resumed && total > buf.length) { const b = new Uint8Array(total); b.set(buf.subarray(0, n)); buf = b; }
  // what came stays in `got` when the body breaks off, for the next try to resume from
  const keep = () => { got.buf = buf; got.n = n; };
  for (;;) {
    if (signal?.aborted) { reader.cancel?.()?.catch?.(() => {}); throw signFail("cancelled", "Cancelled"); } // a broken body's cancel rejects
    let step;
    try { step = await reader.read(); } catch (e) { keep(); throw cut(e); }
    const { done, value } = step;
    if (done) break;
    if (n + value.length > max) { reader.cancel?.(); throw signFail("too_large", tooLargeText(0, max)); }
    if (n + value.length > buf.length) { const b = new Uint8Array(Math.max(buf.length * 2, n + value.length)); b.set(buf.subarray(0, n)); buf = b; }
    buf.set(value, n);
    n += value.length;
    if (total) onProgress(Math.min(99, Math.floor((n / total) * 100)));
    try { onBytes(n, total); } catch { /* the log only */ }
  }
  keep();
  if (total && n < total) throw cut(`${n} of ${total} bytes`);
  return buf.length === n ? buf : buf.slice(0, n);
}

// The signed IPA to the Worker (POST /sign/upload, each part, done): the install link's answer { itms, ... }.
// F121: `token` uploads into the reserved early link instead of a new one.
export async function uploadSigned(bytes, { bundleId, name, version }, { base = "", fetcher = globalThis.fetch, onProgress = () => {}, wait = undefined, token = null, signal = null } = {}) {
  const q = new URLSearchParams({ bundleid: bundleId, version: String(version || "1.0").slice(0, 64), title: String(name || bundleId).slice(0, 200), size: String(bytes.length),
    ...(token ? { token } : {}) });
  const call = async (path, init) => {
    let res;
    if (signal?.aborted) throw signFail("cancelled", "Cancelled"); // F188: no part goes up after Cancel
    try { res = await retrying(() => fetcher(`${base}${path}`, { cache: "no-store", ...init, ...(signal ? { signal } : {}) }), { wait, signal }); } catch {
      if (signal?.aborted) throw signFail("cancelled", "Cancelled");
      throw signFail("network", "The signed app couldn't be uploaded: no connection to the server.");
    }
    if (!res.ok) throw await answerError(res);
    return res.json();
  };
  const up = await call(`/sign/upload?${q}`, { method: "POST" });
  for (let i = 0; i < up.parts; i++) {
    await call(`/sign/upload/${up.token}/${i}`, { method: "PUT", body: bytes.subarray(i * up.partSize, Math.min(bytes.length, (i + 1) * up.partSize)) });
    onProgress(Math.floor(((i + 1) / up.parts) * 100));
  }
  return call(`/sign/upload/${up.token}/done`, { method: "POST" });
}

// F334: the team and App ID (entitlements' ID) this profile signs `own` with, and the Info.plist ID iOS knows the app
// by; null when the profile can't be read or the app's ID isn't known yet.
export function signingTarget(profile, own, keep = withKeep({}).keepBundleId !== false) {
  if (!profile || !own) return null;
  try {
    const p = profileInfo(profile instanceof Uint8Array ? profile : new Uint8Array(profile));
    const { bundleId, entitlementsId } = signingIds(p.appId || "*", own, { keep });
    return { bundleId, team: p.teamId ?? null, appId: entitlementsId };
  } catch { return null; }
}

export async function signInBrowser({ url, name = "", onInstalled = () => {}, bring = false, bundleId = null, version = "", bytes = null, size = null, iconUrl = null, anyway = false },
  { hud = progressHUD, alert = showAlert, open = (u) => { location.href = u; }, go = openRoute,
    identity = loadIdentity, fetcher = globalThis.fetch, worker = runInWorker, transfer = websiteTransfer, base = "",
    now = identityNow, origin = () => new URL(base || "/", globalThis.location?.href).origin, clock = Date.now,
    watch = watchInstall, phone = siteUdid, tooBig = tooBigAlert, prompt = watchPrompt, storage = storageOf() } = {}) {
  const deps = { hud, alert, open, go, identity, fetcher, worker, transfer, base, now, origin, clock, watch, phone, tooBig, prompt, storage };
  // F257: a listed size over the cap: the Too Big alert, before the early link or any download
  if (!bytes && url && overSiteLimit(size)) {
    await tooBig({ url, name, size, version, iconUrl }, { alert });
    return false;
  }
  // F261: at or past the size that ran this browser out of memory: the same alert with Try Anyway (from its tap)
  if (!bytes && url && !anyway && overMemoryLimit(size, storage)) {
    let tried = null;
    const choice = await tooBig({ url, name, size, version, iconUrl, limit: memoryLimit(storage) }, { alert,
      anyway: () => { tried = signInBrowser({ url, name, onInstalled, bring, bundleId, version, bytes, size, iconUrl, anyway: true }, deps); return tried; } });
    return choice === "try" && tried ? tried : false;
  }
  // F121: before anything waits, while Safari still counts this as the user's tap: iOS's install prompt, for a link
  // whose app comes later. Only when the bundle ID it will be signed as is known now (expectedBundleId).
  const expected = expectedBundleId(now(), { url, bundleId });
  let early = null;
  if (expected) {
    try {
      early = { ...earlyLink(origin(), { bundleId: expected, name, version }), bundleId: expected, at: clock() };
      open(early.itms);
    } catch { early = null; }
  }
  const reserved = early ? reserveUpload(early.token, { bundleId: expected, name: name || expected, version }, { base, fetcher }) : null;
  // B95: the early link dropped once it can't get this app; `intoEarly` is set when the upload goes into it
  let intoEarly = false;
  const opened = Boolean(early); // iOS was sent to a link: the failure text says what to do with its icon
  // B90: iOS's prompt cancelled while this runs (watchPrompt) stops the download, the signer and the upload
  const ios = early ? promptStop(early.token, { base, fetcher, prompt }) : null;
  const again = () => signInBrowser({ url, name, onInstalled, bring, bundleId, version, bytes, size, iconUrl, anyway }, deps);
  const drop =() => { ios?.stop(); if (early && !intoEarly) { const t = early.token; early = null; return dropEarly(t, { base, fetcher }); } return null; };
  const id = await identity();
  if (!id?.p12 || !id?.profile) {
    drop();
    await alert({ title: "No Certificate", message: "Add your certificate, its password and provisioning profile in Settings > Signing.", buttons: ["OK"] });
    // install.js imports this module: loaded when the retry runs, not statically
    (await import("../screens/signing.js")).rememberInstall({ name, run: async () => (await import("./install.js")).signAndInstall({ url, name, onInstalled, bring, bundleId, version, bytes }) }); // F177
    go(["signing"]);
    return false;
  }
  // F256: the UDID F253's profile found, checked against the profile before anything downloads or signs
  const me = await Promise.resolve().then(phone).catch(() => null);
  const refusal = siteRefusal(id, me);
  if (refusal) {
    drop();
    await alert({ title: "iPhone Not in Profile", message: refusal + (opened ? `\n\n${iconLeftText(name)}` : ""), buttons: ["OK"] });
    return false;
  }
  const h = hud(bytes ? "Reading" : "Downloading");
  const pct = (label) => (p) => h.set(`${label} ${p}%`);
  // B262: the download's MB/s on the page's label, and its Log line ("Downloaded 120.3 of 312.0 MB (38%), 21.4 MB/s")
  // once a second
  const meter = createDownloadMeter({ now: clock });
  let speed = "";
  const dlLabel = (n, total) => (total ? `Downloading ${Math.min(99, Math.floor((n / total) * 100))}%` : `Downloading ${(n / 1048576).toFixed(1)} MB`) + speed;
  const onBytes = (n, total) => {
    const t = meter.add(n, total);
    if (!t) return;
    speed = `, ${rateText(t.rate)}`;
    h.page?.raw?.(downloadLine(t));
    h.set(dlLabel(n, total));
  };
  const dlPct = (p) => h.set(`Downloading ${p}%${speed}`);
  // F188: the page's Cancel stops the download, the signer and the upload; B90: so does iOS's prompt cancelled
  const signal = eitherSignal(h.signal ?? null, ios?.signal ?? null);
  const guard = (p) => untilCancel(h, ios ? ios.race(p) : p);
  let cutOnce = false; // F257: the download was resumed at least once (the log said so)
  let ipaSize = 0; // F261: the IPA zsign got, for this browser's memory limit
  try {
    const ipa = bytes ? await guard(keptBytes(bytes))
      : await guard(downloadIpa(url, { base, fetcher, onProgress: dlPct, onBytes, onCut: ({ attempt, at }) => {
        cutOnce = true;
        h.page?.raw?.(droppedText(at)); // F257: grey, then the step
        h.set(reconnectText(attempt));
      }, ...(signal ? { signal } : {}) }));
    h.set("Signing");
    ipaSize = ipa?.byteLength ?? ipa?.length ?? 0;
    const self = isSelfIpa(url) || bring;
    const carry = self ? { identity: Boolean(bring), transfer: await transfer().catch(() => null) } : null;
    // own provisioning profiles: with an App Store Connect key, the App ID and Ad Hoc profile made for this app
    const keep = withKeep({}).keepBundleId !== false && !self;
    const made = keep ? await guard((await import("../screens/devaccount.js")).autoProfileSite({ ipa, id, bundleId: bundleId || null,
      log: (t) => h.page?.raw?.(t) })) : null;
    // F288: the tweaks kept for this app (screens/tweaks.js, Inject Tweaks on its IPA page), unpacked and prepared here
    const tweaks = !self && bundleId ? await guard((await import("../screens/tweaks.js")).preparedFor(bundleId)) : null;
    // F334: signed here before under another team or App ID: iOS refuses that update, so ask before signing
    const signProfile = made ?? id.profile;
    const ask = async (title, message, buttons) => (await alert({ title, message, buttons, cancel: 0 }))?.index === 1;
    const stop = () => { drop(); h.hide(); return false; };
    const target = signingTarget(signProfile, bundleId || (isSelfIpa(url) ? IFIZBOX_ID : null));
    const before = target ? resignNote(siteSigned(storage, target.bundleId), target, name) : null;
    if (before && !(await ask(RESIGN_TITLE, before, RESIGN_BUTTONS))) return stop();
    const signed = await guard(worker({ ipa: buffer(ipa), p12: buffer(id.p12), profile: buffer(signProfile), password: id.password ?? "", bring: carry,
        appBundleId: bundleId || (isSelfIpa(url) ? IFIZBOX_ID : null), ...withKeep({}), ...(tweaks ? { tweaks } : {}),
        ...refusing() },
      { onProgress: (t) => h.set(t), ...(signal ? { signal } : {}) }));
    noteSigned(storage, ipaSize); // F261
    for (const line of signed.signLog ?? []) console.info(line); // B327: the keychain groups and group fix it signed with
    keepIpaHash(storage, signed, { bundleId, version }); // F292: Report as Malicious sends it
    // F334: the job's warnings (B227: a group folder this profile lost), and the other-ID warning for an app whose ID
    // only the IPA knew, before anything goes to iOS
    const after = target ?? signingTarget(signProfile, signed.originalId || signed.bundleId);
    const late = !target && after ? resignNote(siteSigned(storage, signed.bundleId || after.bundleId), after, name || signed.name) : null;
    const warning = installWarningText([...(late ? [late] : []), ...(signed.warnings ?? [])]);
    if (warning && !(await ask(INSTALL_WARNING_TITLE, warning, INSTALL_WARNING_BUTTONS))) return stop();
    h.set("Uploading");
    const ipaBytes = signed.ipa instanceof Uint8Array ? signed.ipa : new Uint8Array(signed.ipa);
    // the early link takes this app only if it came out with the reserved bundle ID (iOS already has its manifest)
    intoEarly = Boolean(early && signed.bundleId === early.bundleId && (await reserved));
    if (!intoEarly) drop(); // the Ready to Install alert's own link follows
    const body =await guard(uploadSigned(ipaBytes, signed, { base, fetcher, onProgress: pct("Uploading"), token: intoEarly ? early.token : null,
      ...(signal ? { signal } : {}) }));
    ios?.stop(); // uploaded: watchInstall follows iOS from here
    if (h.cancelled) return false;
    if (after) rememberSiteSigned(storage, signed.bundleId || after.bundleId, after); // F334
    // F342: the signature's end and signer stamp, for the install record onInstalled writes (core/installed.js)
    noteSiteSignature([bundleId, signed.originalId, signed.bundleId], { expires: signed.expires, signer: signed.signer });
    onInstalled({ ...body, bundleId: signed.bundleId, name: signed.name, version: signed.version });
    const app = name || signed.name || "The app";
    if (intoEarly && clock() - early.at < EARLY_WINDOW) {
      // iOS's prompt was asked for at the tap and its download now gets the app: nothing more to tap here.
      // F190: the log follows iOS's requests on the link from here (watchInstall); not awaited past its first look.
      await watch(early.token, h, { base, fetcher, app: name || signed.name, itms: early.itms, open, alert,
        cause: siteCause(id, name || signed.name, me) }).first;
      return true;
    }
    h.hide();
    // The install link opens from the alert's Install tap (onTap runs inside the click): opened by script long after
    // the first tap, Safari asked "Open this page in iTunes?" first, or refused it as an invalid address.
    // F121: also the fallback when the early link couldn't be used, or iOS may have given up waiting for it.
    const { index } = await alert({ title: "Ready to Install", message: `${app} is signed. Tap Install, then Install again when iOS asks.`,
      buttons: ["Cancel", "Install"], cancel: 0, onTap: (i) => { if (i === 1) open(body.itms); } });
    return index === 1;
  } catch (e) {
    drop();
    if (ios?.cancelled && !h.cancelled) return iosCancelled(h, ios.token, { base, fetcher, alert, again }); // B90
    if (h.cancelled) return false; // F188: Cancel closed the page; no alert after it
    failed(h, String(e?.message ?? e));
    // F257: the download broke off past its last try: under the red error, what to do with iOS's icon (only once iOS
    // was sent to the early link: no icon can be left otherwise)
    if (cutOnce && e?.message === CUT_TEXT && opened) h.page?.warning?.(grayIconText(name));
    // F261: zsign ran out of memory: this browser remembers the size, and the alert says what that changes
    const oom = ipaSize > 0 && isOutOfMemory(e?.message);
    if (oom) noteOutOfMemory(storage, ipaSize);
    const message = String(e?.message ?? e) + (oom ? `\n\n${memoryNote(memoryLimit(storage) ?? ipaSize)}` : "") + (opened ? `\n\n${iconLeftText(name)}` : "");
    await alert({ title: e?.code === "malware" ? KNOWN_MALWARE : name ? `Couldn't Install ${name}` : "Couldn't Install", message, buttons: ["OK"] });
    return false;
  }
}
