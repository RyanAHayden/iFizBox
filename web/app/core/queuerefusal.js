// B404: what the Cannot Comply sheet says when ifizbox-helper refused to ask apt, and which queued packages caused a
// refusal (the sheet's "Remove <name> from Queue" rows). Pure, no DOM.
//
//   helperRefusal(message, jobs, names)  -> { sentences: [string], ids: [queued id], missing }
//       `message`: the BackendError's ("ifizbox-helper simulate failed (64): ifizbox-helper: unknown package: com.a",
//       native/helper/policy.c's and main.c's words). `missing`: there is no helper (Apt.swift), so reinstalling helps.
//   refusalIds(r, jobs)                  -> [queued id]: the queued packages apt's refusal names (r: simulate's answer)
//
// Both give [] when the cause names no queued package. apt prints names in lowercase, so ids match without regard to
// case.
// SPDX-License-Identifier: GPL-3.0-or-later
import { NAME } from "../brand.js";
import { parseRelations } from "./apt.js";

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// The character rule the helper's own message states ("bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"), so it stays
// written once, in policy.c.
function nameRule(why) {
  try { return new RegExp(`^(?:${why.match(/allowed: (.+)\)\s*$/)[1]})$`); } catch { return null; }
}

export function helperRefusal(message, jobs, names = {}) {
  const why = String(message ?? "").replace(/^ifizbox-helper \S+ failed \(-?\d+\): /, "").replace(/^ifizbox-helper: /, "").trim();
  const label = (j) => names[j.id] || j.name || j.id;
  const titled = (j) => (label(j) === j.id ? j.id : `${label(j)} (${j.id})`);
  const about = (list, say, none) => ({ missing: false, ids: list.map((j) => j.id), sentences: list.length ? list.map(say) : [none] });

  const unknown = why.match(/^unknown package: (\S+)/)?.[1];
  if (unknown) {
    const job = jobs.find((j) => same(j.id, unknown));
    if (job?.op === "remove") return about([job], (j) => `${titled(j)} isn't installed, so it can't be removed.`);
    return about(job ? [job] : [], (j) => `${titled(j)} isn't in apt's package lists on this iPhone, so apt can't install it. Refresh your sources, then try again.`,
      `${unknown} isn't in apt's package lists on this iPhone, so apt can't install it. Refresh your sources, then try again.`);
  }
  if (/^bad package name/.test(why)) {
    const rule = nameRule(why);
    const bad = (j) => (rule && !rule.test(j.id)) || j.id.length > 255 || (j.op !== "remove" && /[-+]$/.test(j.id));
    return about(jobs.filter(bad), (j) => {
      const id = !rule || rule.test(j.id) ? `isn't one ${NAME} can pass on`
        : `has ${rule.test(j.id.toLowerCase()) ? "capital letters" : "characters"} ${NAME} can't pass on`;
      return `${titled(j)} can't be handed to apt: its package ID ${id}.`;
    },
      `A queued package can't be handed to apt: its package ID isn't one ${NAME} can pass on.`);
  }
  if (/^bad version/.test(why)) {
    const bad = (j) => j.op !== "remove" && j.version && !(/^\d[A-Za-z0-9.+~:-]*$/.test(j.version) && j.version.length <= 255);
    return about(jobs.filter(bad), (j) => `${titled(j)} can't be handed to apt: its version, ${j.version}, isn't one ${NAME} can pass on.`,
      `A queued package can't be handed to apt: its version isn't one ${NAME} can pass on.`);
  }
  if (/named twice/.test(why)) {
    const twice = jobs.filter((j) => jobs.some((o) => o !== j && same(o.id, j.id)));
    return about(twice, (j) => `${titled(j)} is queued twice.`, "A package is queued twice.");
  }
  if (/^too many package names/.test(why)) return about([], null, "Too many packages are queued to ask apt about at once. Remove some, confirm the rest, then queue them again.");
  if (/ifizbox-helper is not installed|can't start ifizbox-helper: No such file/.test(why)) {
    return { ...about([], null, `The part of ${NAME} that runs apt is missing from this iPhone, so nothing can be installed or removed.`), missing: true };
  }
  return about([], null, `${NAME} couldn't ask apt about these packages: ${why || "it gave no reason"}`);
}

export function refusalIds(r, jobs) {
  const out = new Set();
  const add = (id, when = () => true) => { for (const j of jobs) if (id && same(j.id, id) && when(j)) out.add(j.id); };
  for (const id of r?.plan?.essential ?? []) add(id);
  // F131/F133: a linked download's sentence names its link
  for (const s of r?.issues ?? []) for (const j of jobs) if (j.debUrl && s.includes(j.debUrl)) out.add(j.id);
  let pkg = null, essential = false;
  for (const raw of String(r?.output ?? "").split(/\r?\n/)) {
    // "  apt libapt-pkg (due to apt)" under apt's essential warning
    if (/^WARNING: The following essential packages/.test(raw)) { essential = true; continue; }
    if (essential && /^\s+\S/.test(raw)) { for (const m of raw.matchAll(/\(due to ([^)]+)\)/g)) for (const id of m[1].split(/[\s,]+/)) add(id); continue; }
    if (!/^This should NOT/.test(raw)) essential = false;
    const e = raw.match(/^E: (?:Unable to locate package |Version '[^']*' for '|Package '?)([^'\s]+)/);
    if (e) { add(e[1]); continue; }
    const m = raw.match(/^\s+(?:(\S+)\s+:\s+)?(Depends|PreDepends|Pre-Depends|Conflicts|Breaks):\s+(.+?)\s+but\s+(.+?)\s*$/);
    if (!m) { if (!/^\s/.test(raw)) pkg = null; continue; }
    if (m[1]) { pkg = m[1]; add(pkg); }
    if (!pkg) continue;
    // The other side caused it too when it is what was asked for: a queued conflict, removal or version.
    const asked = /^(Conflicts|Breaks)$/.test(m[2]) ? () => true
      : (j) => j.op === "remove" || (j.version && m[4].startsWith(`${j.version} is to be installed`));
    for (const alt of parseRelations(m[3]).flat()) add(alt.name, asked);
  }
  return [...out];
}
