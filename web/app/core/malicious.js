// Report as Malicious and the known-malware IPA list (F291, concept K2 option B, step 3).
//
// Reports: an app page's Reviews tab has Report as Malicious beside Write a Review. A reason from MALICIOUS_REASONS
// (Something Else… takes a short text), and the app's version and IPA SHA-256 (when this device knows it) go along
// automatically. One report per device per app version, under the review token and its rate limits
// (worker/src/reports.js). Once REPORT_BANNER different devices report one version, its page shows the red
// "Reported as Malicious" card and Install asks first. When the maintainer confirms a report, the app goes on
// MALWARE_IPAS below and signing refuses it.
//
// Known-malware IPAs: matched on bundle ID (and version, when the entry names versions) before anything is signed, and
// on the IPA's SHA-256 where the bytes are at hand (the website signs in the browser). No Install Anyway.
//
//   MALICIOUS_REASONS, OTHER_REASON          the reasons, as the sheet lists them
//   reportBody({ reason, text, version, sha256 }) -> { ok, body } | { ok: false, error }   checked before sending
//   reportsApi({ base, fetcher, token })     -> { summary(id, version), send(id, body) }
//   bannerOf(summary)                         -> { title, message } for the red card, or null under the threshold
//   MALWARE_IPAS                              -> [{ bundleId, versions?, sha256?, name, reason, link }]
//   malwareIpa({ bundleId, version, sha256 }) -> the entry, or null
//   malwareAlert(entry, name)                 -> the refusal { title, message, buttons, cancel }
//   rememberIpaHash(storage, bundleId, version, sha256), ipaHash(storage, bundleId, version)
//   rememberSigned(storage, { ids, versions, sha256 })   F292: a signer's hash under every ID and version it may carry
//   malwareHashes(list)                       -> the list's SHA-256s, for the signers' refuseSha256 (code "malware")
import { deviceToken } from "./reviews.js";
import { KEYS } from "./storagekeys.js";

export const MALICIOUS_REASONS = [
  { id: "logins", label: "Steals Logins or Codes", detail: "Fake sign-ins, asks for an Apple ID, 2FA codes or passwords." },
  { id: "data", label: "Sends My Data Somewhere", detail: "Contacts, photos, messages, clipboard, keychain or tokens." },
  { id: "profile", label: "Asks to Install a Profile, VPN or Certificate", detail: "" },
  { id: "takeover", label: "Takes Over or Changes the Phone", detail: "An exploit or jailbreak attempt, crashes or reboots, settings changed." },
  { id: "money", label: "Steals Money or Crypto", detail: "" },
  { id: "fake", label: "Isn't the App It Claims", detail: "A fake or modified copy." },
  { id: "other", label: "Something Else…", detail: "" },
];
export const OTHER_REASON = "other";
export const REASON_IDS = MALICIOUS_REASONS.map((r) => r.id);
export const REPORT_TEXT_MAX = 200;
export const REPORT_BANNER = 10;

const SHA = /^[0-9a-f]{64}$/;

export function reportBody({ reason, text = "", version = "", sha256 = null } = {}) {
  if (!REASON_IDS.includes(reason)) return { ok: false, error: "Pick what it did." };
  const t = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (reason === OTHER_REASON && !t) return { ok: false, error: "Say in a few words what it did." };
  if ([...t].length > REPORT_TEXT_MAX) return { ok: false, error: `At most ${REPORT_TEXT_MAX} characters.` };
  const h = typeof sha256 === "string" ? sha256.toLowerCase() : null;
  return { ok: true, body: { reason, text: reason === OTHER_REASON ? t : "", version: String(version ?? "").slice(0, 64), ...(h && SHA.test(h) ? { sha256: h } : {}) } };
}

export class ReportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function reportsApi({ base = "", fetcher = (...a) => globalThis.fetch(...a), token = () => deviceToken() } = {}) {
  const url = (id, q = "") => `${base}/reports/${encodeURIComponent(id)}${q}`;
  return {
    // -> { enabled, count, reasons: { id: n }, mine } for that version; a quiet empty answer when unreachable
    async summary(id, version = "") {
      try {
        const r = await fetcher(url(id, `?version=${encodeURIComponent(version)}`), { cache: "no-store", headers: { "X-Review-Token": await token() } });
        const body = r.ok ? await r.json() : null;
        if (body && typeof body === "object") return { enabled: body.enabled !== false, count: Number(body.count) || 0, reasons: body.reasons ?? {}, mine: Boolean(body.mine) };
      } catch { /* offline */ }
      return { enabled: false, count: 0, reasons: {}, mine: false };
    },
    async send(id, body) {
      let r;
      try {
        r = await fetcher(url(id), { method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Review-Token": await token() }, body: JSON.stringify(body) });
      } catch { throw new ReportError("network", "The report server can't be reached. Check the connection."); }
      let out = null;
      try { out = await r.json(); } catch { /* not JSON */ }
      if (!r.ok) throw new ReportError(out?.code ?? (r.status === 429 ? "rate_limited" : "server"), out?.error ?? `The report server answered HTTP ${r.status}.`);
      return out;
    },
  };
}

const reasonLabel = (id) => MALICIOUS_REASONS.find((r) => r.id === id)?.label ?? null;

export function bannerOf(summary, { threshold = REPORT_BANNER } = {}) {
  const n = Number(summary?.count) || 0;
  if (n < threshold) return null;
  const top = Object.entries(summary.reasons ?? {}).filter(([k]) => REASON_IDS.includes(k)).sort((a, b) => b[1] - a[1])[0]?.[0];
  const most = top ? `, most for “${reasonLabel(top)}”` : "";
  return { title: "Reported as Malicious", message: `${n} people reported this version${most}. It is being reviewed.` };
}

export const INSTALL_ANYWAY = "Install Anyway";
export function reportedAlert(name) {
  return { title: "Reported as Malicious", message: `Several people reported ${name || "this app"} as malicious. Install it anyway?`,
    buttons: ["Cancel", INSTALL_ANYWAY], cancel: 0 };
}

// ---- known-malware IPAs ----------------------------------------------------------------------------------------
// Confirmed by the maintainer, each with a public page that backs it up. None confirmed yet: the list starts empty,
// and the checks below already run on every install.
export const MALWARE_IPAS = [];

export function malwareIpa({ bundleId = null, version = null, sha256 = null } = {}, list = MALWARE_IPAS) {
  const h = typeof sha256 === "string" ? sha256.toLowerCase() : null;
  return list.find((e) => (h && e.sha256 && e.sha256.toLowerCase() === h)
    || (bundleId && e.bundleId === bundleId && (!e.versions?.length || (version != null && e.versions.includes(String(version)))))) ?? null;
}

export const WHY_LISTED = "Why It's Listed";
export function malwareAlert(entry, name = "") {
  const v = name ? `“${name}”` : entry.name ? `“${entry.name}”` : "This app";
  return { title: "Known Malware", message: `${v} is on the known-malware list: ${entry.reason} It won't be signed.`,
    buttons: entry.link ? [WHY_LISTED, "OK"] : ["OK"], cancel: entry.link ? 1 : 0 };
}

// The IPA hashes this device saw (F292: both signers hash the IPA before signing it), so a report can carry one.
export const HASH_KEY = KEYS.ipaHashes;
const loadHashes = (storage) => {
  try { const v = JSON.parse(storage?.getItem(HASH_KEY) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};
export function rememberIpaHash(storage, bundleId, version, sha256) {
  if (!bundleId || !SHA.test(String(sha256 ?? "").toLowerCase())) return;
  const all = loadHashes(storage);
  all[`${bundleId}@${version ?? ""}`] = String(sha256).toLowerCase();
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete all[k]; // the newest 200
  try { storage?.setItem(HASH_KEY, JSON.stringify(all)); } catch { /* full */ }
}
export const ipaHash = (storage, bundleId, version) => loadHashes(storage)[`${bundleId}@${version ?? ""}`] ?? null;

// F292: a signed IPA's hash, kept under every ID and version it may be reported by: the app page's (the source's
// bundle ID and version), the IPA's own Info.plist ones and the ID it was signed as.
export function rememberSigned(storage, { ids = [], versions = [], sha256 = null } = {}) {
  if (!SHA.test(String(sha256 ?? "").toLowerCase())) return;
  const is = [...new Set(ids.filter((i) => typeof i === "string" && i))];
  const vs = [...new Set(versions.map((v) => (v == null ? "" : String(v))).filter(Boolean))];
  for (const i of is) for (const v of vs.length ? vs : [""]) rememberIpaHash(storage, i, v, sha256);
}

// F292: the known-malware hashes, lowercased, for the signers to refuse before signing (the native shell's
// signing.install / signing.prepare `refuseSha256`, the website's signing worker).
export const malwareHashes = (list = MALWARE_IPAS) =>
  [...new Set(list.map((e) => String(e?.sha256 ?? "").toLowerCase()).filter((h) => SHA.test(h)))];

// F292: the refusal a signer gives for one of them (code "malware").
export const MALWARE_REFUSED = "That IPA is on the known-malware list. It won't be signed.";
