// Settings > Signing in the sideload build, under the walkthrough (F68, F14's calls): Certificate Status, with Check
// Certificate (signing.checkCertificate: Apple's OCSP answer) and red warnings when Apple revoked the certificate or
// signatures end within 7 days (core/signing.js certificateWarnings), and Signed Apps from signing.installed, with
// Re-sign All (signing.resignAll, the HUD following each app) and a left swipe on an app to forget it
// (signing.forget). settings.js drawDeviceSigning puts what signingExtras() returns into the page.
// F91: Re-sign All queues every app as a "resign" job (core/appqueue.js resignJob) and opens Confirm (screens/queue.js
// queueApp), which signs each through signing.resign, iFizBox last, instead of running at once.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped, collapse } from "../nav/ui.js";
import { showAlert, alertOK } from "../nav/alert.js";
import { liveHUD } from "../nav/hud.js";
import { certificateWarnings, revocationLabel, resignLabel, signedAppRows, deviceError, callWithStall } from "../core/signing.js";
import { resignJob } from "../core/appqueue.js";
import { signedAppsNamed } from "../core/installed.js"; // B150
import { getServer } from "../signing/identity.js";
import { chooseRoute } from "../signing/route.js";
import { loadStyle } from "../nav/motion.js";
import { nativeBridge } from "../native.js";

function style() { loadStyle("signsheet.css"); }

const day = (iso) => { const d = new Date(iso ?? ""); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(); };

// `identity`: signing.status's identity (null without one). `redraw()` draws the page again (status asked anew).
// F134: `dates` false (Settings > Signing > Show Expiry Dates off) leaves Signed Apps' days left out; Expired stays.
export function signingExtras({ identity = null, redraw = () => {}, native = nativeBridge(), alert = showAlert, hud = liveHUD, dates = true } = {}) {
  style();
  const box = document.createElement("div");
  box.className = "signed-apps";
  if (identity) box.append(statusGroup(identity, { redraw, native, alert, hud }));
  const apps = document.createElement("div");
  box.append(apps);
  fillApps(apps, { identity, redraw, native, alert, hud, dates });
  return box;
}

// F316 (AGENTS.md Hints): the footer is the most important warning (revoked first), else when Apple was last asked;
// when signatures made now end is a status row, not a sentence. Pure, for the tests.
export const STATUS_UNCHECKED = "Asks Apple whether the certificate is still good.";
export const SIGNATURES_UNTIL = "Signatures Until";
export function statusLayout(identity, now = new Date()) {
  const rev = identity?.revocation ?? null;
  const warnings = certificateWarnings(identity, now);
  const checked = rev?.checked ? day(rev.checked) : null;
  const until = identity?.signatureExpires ? day(identity.signatureExpires) : null;
  return {
    rows: [{ label: "Check Certificate", detail: revocationLabel(rev) }, ...(until ? [{ label: SIGNATURES_UNTIL, detail: until }] : [])],
    footer: warnings[0] ?? (checked ? `Last checked ${checked}.` : STATUS_UNCHECKED),
    warn: warnings.length > 0,
  };
}

function statusGroup(identity, { redraw, native, alert, hud }) {
  const rev = identity.revocation ?? null;
  const { rows, footer, warn } = statusLayout(identity);
  const frag = grouped([{ header: "Certificate Status", footer,
    rows: rows.map((r, i) => (i === 0 ? { ...r, onClick: () => check({ redraw, native, alert, hud }) } : r)) }]);
  const g = frag.querySelector(".group");
  if (warn) g.querySelector(".group-footer")?.classList.add("sign-warning");
  if (rev?.status === "revoked") g.querySelector(".cell-detail")?.classList.add("sign-warning-text");
  return g;
}

async function check({ redraw, native, alert, hud }) {
  const h = hud("Checking");
  let r;
  try {
    r = await native.call("signing.checkCertificate", {});
  } catch (e) {
    h.hide();
    await alertOK("Couldn't Check", deviceError(e).message, alert);
    return;
  }
  h.hide();
  if (r?.status === "revoked") {
    await alertOK("Certificate Revoked", `Apple revoked it${r.revokedAt ? ` on ${day(r.revokedAt)}` : ""}. Apps signed with it won't open. Import a new certificate.`, alert);
  } else if (r?.status === "unknown") {
    await alertOK("Not Known", "Apple's answer didn't say whether this certificate is good or revoked. Try again later.", alert);
  }
  redraw();
}

async function fillApps(box, { identity, redraw, native, alert, hud, dates = true }) {
  let installed;
  try {
    installed = await signedAppsNamed(native); // B150: a source app keeps its source name
  } catch {
    return; // an older shell without the call: no list
  }
  const rows = signedAppRows(installed);
  const next = dates && installed?.next?.expires ? day(installed.next.expires) : null;
  const sections = [{ header: "Signed Apps",
    rows: rows.length ? rows.map((r) => ({ label: r.label, subtitle: r.subtitle, detail: dates || r.detail === "Expired" ? r.detail : undefined })) : [{ label: "None Yet" }],
    footer: rows.length
      // F134: one line (Settings > Signing's footers); Confirm says what Re-sign All does
      ? `Soonest to expire first${next ? ` (next: ${next})` : ""}. Swipe left on one to forget it.`
      : "Apps you install with your certificate show here, with when their signatures end." }];
  if (rows.length && identity) sections.push({ rows: [{ label: "Re-sign All", onClick: () => queueResignAll(rows) }] });
  box.replaceChildren(grouped(sections));
  if (!rows.length) return;
  const cells = box.querySelectorAll(".group")[0].querySelectorAll(".cell");
  rows.forEach((r, i) => armable(cells[i], r, { native, alert, redraw }));
  attachSwipe(box.querySelector(".table"));
}

// A row with sources.css's red Delete, shown by a left swipe; Delete forgets the app (it stays installed).
function armable(li, row, { native, alert, redraw }) {
  li.classList.add("signed-row");
  if (row.expiring) li.classList.add("is-expiring");
  const del = Object.assign(document.createElement("button"), { type: "button", className: "del-confirm", textContent: "Delete" });
  del.setAttribute("aria-label", `Forget ${row.label}`);
  del.addEventListener("click", async () => {
    li.classList.add("removing");
    try {
      await native.call("signing.forget", { bundleId: row.bundleId });
    } catch (e) {
      li.classList.remove("removing", "armed");
      await alertOK("Couldn't Forget", deviceError(e).message, alert);
      return;
    }
    setTimeout(() => { collapse(li); if (!li.parentNode?.querySelector?.(".signed-row")) redraw(); }, 200);
  });
  li.append(del);
}

function attachSwipe(ul) {
  if (!ul) return;
  let start = null;
  let swiped = false;
  const arm = (li, on) => {
    for (const o of ul.querySelectorAll(".signed-row.armed")) if (o !== li) o.classList.remove("armed");
    li.classList.toggle("armed", on);
  };
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".del-confirm")) return;
    const armed = ul.querySelector(".signed-row.armed");
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);
  ul.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".signed-row");
    swiped = false;
    start = li && !e.target.closest(".del-confirm") ? { li, x: e.clientX, y: e.clientY } : null;
  });
  ul.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; }
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    arm(start.li, dx < 0);
    swiped = true;
    start = null;
  });
  const stop = () => { start = null; };
  ul.addEventListener("pointerup", stop);
  ul.addEventListener("pointercancel", stop);
}

// F91: every signed app queued for Re-sign; the first add opens Confirm, the rest redraw it. -> the jobs queued.
export async function queueResignAll(rows, { add = null } = {}) {
  add ??= (await import("./queue.js")).queueApp;
  const jobs = (rows ?? []).map((r) => resignJob(r)).filter(Boolean);
  for (const j of jobs) add(j);
  return jobs;
}

// B502a1b: a free Apple ID (and Apple's session of its team): the recorded apps' App IDs, lapsed ones made again, and
// their profiles handed in, as the shell signs an app under a free profile only with its own App ID's. Never throws:
// without them the shell names the apps it can't sign.
export async function handFreeProfiles(native, { session = null } = {}) {
  let s = null;
  try {
    // lazily, as signing/queue.js does
    const [{ liveSession, pinnedProfile }, { otherProfiles }, { b64encode }] = await Promise.all(
      [import("../signing/freeappid.js"), import("../core/freeroute.js"), import("../core/gsa.js")]);
    s = await (session ?? liveSession)();
    const held = s && await pinnedProfile(native);
    if (!held || s.teamId !== held.team) return;
    const apps = (await native.call("signing.installed", {}))?.apps ?? [];
    const { appIds } = await s.portal.listAppIds(held.team);
    for (const p of await otherProfiles({ portal: s.portal, teamId: held.team, appIds, apps })) {
      await native.call("signing.addProfile", { profile: b64encode(p) });
    }
  } catch (e) {
    if (e?.kind === "session") s?.end?.();
  }
}

// Before F91: signing.resignAll straight away, the HUD following each app. Kept for a caller that wants it at once.
export async function resignAll(count, { redraw, native, alert, hud, session }) {
  const { index } = await alert({ title: "Re-sign All?",
    message: `${count === 1 ? "The app is" : `All ${count} apps are`} downloaded again, signed with your current certificate and installed, one after another. iOS asks before each install.`,
    buttons: ["Cancel", "Re-sign"], cancel: 0 });
  if (index !== 1) return;
  const route = await chooseRoute({ native, alert });
  if (!route) return;
  const h = hud("Re-signing");
  let r;
  await handFreeProfiles(native, { session });
  try {
    // F75: each install takes its manifest from the Signing Server, as signing.install does (This iPhone: none)
    r = await callWithStall(native, "signing.resignAll", { manifestServer: getServer(), ...route }, (ev) => { const t = resignLabel(ev); if (t) h.set(t); }); // B65
  } catch (e) {
    h.hide();
    await alertOK("Couldn't Re-sign", deviceError(e).message, alert);
    return;
  }
  h.hide();
  const done = r?.done?.length ?? 0;
  const failed = Array.isArray(r?.failed) ? r.failed : [];
  if (failed.length) {
    await alertOK(done ? `Re-signed ${done} of ${done + failed.length}` : "Couldn't Re-sign",
      failed.map((f) => `${f.name || f.bundleId}: ${f.error || "failed"}`).join("\n"), alert);
  }
  redraw();
}
