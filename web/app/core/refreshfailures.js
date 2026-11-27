// F456: what failed in a source refresh, for the reload bar's failure line (nav/reloadbar.js showReloadFailure) and the
// log its Show Info opens: [{ title: the source's name, detail: its error }]. `rows` is refreshSources' answer: the
// records, each with `error` when it failed, and in the jailbreak app `failed` ([{ key, uri, name, message }]), which
// also holds apt's failures that no record carries.
import { failReason } from "./refreshrows.js";
import { displayName } from "./sources.js";

export function refreshFailures(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    const reason = failReason(r);
    if (reason) out.set(r.key, { title: displayName(r), detail: reason });
  }
  for (const f of rows?.failed ?? []) {
    const k = f.key ?? f.uri;
    if (!out.has(k)) out.set(k, { title: f.name || f.uri, detail: f.message });
  }
  return [...out.values()];
}
