// F254: the free Apple ID route's setup, pure (no DOM, no storage of its own): after sign-in it runs by itself as a
// checklist, Register This iPhone, then reuse or make the certificate, then the App ID, then the profile, and stops to
// ask only at Apple's certificate limit (which certificate to revoke, with the warning).
//
// Shape (user 2026-11-19, after R32): iOS refuses free-profile apps from itms-services (MIInstallerErrorDomain 111),
// so the website doesn't install on this route. It signs in, keeps the development key and certificate in the browser
// for their year, makes the profiles, and hands the identity to the app on the phone, which installs through
// installation_proxy (F15). docs/signing.md "Free Apple ID".
//
//   SETUP_STEPS                          [{ id, title }]: device, certificate, appId, profile
//   freeAppId(bundleId, teamId)          <bundleId>.<TEAMID>: App IDs are unique across Apple, so a free team's are
//                                        always suffixed (Keep Bundle IDs stays off on this route)
//   pickTeam(teams)                      the free (Personal) team, else the first
//   await runSetup({ portal, teamId, phone, saved, bundleId, appName, onStep, askRevoke, make, app })
//       `app` true in the app: summaries name no browser (reusedSummary)
//       -> { identity, profile, appId, appIds, steps }; onStep({ id, state: "running" | "done" | "failed", summary })
//       identity: { teamId, serial, p12, password, expires, made }: `made` true when this run made it (save it)
//   freeEntitlements(appEnts, profile)   zsign's entitlements for an app on this route: get-task-allow as the
//                                        profile allows (R32: false gave "integrity could not be verified"), no
//                                        aps-environment (Personal Teams have no Push), the profile's keychain group
//                                        (F436: a TEAM.* one narrowed to the app's own, which native OwnKeychain looks for)
//   FREE_EXPIRY_WARNING                  3 days: "Expiring soon" on this route (not the certificate route's setting)
//   freeExpiry(expires, now)             { state: "ok" | "soon" | "expired", days }
//   setupError(e)                        an alert { title, message } for a setup step that failed
//   await refreshApps({ native, portal, teamId, appIds, appId, hud, alert })
//                                        F458, the app, after a setup: signing.refresh renews the installed apps'
//                                        profiles (nothing signed or installed again) and signs the rest again
// SPDX-License-Identifier: GPL-3.0-or-later
import { parseProfile, normalUdid, callWithStall, resignLabel, deviceError } from "./signing.js";
import { b64encode } from "./gsa.js";
import { makeKey, makeCsr, makeP12, sameKey, certSerial, newPassword } from "./freecert.js";
import { NAME } from "../brand.js";

export const SETUP_STEPS = [
  { id: "device", title: "Register This iPhone" },
  { id: "certificate", title: "Development Certificate" },
  { id: "appId", title: "App ID" },
  { id: "profile", title: "Provisioning Profile" },
];

export const freeAppId = (bundleId, teamId) => {
  const id = String(bundleId ?? "");
  const t = String(teamId ?? "");
  return id.toUpperCase().endsWith(`.${t.toUpperCase()}`) ? id : `${id}.${t}`;
};

export function pickTeam(teams = []) {
  return teams.find((t) => t?.xcodeFreeOnly || /free|xcode|individual/i.test(String(t?.type ?? ""))) || teams[0] || null;
}

const issued = (c) => !/revoked|expired/i.test(String(c?.status ?? "Issued"));
const bytes = (v) => (v instanceof Uint8Array ? v : v ? new Uint8Array(v) : null);
const dateOf = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

// Certificates other tools made (SideStore, AltStore, Sideloadly...): revoking one stops every app that tool signed.
// The alert shows machineName, else name, so both are checked.
export const otherTool = (c) => /sidestore|altstore|sideloadly|xcode|feather|livecontainer|iloader/i
  .test(`${c?.machineName ?? ""} ${c?.name ?? ""}`);
export const MACHINE_NAME = `${NAME} Website`;
// Revoke order: ours first, then certificates of unknown origin, other tools' last (stable within each).
export const revokeRank = (c) => (String(c?.machineName ?? "").startsWith(NAME) ? 0 : otherTool(c) ? 2 : 1);

// Apple's "you have too many development certificates" answers (7460 is the one AltStore and SideStore name).
export const atCertLimit = (e) => Number(e?.code) === 7460 || /maximum|limit|already have a current/i.test(String(e?.message ?? ""));
export const atAppIdLimit = (e) => Number(e?.code) === 9401 || /maximum.*app id|app id.*limit|cannot create more than/i.test(String(e?.message ?? ""));

// The certificate step: ours if Apple still lists it as issued, else a new key and CSR. At the limit `askRevoke`
// gets the issued certificates (ours first, other tools' last) and answers a serial to revoke, or null to stop.
// The reuse summary: the website keeps the record in the browser; the app's may come from the app or a computer install.
export const reusedSummary = (app) => (app ? "Reused the saved certificate" : "Reused this browser's certificate");

async function certificate({ portal, teamId, saved, askRevoke, make, name, app }) {
  let certs = await portal.listCerts(teamId);
  const mine = saved && saved.teamId === teamId && saved.p12 && saved.serial
    ? certs.find((c) => String(c.serialNumber ?? "").toUpperCase() === saved.serial && issued(c)) : null;
  if (mine) return { identity: { ...saved, made: false }, summary: reusedSummary(app) };

  const key = await make.key();
  const csr = await make.csr({ privateKey: key.privateKey, spki: key.spki, cn: name });
  try {
    await portal.submitCsr(teamId, csr, MACHINE_NAME);
  } catch (e) {
    if (!atCertLimit(e)) throw e;
    const choices = certs.filter(issued).sort((a, b) => revokeRank(a) - revokeRank(b));
    const serial = await askRevoke(choices);
    if (!serial) throw Object.assign(new Error("No certificate was revoked, so Apple can't make a new one."), { kind: "cancelled", step: "certificate" });
    await portal.revokeCert(teamId, serial);
    await portal.submitCsr(teamId, csr, MACHINE_NAME);
  }
  certs = await portal.listCerts(teamId);
  const found = certs.find((c) => bytes(c.certContent) && sameKey(bytes(c.certContent), key.spki));
  if (!found) throw Object.assign(new Error("Apple took the request but hasn't listed the new certificate yet. Try again in a minute."), { step: "certificate" });
  const cert = bytes(found.certContent);
  const password = make.password();
  const p12 = await make.p12({ pkcs8: key.pkcs8, cert, password, name });
  return {
    identity: { teamId, serial: certSerial(cert), p12, password, expires: dateOf(found.expirationDate), made: true },
    summary: "Made a new certificate",
  };
}

export async function runSetup({ portal, teamId, phone, saved = null, bundleId, appName = "App", onStep = () => {},
  askRevoke = async () => null, make = {}, name = MACHINE_NAME, app = false } = {}) {
  const mk = { key: makeKey, csr: makeCsr, p12: makeP12, password: newPassword, ...make };
  const steps = {};
  const run = async (id, fn) => {
    onStep({ id, state: "running" });
    try {
      const r = await fn();
      steps[id] = r.summary;
      onStep({ id, state: "done", summary: r.summary });
      return r;
    } catch (e) {
      if (!e.step) e.step = id;
      onStep({ id, state: "failed", summary: e.message });
      throw e;
    }
  };

  const udid = normalUdid(phone?.udid);
  await run("device", async () => {
    if (!udid) throw Object.assign(new Error("This iPhone's UDID isn't known yet."), { kind: "no-udid" });
    const devices = await portal.listDevices(teamId);
    if (devices.some((d) => normalUdid(d.deviceNumber) === udid)) return { summary: "Already on the account" };
    await portal.addDevice(teamId, udid, phone?.name || `${phone?.product || "iPhone"}`);
    return { summary: "Added to the account" };
  });

  const { identity } = await run("certificate", () => certificate({ portal, teamId, saved, askRevoke, make: mk, name, app }));

  const identifier = freeAppId(bundleId, teamId);
  let appIds = []; // F458: Apple's list, asked once: refreshApps reads it too
  const { appId } = await run("appId", async () => {
    ({ appIds } = await portal.listAppIds(teamId));
    const have = appIds.find((a) => a.identifier === identifier);
    if (have) return { appId: have, summary: `${identifier} (already made)` };
    try {
      return { appId: await portal.addAppId(teamId, identifier, appName), summary: identifier };
    } catch (e) {
      if (atAppIdLimit(e)) e.kind = "appid-limit";
      throw e;
    }
  });

  const { profile } = await run("profile", async () => {
    const got = await portal.downloadProfile(teamId, appId.appIdId);
    const data = bytes(got?.encodedProfile);
    if (!data) throw new Error("Apple sent no profile.");
    const info = parseProfile(data);
    if (!info.udids.map(normalUdid).includes(udid)) throw new Error("Apple's profile doesn't list this iPhone yet. Try again in a minute.");
    const until = info.expires ? info.expires.toISOString().slice(0, 10) : "?";
    return { profile: { data, info }, summary: `Good until ${until}` };
  });

  return { identity, profile, appId: identifier, appIds, steps };
}

// F458: the profiles of the recorded apps' other App IDs than the setup's own (signing.installed's appId is
// TEAM.identifier), one each. An App ID Apple no longer lists expired: no profile, so the app is signed again.
export async function otherProfiles({ portal, teamId, appIds = [], apps = [], appId }) {
  const wanted = new Set(apps.map((a) => String(a?.appId ?? ""))
    .filter((id) => id.startsWith(`${teamId}.`)).map((id) => id.slice(teamId.length + 1)));
  wanted.delete(appId);
  const out = [];
  for (const a of appIds) {
    if (!wanted.has(a.identifier)) continue;
    const data = bytes((await portal.downloadProfile(teamId, a.appIdId))?.encodedProfile);
    if (data) out.push(data);
  }
  return out;
}

// With no recorded app, iFizBox's own profile is still renewed, without a progress page or an alert.
export async function refreshApps({ native, portal, teamId, appIds, appId, hud, alert }) {
  let page = null, shown = false;
  const fail = async (message) => {
    page?.fail(message);
    await alert({ title: "Couldn't Refresh Apps", message, buttons: ["OK"], cancel: 0 });
  };
  try {
    const apps = (await native.call("signing.installed", {}))?.apps ?? [];
    shown = apps.length > 0;
    const profiles = (await otherProfiles({ portal, teamId, appIds, apps, appId })).map(b64encode);
    if (shown) page = hud("Refreshing Apps");
    const r = await callWithStall(native, "signing.refresh", { profiles, route: "idevice" }, (ev) => {
      if (ev?.log) page?.page?.raw?.(ev.log);
      const t = resignLabel(ev);
      if (t) page?.set(t);
    });
    const failed = r?.failed ?? [];
    if (failed.length && shown) await fail(failed.map((f) => `${f.name || f.bundleId}: ${f.error || "failed"}`).join("\n"));
    else page?.done("Done");
    return r;
  } catch (e) {
    if (shown) await fail(deviceError(e).message);
    return null;
  }
}

export function freeEntitlements(appEnts = {}, profile) {
  const pe = profile?.Entitlements ?? profile?.entitlements ?? {};
  const out = { ...appEnts };
  delete out["aps-environment"];
  out["get-task-allow"] = pe["get-task-allow"] === true;
  const groups = pe["keychain-access-groups"], id = out["application-identifier"];
  if (groups) {
    const covers = typeof id === "string" && Array.isArray(groups)
      && groups.some((g) => typeof g === "string" && (g === id || (g.endsWith("*") && id.startsWith(g.slice(0, -1)))));
    out["keychain-access-groups"] = covers ? [id] : groups;
  }
  return out;
}

export const FREE_EXPIRY_WARNING = 3;
export function freeExpiry(expires, now = new Date(), warn = FREE_EXPIRY_WARNING) {
  const e = dateOf(expires);
  if (!e || Number.isNaN(e.getTime())) return { state: "ok", days: null };
  const days = (e.getTime() - now.getTime()) / 86400000;
  return { state: days <= 0 ? "expired" : days <= warn ? "soon" : "ok", days: Math.max(0, Math.ceil(days)) };
}

export function setupError(e) {
  if (e?.kind === "agreement") {
    return { title: "Agreement Needed", message: "Apple wants this Apple ID to accept its developer agreement first. Sign in at developer.apple.com/account, accept it, then try again." };
  }
  if (e?.kind === "session") return { title: "Signed Out", message: "Apple ended the session. Sign in again." };
  if (e?.kind === "appid-limit") {
    return { title: "App ID Limit", message: "A free Apple ID can make 10 App IDs a week. Try again when the oldest is a week old." };
  }
  if (e?.kind === "no-udid") return { title: "iPhone Not Known", message: "Find This iPhone's UDID first (Settings > Signing), then try again." };
  if (e?.kind === "cancelled") return { title: "Setup Stopped", message: e.message };
  const step = SETUP_STEPS.find((s) => s.id === e?.step)?.title ?? "Setup";
  return { title: "Setup Failed", message: `${step}: ${e?.code != null ? `Apple error ${e.code}: ` : ""}${e?.message ?? e}` };
}
