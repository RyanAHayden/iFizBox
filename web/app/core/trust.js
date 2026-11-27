// Trust labels (F291, concept K2 option B): where a source stands, shown under its name in Sources and Recommended
// and on its apps' pages, and asked by the exploitable-iOS alert (core/ios-exposure.js):
//   "safe"     Known Safe: on the curated list (core/safe-sources.js), or iFizBox's own built-in source
//   "trusted"  Trusted: the user said so (Add Source's Add & Trust, or the source row's hold menu)
//   "unknown"  everything else. Not a judgement: the list is short on purpose, so most sources are Unknown
// The user's choices stay on the device (localStorage), by source place (core/safe-sources.js placeOf), so a source
// re-added at another URL on the same host or GitHub repo stays trusted.
//
//   trustOf(source, { trusted })        -> "safe" | "trusted" | "unknown"
//   TRUST_LABEL[kind]                    -> "Known Safe" | "Trusted" | "Unknown"
//   loadTrusted(storage) / saveTrusted(storage, list)
//   setTrusted(storage, source, on)      -> the new list
//   isTrustedInput(input, { trusted })   -> whether an install from `input` (a source URL or key) needs no exposure alert
//   untrustedJobs(jobs, { trusted })     -> the queued apps whose source isn't Known Safe or Trusted (a My IPAs file
//                                           has no source: it counts as untrusted)
//   unknownSourceAlert(host)             -> Add Source's second alert (Add & Trust / Add Source / Cancel)
import { knownSafe, placeOf } from "./safe-sources.js";
import { KEYS } from "./storagekeys.js";

export const TRUST_KEY = KEYS.trustedSources;
export const TRUST_LABEL = { safe: "Known Safe", trusted: "Trusted", unknown: "Unknown" };

export function loadTrusted(storage) {
  try {
    const v = JSON.parse(storage?.getItem(TRUST_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

export function saveTrusted(storage, list) {
  try { storage?.setItem(TRUST_KEY, JSON.stringify([...new Set(list)])); } catch { /* private mode: forgotten */ }
}

export function setTrusted(storage, source, on) {
  const place = placeOf(source);
  const now = loadTrusted(storage).filter((p) => p !== place);
  if (on && place) now.push(place);
  saveTrusted(storage, now);
  return now;
}

const has = (trusted, place) => Boolean(place) && (trusted instanceof Set ? trusted.has(place) : (trusted ?? []).includes(place));

export function trustOf(source, { trusted = [] } = {}) {
  if (!source) return "unknown";
  if (source.builtin || knownSafe(source)) return "safe";
  return has(trusted, placeOf(source)) ? "trusted" : "unknown";
}

export function isTrustedInput(input, { trusted = [] } = {}) {
  if (!input) return false;
  return trustOf(typeof input === "string" ? { uri: input } : input, { trusted }) !== "unknown";
}

// A queued app's source: the source URL its job carries, else its catalog key (alt:<url>).
export function untrustedJobs(jobs, { trusted = [] } = {}) {
  return (jobs ?? []).filter((j) => j && j.op !== "remove" && j.mode !== "resign" && !isTrustedInput(j.source || j.key || "", { trusted }));
}

export const ADD_TRUST = "Add & Trust";
export function unknownSourceAlert(host) {
  return {
    title: "Unknown Source",
    message: `${host} isn't on the known-safe list. That doesn't make it bad, but its apps will show as Unknown until you trust it.`,
    buttons: [ADD_TRUST, "Add Source", "Cancel"],
    cancel: 2,
  };
}
