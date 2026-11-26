// iFizBox's own update, bound to the real backend, bridge and storage (F72, F183). The logic is core/essential.js
// and core/selfupdate.js; app.js calls lookForUpdates() on every launch, Home's Reload and return, in the app only.
// No alert (user 2026-11-18): a newer iFizBox is a row on top of Changes, with its badge, and the iOS 6 banner
// "iFizBox X is out." once per version per session (user 2026-11-18: 0.9.2 showed no banner for 0.9.3).
//
//   sideload    iFizBox's own AltStore source and GitHub's latest release, both read every time; Changes' row takes
//               whichever is newer (upgradesWithSelf). Installing it (Changes' Upgrade, the app queue) signs it on
//               the phone (installSelfNow).
//   jailbreak   GitHub's release is read and kept; the row itself is apt's, from iFizBox's built-in repo.
import { installSelf, selfFromAltSource, selfUpgradeRow, saveInfo, loadInfo, withSelfUpgrade, selfInfoWith, lookForSelfUpdate,
  SELF_ALT_URL } from "./core/essential.js";
import { checkForUpdates, fetchRelease, newerRelease, unfinishedSelfUpdate, clearSelfUpdate } from "./core/selfupdate.js";
import { getBackend } from "./backend.js";
import { detectMode } from "./core/settings.js";
import { showAlert } from "./nav/alert.js";
import { installOnDevice } from "./signing/route.js";
import { NAME } from "./brand.js";
import { showBanner } from "./nav/banner.js";
import { installQueue } from "./queue.js";
import { appQueue } from "./app-queue.js";
import { SELF_ID } from "./core/essential.js";
import { renamedUpdateNotice } from "./core/push.js";
import { nativeBridge, hasNativeCall } from "./native.js";
import { catalog } from "./catalog.js"; // B464
import { settings } from "./settings-store.js"; // B464
import { compareVersions as compareAptVersions } from "./core/apt.js"; // B464

const native = () => nativeBridge();
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };

export const appVersion = () => native()?.call
  ? native().call("app.info", {}).then((i) => String(i?.version ?? ""), () => "")
  : Promise.resolve("");

// A link outside the web view: the shell's app.openURL (F72), else a plain navigation.
async function openOutside(url) {
  try {
    const r = await native()?.call?.("app.openURL", { url });
    if (r?.opened) return;
  } catch { /* an older shell: no app.openURL */ }
  location.href = url;
}

// ---- sideload: iFizBox's own AltStore source -----------------------------------------------------------------

export async function readSelfInfo() {
  // A fresh copy: raw.githubusercontent.com caches for 5 minutes, and a query of its own skips that cache.
  const info = selfFromAltSource(await getBackend().text(`${SELF_ALT_URL}?t=${Date.now()}`));
  if (info) {
    saveInfo(storage(), info);
    // Changes counts iFizBox's own upgrade from this (upgradesWithSelf): it may have counted before it was read at
    // launch (user 2026-11-18: the 0.3.8 banner came, Changes had no row and no badge).
    globalThis.dispatchEvent?.(new Event("ifizbox:self-info"));
  }
  return info;
}

// Changes (sideload): the upgrades with iFizBox's own row on top, from what the last check read: its source, or
// GitHub's release when that is newer (F183).
export async function upgradesWithSelf(upgrades) {
  // F291: the jailbreak build's "Security Patch Available" row on top, when one is listed for this iOS (screens/safety.js)
  if (detectMode() === "jailbreak") return import("./screens/safety.js").then((m) => m.patchUpgrades(upgrades)).catch(() => upgrades);
  if (detectMode() !== "sideload") return upgrades;
  const current = await appVersion();
  const info = selfInfoWith(loadInfo(storage()), newerRelease(storage(), current));
  if (!info) return upgrades;
  return withSelfUpgrade(upgrades, selfUpgradeRow(info, current));
}

export async function installSelfNow(row) {
  // The sideload app signs its own update on the phone and hosts it on the Signing Server (signing.install host:
  // true): straight to iOS's Install prompt, the key never leaves the phone. Without the bridge: installSelf.
  if (detectMode() === "sideload" && row?.ipa && hasNativeCall()) {
    // F280: a copy its signer renamed gets the update beside it (it keeps iFizBox's own ID now): said once
    if (await renamedUpdateNotice({ alert: showAlert }) === "cancel") return "cancelled";
    const ok = await installOnDevice({ url: row.ipa, name: NAME, host: true });
    return ok ? "installing" : "failed";
  }
  return installSelf(row, { alert: showAlert, open: openOutside });
}

// ---- launch, Home's Reload, a return ----------------------------------------------------------------------------

// Silent whatever it finds (F183): reads iFizBox's source (sideload) and GitHub's release, then Changes counts
// again (ifizbox:self-info). One at a time. Resolves core/essential.js lookForSelfUpdate's answer.
let running = null;
export function lookForUpdates() {
  const mode = detectMode();
  return (running ??= lookForSelfUpdate({
    mode,
    readSource: () => readSelfInfo(),
    checkRelease: () => checkForUpdates({ mode, storage: storage(), current: appVersion, release: () => fetchRelease({ native: native() }) }),
    changed: () => globalThis.dispatchEvent?.(new Event("ifizbox:self-info")),
  }).then(async (r) => {
    if (!(await unfinishedOnce(mode).catch(() => false))) await bannerOnce(mode).catch(() => {});
    return r;
  }).finally(() => { running = null; }));
}

// B83: at launch (once a page load), a sideload self-update recorded earlier that app.info doesn't show yet: a banner
// says it didn't finish, with Try Again (bannerUpgrade), in place of "X is out." for this check. -> true when shown.
let unfinishedChecked = false;
export async function unfinishedOnce(mode, { current = appVersion, banner = showBanner, upgrade = bannerUpgrade } = {}) {
  if (unfinishedChecked || mode !== "sideload") return false;
  unfinishedChecked = true;
  const v = unfinishedSelfUpdate(storage(), await current());
  if (!v) return false;
  clearSelfUpdate(storage()); // said once; Try Again records it again
  bannerSeen.version = v;
  banner({ title: NAME, message: `${NAME} ${v} didn't finish installing.`, action: { label: "Try Again", onClick: () => { upgrade(); } } });
  return true;
}

// The newer iFizBox the last check found, as Changes' row has it: sideload the source or GitHub's release, jailbreak
// GitHub's, once apt's row has it too (B464, aptHasSelf). Upgrade queues it and opens Confirm (B44). Once per version per
// session, unless Upgrade was tapped: then it comes back at the next check once iFizBox is out of the queue again
// (user 2026-11-18: Upgrade, then Cancel on Confirm, and the banner never showed again).
export const bannerSeen = { version: null };
const selfQueued = () => !!(installQueue.get(SELF_ID) || appQueue.get(SELF_ID));

// Whether the banner for version `v` shows now: there is one, it hasn't shown this session, iFizBox isn't queued.
export const bannerDue = (v, { shown = bannerSeen.version, queued = selfQueued() } = {}) => !!v && shown !== v && !queued;

// B464: the jailbreak banner's Upgrade queues apt's iFizBox row and Changes' Upgrade (N) counts apt's rows, but GitHub's
// release can be out before apt's lists have it (the repo published later, or no refresh since). -> whether the catalog
// has iFizBox's apt upgrade at `v` or newer, outside Ignored Upgrades as Changes reads them.
const aptUpgrades = () => catalog.upgrades([...settings.holds.list(), ...settings.blocked.list()]);
export async function aptHasSelf(v, { upgrades = aptUpgrades } = {}) {
  const u = await Promise.resolve().then(upgrades).catch(() => null);
  const row = (u?.available ?? []).find((r) => r?.id === SELF_ID);
  return !!row && compareAptVersions(row.version, v) >= 0;
}

// Without apt's row yet the jailbreak banner waits for the next catalog load (a refresh) and looks again; one wait at a time.
let aptWait = null;
export async function bannerOnce(mode, { current = appVersion, banner = showBanner, aptHas = aptHasSelf,
  onLoaded = (f) => catalog.onLoaded(f) } = {}) {
  const now = await current();
  const release = newerRelease(storage(), now);
  const v = mode === "sideload" ? selfUpgradeRow(selfInfoWith(loadInfo(storage()), release), now)?.version : release?.version;
  if (!bannerDue(v)) return false;
  if (mode === "jailbreak" && !(await aptHas(v))) {
    aptWait ??= onLoaded(() => {
      aptWait?.();
      aptWait = null;
      bannerOnce(mode, { current, banner, aptHas, onLoaded }).catch(() => {});
    });
    return false;
  }
  if (!bannerDue(v)) return false; // shown while apt's row was read
  bannerSeen.version = v;
  banner({ title: NAME, message: `${NAME} ${v} is out.`, action: { label: "Upgrade", onClick: () => { bannerUpgrade(); } } });
  return true;
}

// B44: Upgrade queues iFizBox's own upgrade and opens Confirm (screens/changes.js upgradeSelf), or Changes when its row
// isn't there yet. A dynamic import: changes.js imports this module. The tap gives the banner its "once" back.
export function bannerUpgrade({ load = () => import("./screens/changes.js") } = {}) {
  bannerSeen.version = null;
  return load().then((m) => m.upgradeSelf(), () => { location.hash = "#/changes"; return "changes"; });
}
