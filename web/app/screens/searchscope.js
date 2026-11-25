// The scope bar's segments and the filters behind them, shared by Search and Browse's lists (F426c: their own module,
// with no screen imported, so browse.js reaches them without an import cycle through search.js and sources.js).
import { SECTION_GROUPS } from "../core/sections.js";

// The segments: All plus the first three groups ("Utilities" and every other section are in the panel; five
// segments and a button don't fit a 320-point bar).
export const SCOPES = ["All", ...SECTION_GROUPS.slice(0, 3)];

// F41: the segments a device type shows. Not Jailbroken lists apps only (F37), so Tweaks and Themes would only
// ever find nothing: just All and Apps then.
const JAILBREAK_ONLY = ["Tweaks", "Themes"];
export function scopesFor(type) {
  return type === "none" ? SCOPES.filter((n) => !JAILBREAK_ONLY.includes(n)) : SCOPES;
}

// The segment a section filter selects: its index in SCOPES, or -1 (a section picked in the panel).
export function scopeIndex(section) {
  if (section == null) return 0;
  const i = SCOPES.indexOf(String(section).replace(/^group:/, ""));
  return String(section).startsWith("group:") && i > 0 ? i : -1;
}

// Whether the panel holds anything the segments don't show (the Filter button looks pressed then).
export const sheetActive = (f) => Boolean(f.source || f.installed || f.price || scopeIndex(f.section) === -1);

// A page's filters, none set: section (a section name or "group:<kind>"), source (a key), installed
// ("installed" | "not"), price ("free" | "paid"); null is any.
export const emptyFilters = () => ({ section: null, source: null, installed: null, price: null });

// What the catalog is asked: only the filters that are set (none: undefined, the plain search).
export function searchFilters(f) {
  const out = {};
  for (const k of Object.keys(emptyFilters())) if (f[k] != null && f[k] !== "") out[k] = f[k];
  return Object.keys(out).length ? out : undefined;
}
