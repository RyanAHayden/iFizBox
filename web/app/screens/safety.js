// The safety nets on screen (F291, concept K2 option B: https://claude.ai/artifact/8BZsvsM6KmMkx3ei4E16cz). The rules
// are pure JS in core/ios-exposure.js, core/safe-sources.js, core/trust.js and core/malicious.js; this file binds them
// to alerts, rows and storage. Styles: sources.css (.trust-pill, .safety-banner).
//
//   installSafety(jobs, deps)       -> true to go on. Before a run of installs (the app queue's Confirm, the website's
//                                      Install): Known Malware refuses (no Install Anyway); then, on an exploitable iOS
//                                      version, the one-time "Check Before You Install" when an app comes from a source
//                                      the user hasn't trusted. Never a block otherwise; quiet in the jailbreak build.
//   confirmUnknownSource(input, deps) -> null (Cancel) or { trust } after Enter APT URL, for a source not on the
//                                      known-safe list (Add & Trust / Add Source / Cancel). Known-safe sources, and
//                                      piracy hosts (which had Source Warning already), pass with no second alert.
//   trustPill(kind), labelSource(li, source)  the Known Safe / Trusted pill (Unknown: the plain word) under a row's name
//   toggleTrust(source)              the source row's hold menu: Trust Source / Stop Trusting
//   whereFromGroup(app, { source, sourceName, sourceUrl, github, reports })  the app page's "Where It Comes From"
//   reportMalicious({ id, version, name }, deps) the Reviews tab's Report as Malicious: the reasons sheet, then send
//   lookForPatch(deps)               the jailbreak build at launch: Security Patch Available (Install Patch / Later)
//   patchUpgrades(upgrades, deps)    Changes' rows with the patch's row on top (the jailbreak build)
import { el, grouped } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { go as navGo } from "../nav/go.js";
import { detectMode } from "../core/settings.js";
import { exposureOf, exposureDue, exposureAlert, loadSeen, markSeen, SOFTWARE_UPDATE, SOFTWARE_UPDATE_URL, patchesFor, duePatch,
  patchAlert, patchRow, loadSnooze, snoozePatch } from "../core/ios-exposure.js";
import { trustOf, loadTrusted, setTrusted, untrustedJobs, unknownSourceAlert, TRUST_LABEL } from "../core/trust.js";
import { knownSafe } from "../core/safe-sources.js";
import { sourceWarning, inputHost } from "../core/warnings.js";
import { MALICIOUS_REASONS, OTHER_REASON, REPORT_TEXT_MAX, reportBody, reportsApi, malwareIpa, malwareAlert, bannerOf, ipaHash,
  WHY_LISTED, reportedAlert, INSTALL_ANYWAY } from "../core/malicious.js";
import { reviewsBase } from "../core/reviews.js";
import { nativeBridge } from "../native.js";
import { IdMap } from "../core/apt.js";

const local = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const session = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };
const native = () => nativeBridge();
export const trustedNow = (storage = local()) => loadTrusted(storage);

async function openOutside(url) {
  try { const r = await native()?.call?.("app.openURL", { url }); if (r?.opened) return true; } catch { /* an older shell */ }
  return false;
}

// ---- before installing ------------------------------------------------------------------------------------------

// deps: { alert, mode, ios() -> string | null, machine() -> hw.machine | null, storage, trusted, open(url) }
// `summary(id, version)`: the reports for an app's version (reports().summary), asked for each app at once, at most
// REPORTS_WAIT ms: unreachable or slow says nothing.
export const REPORTS_WAIT = 2000;
const approved = new Set();
export async function installSafety(jobs, { alert = showAlert, mode = detectMode(), ios = currentIos, storage = local(),
  trusted = trustedNow(storage), open = openOutside, canOpenSettings = Boolean(native()?.call),
  summary = (id, v) => reports().summary(id, v), wait = REPORTS_WAIT, machine = currentMachine } = {}) {
  const list = (jobs ?? []).filter((j) => j && j.op !== "remove");
  const idOf = (j) => (typeof j.bundleId === "string" && j.bundleId) || (typeof j.id === "string" && !j.id.startsWith("library:") ? j.id : null);
  for (const j of list) {
    const bad = malwareIpa({ bundleId: idOf(j), version: j.version ?? null, sha256: j.sha256 ?? null });
    if (!bad) continue;
    const a = malwareAlert(bad, j.name || "");
    const { index } = await alert(a);
    if (a.buttons[index] === WHY_LISTED && bad.link) await open(bad.link).then((ok) => ok || globalThis.open?.(bad.link, "_blank", "noopener"));
    return false;
  }
  // A version reported by enough devices: Install asks first (Cancel / Install Anyway)
  const timeout = (p) => {
    let t = 0;
    return Promise.race([Promise.resolve().then(p).catch(() => null), new Promise((r) => { t = setTimeout(() => r(null), wait); })])
      .finally(() => clearTimeout(t));
  };
  const asked = await Promise.all(list.filter((j) => j.mode !== "resign" && idOf(j))
    .map(async (j) => ({ j, s: await timeout(() => summary(idOf(j), String(j.version ?? ""))) })));
  for (const { j, s } of asked) {
    const k = `${idOf(j)}@${j.version ?? ""}`;
    if (!bannerOf(s) || approved.has(k)) continue;
    const a = reportedAlert(j.name || idOf(j));
    if (a.buttons[(await alert(a)).index] !== INSTALL_ANYWAY) return false;
    approved.add(k); // asked once a session: the queue's run and the sign after it don't ask twice
  }
  const v = await Promise.resolve().then(ios).catch(() => null);
  const seen = loadSeen(storage);
  if (!exposureDue({ mode, ios: v, untrusted: untrustedJobs(list, { trusted }).length > 0, seen })) return true;
  const ex = exposureOf(v, undefined, { machine: await Promise.resolve().then(machine).catch(() => null) });
  const a = exposureAlert(ex, { canOpenSettings });
  markSeen(storage, ex.ios);
  const { index } = await alert(a);
  if (a.buttons[index] === SOFTWARE_UPDATE) { await open(SOFTWARE_UPDATE_URL); return false; }
  return true;
}

// The phone's model (hw.machine) from the app's app.info, so the alert names only a fix the model can get. The site
// can't tell the model (the user agent says "iPhone"): any update counts as in reach there.
async function currentMachine() {
  const info = await native()?.call?.("app.info", {});
  return typeof info?.machine === "string" ? info.machine : null;
}

async function currentIos() {
  const { currentDevice } = await import("../device.js");
  return currentDevice().ios;
}

// ---- Add Source ------------------------------------------------------------------------------------------------

export async function confirmUnknownSource(input, { alert = showAlert } = {}) {
  if (knownSafe(input) || sourceWarning(input)) return { trust: false };
  const host = inputHost(input);
  if (!host) return { trust: false }; // the add itself says what's wrong with it
  const { index } = await alert(unknownSourceAlert(host));
  if (index === 2) return null;
  return { trust: index === 0 };
}

export const markTrusted = (input, storage = local()) => setTrusted(storage, typeof input === "string" ? { uri: input } : input, true);

// ---- labels ----------------------------------------------------------------------------------------------------

export function trustPill(kind) {
  if (kind === "unknown") return el("span", "trust-word", TRUST_LABEL.unknown);
  return el("span", `trust-pill${kind === "trusted" ? " trust-pill-grey" : ""}`, TRUST_LABEL[kind] ?? "");
}

// The pill (or "Unknown ·") at the start of a row's subtitle.
export function labelSource(li, source, { trusted = trustedNow() } = {}) {
  const sub = li?.querySelector(".cell-subtitle");
  if (!sub || sub.querySelector(".trust-pill, .trust-word")) return;
  const kind = trustOf(source, { trusted });
  li.dataset.trust = kind;
  sub.prepend(trustPill(kind), kind === "unknown" ? " · " : " ");
}

export function toggleTrust(source, { storage = local() } = {}) {
  const on = trustOf(source, { trusted: trustedNow(storage) }) !== "trusted";
  setTrusted(storage, source, on);
  globalThis.dispatchEvent?.(new Event("ifizbox:trust"));
  return on;
}
export const trustMenuLabel = (source) => (trustOf(source, { trusted: trustedNow() }) === "trusted" ? "Stop Trusting" : "Trust Source");

// ---- the app page ----------------------------------------------------------------------------------------------

export const PUBLIC_CODE_FOOTER = "Apps with public source code can be checked by anyone.";
// github: { owner, repo } (core/previews.js appGithub) when the app's source code is public there.
export function whereFromGroup({ source = null, sourceName = "", sourceUrl = "", github = null, onSource = null } = {}, { trusted = trustedNow() } = {}) {
  const kind = trustOf(source ?? (sourceUrl ? { uri: sourceUrl } : null), { trusted });
  const owner = github?.owner ?? github?.user;
  const code = owner && github?.repo ? `https://github.com/${owner}/${github.repo}` : null;
  const sourceRow = { label: "Source", detail: `${sourceName || "Unknown"}`, ...(onSource ? { onClick: onSource, chevron: true } : {}) };
  const rest = [
    code ? { label: "Source Code", detail: "Public on GitHub", onClick: () => window.open(code, "_blank", "noopener"), chevron: true, cls: "where-code-public" }
      : { label: "Source Code", detail: "Not Public", cls: "where-code-hidden" },
    { label: "Reports", detail: "None", cls: "where-reports" },
  ];
  const footer = kind === "safe" ? `${sourceName || "This source"} is on the known-safe list.`
    : kind === "trusted" ? `You marked ${sourceName || "this source"} as Trusted.`
      : `${sourceName || "This source"} isn't on the known-safe list. That doesn't make it bad.`;
  // F314: each hint under the rows it explains (AGENTS.md, Hints): the trust label under Source, the public-code note
  // under Source Code and Reports; one box (.where-from) holds both groups.
  const box = document.createElement("div");
  box.className = "where-from";
  box.append(grouped([{ header: "Where It Comes From", rows: [sourceRow], footer },
    { rows: rest, footer: code ? PUBLIC_CODE_FOOTER : null }]));
  const detail = box?.querySelector("li .cell-detail");
  if (detail) { detail.append(kind === "unknown" ? " · " : " "); detail.append(trustPill(kind)); }
  return { node: box, setReports(summary) {
    const cell = box?.querySelector(".where-reports .cell-detail");
    if (!cell || !summary?.enabled) return;
    cell.textContent = summary.count ? summary.count.toLocaleString() : "None";
    cell.classList.toggle("where-reports-bad", summary.count > 0);
  } };
}

// The red card for a version reported by enough devices (core/malicious.js bannerOf), or null.
export function reportBanner(summary) {
  const b = bannerOf(summary);
  if (!b) return null;
  const card = el("div", "safety-banner");
  card.append(el("b", "safety-banner-title", b.title), el("span", "safety-banner-text", b.message));
  return card;
}

export const reports = () => reportsApi({ base: reviewsBase(detectMode()) });

// ---- Report as Malicious ---------------------------------------------------------------------------------------

export async function reportMalicious({ id, version = "", name = "" }, { ask = showActionSheet, alert = showAlert, api = reports(),
  hash = (b, v) => ipaHash(local(), b, v) } = {}) {
  const i = await ask({ title: `What did ${name || "it"} do? Anonymous, one per device per version.`, buttons: MALICIOUS_REASONS.map((r) => r.label) });
  if (i < 0 || i >= MALICIOUS_REASONS.length) return "cancelled";
  const reason = MALICIOUS_REASONS[i].id;
  let text = "";
  if (reason === OTHER_REASON) {
    const r = await alert({ title: "Something Else", message: "What did it do? A few words.", input: { placeholder: "It…", value: "", type: "text", maxLength: REPORT_TEXT_MAX },
      buttons: ["Cancel", "Report"], cancel: 0 });
    if (r.index !== 1) return "cancelled";
    text = r.value ?? "";
  }
  const p = reportBody({ reason, text, version, sha256: hash(id, version) });
  if (!p.ok) { await alert({ title: "Not Reported", message: p.error, buttons: ["OK"] }); return "invalid"; }
  try {
    await api.send(id, p.body);
  } catch (e) {
    await alert({ title: "Not Reported", message: e?.code === "rate_limited" ? "Too many reports from here. Try again later." : e?.message ?? "Try again later.", buttons: ["OK"] });
    return "failed";
  }
  await alert({ title: "Reported", message: "Thank you. Reports from several people put a warning on this version, and confirmed ones go on the known-malware list.", buttons: ["OK"] });
  return "sent";
}

// ---- the jailbreak build: security patches ----------------------------------------------------------------------

let asked = false; // once per launch
// deps: { mode, ios(), installed() -> Map id -> version, alert, install(patch), storage }. -> the patch offered, or null
export async function lookForPatch({ mode = detectMode(), ios = currentIos, installed = installedPackages, alert = showAlert, install = installPatch,
  storage = session() } = {}) {
  if (mode !== "jailbreak" || asked) return null;
  const patches = patchesFor(await Promise.resolve().then(ios).catch(() => null));
  if (!patches.length) return null;
  const have = await Promise.resolve().then(installed).catch(() => null);
  if (!have?.size) return null; // dpkg's status not read yet: a jailbroken phone always lists packages; ask next time
  const p = duePatch(patches, have, loadSnooze(storage));
  if (!p) return null;
  asked = true;
  const { index } = await alert(patchAlert(p));
  if (index === 1) await install?.(p);
  else snoozePatch(storage, p);
  return p;
}
export const resetPatchAsked = () => { asked = false; };

// `keyOf(id)`: the catalog key of a source listing the package (its row opens that package page), else null: then
// no row (its repo isn't added yet; the launch alert adds it).
export async function patchUpgrades(upgrades, { mode = detectMode(), ios = currentIos, installed = installedPackages, keyOf = catalogKeyOf } = {}) {
  if (mode !== "jailbreak") return upgrades;
  const patches = patchesFor(await Promise.resolve().then(ios).catch(() => null));
  const p = patches.length ? duePatch(patches, await Promise.resolve().then(installed).catch(() => new Map())) : null;
  if (!p) return upgrades;
  const available = upgrades?.available ?? [];
  if (available.some((r) => r.id === p.id)) return upgrades;
  const key = await Promise.resolve().then(() => keyOf(p.id)).catch(() => null);
  if (!key) return upgrades;
  return { ...upgrades, available: [patchRow(p, key), ...available], ignored: upgrades?.ignored ?? [] };
}

// The jailbreak build's installed packages (dpkg's status through the catalog) as id -> version.
export async function installedPackages() {
  const { catalog } = await import("../catalog.js");
  return new IdMap(((await catalog.installed().catch(() => null)) ?? []).map((r) => [r.id, r.version ?? ""]));
}

export async function catalogKeyOf(id) {
  const { catalog } = await import("../catalog.js");
  const pkg = await catalog.package(id, "*").catch(() => null);
  return pkg && !pkg.installedOnly ? pkg.key ?? null : null;
}

// Install Patch: the patch's repo added and refreshed, then its page with the package queued (Confirm opens), as
// Extras' Add Source & Install does (screens/extras.js addSourceAndInstall).
export async function installPatch(p) {
  const [{ addSourceAndInstall }, { catalog }, { getBackend }, { showHUD }] = await Promise.all([import("./extras.js"),
    import("../catalog.js"), import("../backend.js"), import("../nav/hud.js")]);
  return addSourceAndInstall({ id: p.id, name: p.name, repo: { uri: p.repo, name: p.repo } }, {
    backend: getBackend(), catalog, showHUD, showAlert, go: navGo });
}
