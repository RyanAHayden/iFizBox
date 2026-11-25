// Restore My VPN on coming back (app.js, sideload app): a back run held since the app was left or killed opens
// Shortcuts only after Turn VPN On here (core/restoreshortcut.js; native RestoreBack says when, once per queue).
import { watchRestoreDue, answerRestore } from "../core/restoreshortcut.js";
import { RESTORE_VPN } from "../core/installroute.js";
import { alertOK, showAlert, nativeAlertUp } from "../nav/alert.js";
import { popupOpen } from "../nav/popups.js";
import { typing } from "../nav/hometop.js";

export const QUESTION = { title: "Turn Your VPN Back On?", message: "Shortcuts opens for a moment.",
  buttons: ["Turn VPN On", "Not Now", "Don't Ask Again"], cancel: 1 };
const ANSWERS = ["on", "notNow", "never"];
const NO_FAILURE = ["later", "on_already", "not_due"]; // it runs once it can, or there is nothing to turn on

export function runFailed(code) {
  const q = `“${RESTORE_VPN}”`;
  return { title: "VPN Not Turned On", message: ({ not_run: `The Shortcut ${q} wasn't found or wasn't allowed to run.`,
    not_stored: `The Shortcut ${q} has no VPN remembered.`, no_return: `The Shortcut ${q} didn't answer.`,
    not_opened: "Shortcuts didn't open." }[code] ?? `The Shortcut ${q} didn't turn your VPN on.`) + " Turn it on in Settings > VPN." };
}

// Nothing in the way: in front, no alert, sheet or menu up, and no keyboard.
const pageClear = (doc = globalThis.document) => doc.visibilityState === "visible" && !popupOpen(doc) && !nativeAlertUp()
  && !doc.querySelector(".menu, .filter-drop") && !typing(doc);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Asks each time the shell says one is due; `settle` ms after it is clear, so what a link opens goes first. False
// before an answer takes the question back. Resolves when the shell ends the stream or has none.
export function askRestore(native, { alert = showAlert, clear = pageClear, wait = pause, settle = 1500, poll = 300 } = {}) {
  let due = false, tells = 0, asking = false, shown = null;
  const whenClear = async (go) => { while (go() && !clear()) await wait(poll); return go(); };
  const going = () => due;

  async function ask() {
    if (asking) return;
    asking = true;
    try {
      while (due) {
        if (!await whenClear(going)) break;
        await wait(settle);
        if (!due || !clear()) continue;
        shown = new AbortController();
        const pick = ANSWERS[(await alert({ ...QUESTION, signal: shown.signal }))?.index];
        shown = null;
        if (!pick) { if (due) await wait(poll); continue; } // withdrawn, maybe due again already
        const n = tells;
        if (!await answer(pick) && tells === n) due = false; // else the shell said since: a next queue's may be due
      }
    } finally { asking = false; shown = null; }
  }

  // True: still to be answered (the app was left just as it was tapped, so nothing ran).
  async function answer(pick) {
    let r;
    try { r = await answerRestore(native, pick); } catch { r = { ok: false, error: "" }; }
    if (pick !== "on" || r?.ok || NO_FAILURE.includes(r?.error)) return false;
    if (r?.error === "not_opened" && due) return true;
    const f = runFailed(r?.error);
    await whenClear(() => true);
    await alertOK(f.title, f.message, alert);
    return false;
  }

  return watchRestoreDue(native, (d) => {
    due = d;
    tells++;
    if (d) ask(); else shown?.abort();
  }).catch(() => {}); // an older shell
}
