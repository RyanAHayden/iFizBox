// On Cellular (F417, concept K9): what a This iPhone install does while the phone is on cellular data, where iOS refuses
// the connects it needs: "ask" (the popup, signing/cellular.js; the default), "shortcut" (Cellular Installs runs) or
// "server" (the Signing Server, no popup). Pure: the choice, the page's group and the popup's texts. Kept in this
// browser's storage, as is that a run of the Shortcut passed (the shell's `added` is a check's only).
export const CELLULAR_KEY = "ifizbox.onCellular";
export const SHORTCUT_RAN_KEY = "ifizbox.cellularShortcut";
export const ON_CELLULAR = "On Cellular";
export const SHORTCUT_NAME = "Cellular Installs";
export const CELLULAR_OPTIONS = [
  { value: "ask", label: "Ask Each Time", subtitle: "Airplane Mode, Shortcut or server.", icon: "help",
    footer: "iOS can't install straight onto this iPhone while it's on cellular data." },
  { value: "shortcut", label: "Use Shortcut", subtitle: "Cellular data goes off for a moment.", icon: "cellular",
    footer: "Shortcuts opens for a moment and turns cellular data back on by itself." },
  { value: "server", label: "Use Signing Server", subtitle: "Data stays on. iOS asks you to install.", icon: "websiteApps",
    footer: "On Wi-Fi, apps still go straight onto this iPhone." },
];
const known = (v) => CELLULAR_OPTIONS.find((o) => o.value === v) ?? CELLULAR_OPTIONS[0];
export function onCellularChoice(storage = globalThis.localStorage) {
  try { return known(storage?.getItem(CELLULAR_KEY)).value; } catch { return "ask"; }
}
export function setOnCellular(v, storage = globalThis.localStorage) {
  try { storage?.setItem(CELLULAR_KEY, known(v).value); } catch { /* storage off */ }
}
export function shortcutRan(storage = globalThis.localStorage) {
  try { return storage?.getItem(SHORTCUT_RAN_KEY) === "1"; } catch { return false; }
}
export function setShortcutRan(on, storage = globalThis.localStorage) {
  try { storage?.setItem(SHORTCUT_RAN_KEY, on ? "1" : "0"); } catch { /* storage off */ }
}

// The page's rows; without `shortcut` (an older iOS, a renamed app) as if there were no Shortcut.
export const cellularOptions = (shortcut) => (shortcut ? CELLULAR_OPTIONS : CELLULAR_OPTIONS.filter((o) => o.value !== "shortcut")
  .map((o) => (o.value === "ask" ? { ...o, subtitle: "Airplane Mode or server." } : o)));
export const cellularFooter = (v) => known(v).footer;
export const ADD_AGAIN = "Add Shortcut Again";
export const ADD_AGAIN_FOOTER = "Only if you deleted it from Shortcuts.";

// A run or a check that failed (its code: native CellularShortcut.Verdict, CellularRun).
export const SHORTCUT_FAILED = "Shortcut Didn't Run";
export function shortcutWhy(code) {
  const q = `“${SHORTCUT_NAME}”`;
  return { not_run: `${q} wasn't found or wasn't allowed to run.`, no_end: `${q} didn't finish.`, no_return: `${q} didn't answer.`,
    not_opened: "Shortcuts didn't open.", busy: `${q} was still running.`, vpn_off: "The VPN was off.",
    ran_out: `${q} ended, but nothing connected.` }[code] ?? `${q} didn't run.`;
}
// The Shortcut itself may be gone or old; else adding it again would only leave two.
export const needsAdding = (code) => ["not_run", "no_end", "no_return"].includes(code);

// The popup: it closes by itself once the phone is off cellular; otherwise its button decides. `shortcut`: null (it can't
// run here) or { added }; `failed`: the last run's code. `answers`: its buttons; `add`: "shortcut" adds it first.
export function cellularQuestion({ shortcut = null, failed = null } = {}) {
  const add = failed ? needsAdding(failed) : !shortcut?.added;
  const first = failed && add ? ADD_AGAIN : add ? "Set Up Shortcut" : "Use Shortcut";
  return { title: failed ? SHORTCUT_FAILED : "You're on Cellular",
    message: failed ? `${shortcutWhy(failed)} Turn on Airplane Mode, join Wi-Fi, or choose:`
      : "Turn on Airplane Mode or join Wi-Fi and the install goes on by itself. Or choose:",
    buttons: [...(shortcut ? [first] : []), "Use Signing Server", "Cancel"],
    answers: [...(shortcut ? ["shortcut"] : []), "server", "cancel"], cancel: shortcut ? 2 : 1, add };
}
export const CELLULAR_CANCELLED = "not installed, still on cellular";
