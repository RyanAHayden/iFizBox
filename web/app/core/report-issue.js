// Report an Issue (F362): a row under Console Logs, in Settings and on one Console Log's page, that opens a new
// GitHub issue on brand.js GITHUB_REPO with its title and body filled in: the app's version and build (jailbreak,
// Lite or the website), iOS, the device model and a Console Log in a code block. No DOM here; the rows are
// screens/queue.js (reportRow).
//
// A prefilled URL carries no files and GitHub refuses one past about 8 KB, so the log keeps only its last lines that
// fit under URL_CAP, says "(trimmed)", and asks for the full log, which the row puts on the clipboard, to be pasted.
//
//   reportLog(list, id) -> entry | null        the Console Log to send: the open one, else the newest failed run,
//                                              else the newest one
//   issueTitle(info, entry) -> text
//   issueBody(info, entry, { lines }) -> text  `lines`: keep only the log's last this many lines (trimmed)
//   issueUrl(info, entry, { cap, repo }) -> { url, trimmed, full }   `full`: the whole log, for the clipboard
// SPDX-License-Identifier: GPL-3.0-or-later
import { GITHUB_REPO, NAME } from "../brand.js";
import { runState, runStatusText } from "./queue.js";

export const URL_CAP = 8000; // GitHub's ~8 KB, with room to spare

// The build's name as the issue shows it.
export function buildName(mode) {
  return mode === "jailbreak" ? "jailbreak" : mode === "sideload" ? "Lite" : "website";
}

export function reportLog(list = [], id = null) {
  if (id) return list.find((e) => e.id === id) ?? null;
  return list.find((e) => runState(e) === "failed") ?? list[0] ?? null;
}

export function issueTitle(info = {}, entry = null) {
  const what = entry ? `${entry.title || "Run"}: ${runStatusText(entry)}` : "Issue";
  return `${what} (${NAME} ${info.version || "?"}, ${buildName(info.mode)}, iOS ${info.ios || "?"})`;
}

// A fence longer than any run of backticks in the log, so the log can't close it.
function fence(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((s) => s.length));
  return "`".repeat(Math.max(3, longest + 1));
}

const logLines = (entry) => String(entry?.text ?? "").replace(/\s+$/, "").split("\n");

export function issueBody(info = {}, entry = null, { lines = Infinity, chars = Infinity } = {}) {
  const version = info.version ? `${info.version}${info.build ? ` (${info.build})` : ""}` : "unknown";
  const out = [
    `**${NAME}:** ${version}, ${buildName(info.mode)}`,
    `**iOS:** ${info.ios || "unknown"}`,
    `**Device:** ${info.machine || "unknown"}`,
    "",
    "**What happened:**",
    "",
    "",
  ];
  if (!entry) return [...out, "_No Console Log yet._", ""].join("\n");
  const all = logLines(entry);
  let kept = all.slice(Math.max(0, all.length - lines));
  let text = kept.join("\n");
  if (text.length > chars) text = text.slice(text.length - chars); // one line longer than the URL can carry
  const cutLine = text.length < kept.join("\n").length;
  const trimmed = kept.length < all.length || cutLine;
  const when = Number.isFinite(entry.at) ? new Date(entry.at).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
  const f = fence(text);
  out.push(`**Console Log:** ${[entry.title || "Run", when, runStatusText(entry)].filter(Boolean).join(" · ")}`
    + (cutLine ? ` (trimmed: the end of the last of ${all.length} lines)`
      : trimmed ? ` (trimmed: the last ${text.split("\n").length} of ${all.length} lines)` : ""), "", f, text, f, "");
  if (trimmed) out.push("The full log is on your clipboard: paste it here in place of the trimmed one above.", "");
  return out.join("\n");
}

const urlFor = (repo, title, body) =>
  `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

// The longest tail of the log whose URL fits under `cap`.
export function issueUrl(info = {}, entry = null, { cap = URL_CAP, repo = GITHUB_REPO } = {}) {
  const title = issueTitle(info, entry);
  const full = entry ? String(entry.text ?? "") : "";
  const at = (n, chars) => urlFor(repo, title, issueBody(info, entry, { lines: n, chars }));
  const total = logLines(entry).length;
  let url = at(Infinity);
  if (!entry || url.length <= cap) return { url, trimmed: false, full };
  // fewest-to-most last lines: find the most that fit
  let lo = 0, hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (at(mid).length <= cap) lo = mid; else hi = mid - 1;
  }
  if (lo > 0) return { url: at(lo), trimmed: true, full };
  // not even the last line fits: the end of that line, as many characters as fit
  let c0 = 0, c1 = full.length;
  while (c0 < c1) {
    const mid = Math.ceil((c0 + c1) / 2);
    if (at(1, mid).length <= cap) c0 = mid; else c1 = mid - 1;
  }
  return { url: at(1, c0), trimmed: true, full };
}
