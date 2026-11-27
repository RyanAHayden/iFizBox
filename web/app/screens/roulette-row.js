// Tweak Roulette's day streak and Browse's row for it: the part of Roulette that Browse draws on its home page.
// Kept apart from screens/roulette.js (the wheels page, which imports browse.js's package helpers) so browse.js
// reaches it without an import cycle, and the wheels still load only when their page opens (lazy.js).
// The streak counts the days in a row with at least one spin, kept on the device beside the settings
// (localStorage["ifizbox.roulette"]).
import { format } from "../router.js";
import { dayKey, dayBefore } from "../core/catalog.js";
import { KEYS } from "../core/storagekeys.js";

export const ROULETTE_KEY = KEYS.roulette;

// ---- the streak (pure) -------------------------------------------------------------------------------------

// { last: "2026-11-18" | null, streak, best, spins } from storage; a fresh record when there is none or it's broken.
export function readSpins(storage = globalThis.localStorage) {
  const empty = { last: null, streak: 0, best: 0, spins: 0 };
  try {
    const v = JSON.parse(storage?.getItem(ROULETTE_KEY) ?? "null");
    if (!v || typeof v !== "object") return empty;
    const n = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
    return { last: /^\d{4}-\d{2}-\d{2}$/.test(v.last) ? v.last : null, streak: n(v.streak), best: n(v.best), spins: n(v.spins) };
  } catch {
    return empty;
  }
}

export function saveSpins(state, storage = globalThis.localStorage) {
  try { storage?.setItem(ROULETTE_KEY, JSON.stringify(state)); } catch { /* private mode or full: this session only */ }
  return state;
}

// A spin on `today`: the first one of a day adds a day to the streak when yesterday had one, else starts it at 1;
// more spins the same day only count as spins.
export function recordSpin(state, today = dayKey()) {
  const s = { last: null, streak: 0, best: 0, spins: 0, ...state };
  const streak = s.last === today ? s.streak : s.last === dayBefore(today) ? s.streak + 1 : 1;
  return { last: today, streak, best: Math.max(s.best, streak), spins: s.spins + 1 };
}

// The streak as it stands on `today`: kept while the last spin was today or yesterday (today's spin can still
// carry it on), 0 once a day was missed.
export function currentStreak(state, today = dayKey()) {
  if (!state?.last) return 0;
  return state.last === today || state.last === dayBefore(today) ? state.streak : 0;
}

export const ROULETTE_SUBTITLE = "Spin for something new";
export const rouletteTitle = (jailbroken = true) => (jailbroken ? "Tweak Roulette" : "App Roulette");

// Browse's row for it (nav/ui.js grouped section): the subtitle and, once there is one, the day streak.
export function rouletteRow({ jailbroken = true, streak = 0, href = format({ tab: "home", path: ["browse", "roulette"] }) } = {}) {
  return { rows: [{ label: rouletteTitle(jailbroken), subtitle: ROULETTE_SUBTITLE + (streak > 0 ? ` · ${streak}-day streak` : ""),
    href, icon: { src: "icons/roulette.svg" }, cls: "browse-icon-row" }] };
}
