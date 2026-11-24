// ---- B83: iFizBox's own update after iOS's prompt -----------------------------------------------------------
import { CLOSE_BY_HAND, RETURN_LABEL, CLOSING_LABEL, CLOSE_GRACE, TRY_AGAIN_LABEL, UPDATING_TITLE, NOT_YET_TITLE, unlockSelfUpdate } from "../nav/progress.js";
import { NAME } from "../brand.js";
import { bridge } from "./common.js";

export const SELF_UPDATE_LINES = {
  waiting: `Waiting for Install to be tapped on iOS's prompt`,
  asked: `iOS is preparing the new ${NAME}. If it asks anything else, answer it`,
  finished: `iOS is installing the new ${NAME}. Closing so it can finish`,
};
export const SELF_UPDATE_FAILED = {
  notStarted: `The update didn't start: iOS didn't download the new ${NAME}. If Install was pressed, try again.`,
};
// B394: iOS hasn't begun the download WAIT_HINT after the prompt opened (or after it asked for the IPA): what to do,
// with Try Again and Return, and the page keeps following, so a late download still turns it to "Closing iFizBox".
// Try Again hands iOS the same uploaded copy (native CloseForUpdate.reusable): nothing is uploaded twice.
export const WAIT_HINT = 8_000;
export const waitHint = (state) => (state === "asked"
  ? `iOS hasn't started downloading yet. Answer any message from iOS, then go to the Home Screen: ${NAME} keeps checking, and closes when the download starts. If you cancelled it, tap Try Again.`
  : `iOS hasn't started the update. Tap Install on its prompt; if the prompt is gone or was cancelled, tap Try Again.`);

// B394: the hint's timers for one follow: state(s) arms one at the prompt and one more when iOS asks for the IPA (each
// once); `show(text)` runs when one is due, unless `over()` says the follow has ended or is closing, or a newer state's
// timer took over.
export function waitHints({ show, over, later }) {
  let now = null;
  const armed = new Set();
  return (s) => {
    if (s !== "prompt" && s !== "waiting" && s !== "asked") return;
    const key = s === "asked" ? "asked" : "prompt";
    now = key;
    if (armed.has(key)) return;
    armed.add(key);
    later(() => { if (now === key && !over()) show(waitHint(key)); }, WAIT_HINT);
  };
}

// B123: `waiting` (the page was locked on WAITING_LABEL): finished or guessed turn it to CLOSING_LABEL, and if iFizBox
// is still here CLOSE_GRACE later, or the shell can't be followed (older shell, none running), the page unlocks with
// CLOSE_BY_HAND. Without it, B83's behaviour (the caller's CLOSING_LABEL lock stays).
export async function followSelfUpdate(h, { native, retry = null, waiting = false, later = setTimeout } = {}) {
  let closing = false;
  let last = null;
  let over = false;
  const byHand = () => {
    if (h?.page?.closed || typeof h?.finish !== "function") return;
    h.page?.error?.(CLOSE_BY_HAND);
    h.finish({ label: RETURN_LABEL, status: "Done" });
  };
  const close = () => {
    if (closing || !waiting || typeof h?.finish !== "function") return;
    closing = true;
    h.finish({ label: CLOSING_LABEL, status: "Done", title: UPDATING_TITLE, locked: true });
    later(byHand, CLOSE_GRACE);
  };
  const again = () => { over = true; setTimeout(() => { retry(); }, 0); return false; };
  const hints = waitHints({ later, over: () => closing || over || h?.page?.closed || typeof h?.finish !== "function",
    show: (text) => {
      h.page?.step?.(text);
      h.finish({ label: RETURN_LABEL, status: "Waiting for iOS", title: NOT_YET_TITLE, ...(retry ? { also: { label: TRY_AGAIN_LABEL, action: again } } : {}) });
    } });
  const say = (s) => {
    if (over) return;
    if (s === "finished" || s === "guessed") close();
    if (waiting) hints(s);
    if (s && s !== last && SELF_UPDATE_LINES[s]) { last = s; h?.page?.step?.(SELF_UPDATE_LINES[s]); }
  };
  const s = await watchSelfUpdate(say, native);
  if (over) return s; // Try Again: the new try follows the same update
  say(s);
  over = true;
  if (SELF_UPDATE_FAILED[s]) unlockSelfUpdate(h, { message: SELF_UPDATE_FAILED[s], retry });
  else if (waiting && !s) byHand();
  return s;
}

// B159: This iPhone, iFizBox itself: on iOS 17.4+ installd waits for the running copy to go instead of ending it, so
// the shell answers the install once installd stands still and then closes itself (native CloseForUpdate.hereReady,
// signing.selfUpdate "finished"). Then the page locks on "Closing iFizBox" with the shell's line, as the hosted route
// does, and says to close it by hand if iFizBox is still here CLOSE_GRACE later. -> true when it is closing; false
// (installd answered while iFizBox lived, or an older shell) leaves the caller's "close it by hand" end.
export const HERE_CLOSING_LINE = `iOS has the new ${NAME} and is waiting for this one to close. Closing so it can finish installing it`;
export async function followHereSelf(h, { native, later = setTimeout } = {}) {
  const s = await watchSelfUpdate(() => {}, native);
  if (s !== "finished" || typeof h?.finish !== "function") return false;
  h.page?.step?.(HERE_CLOSING_LINE);
  h.finish({ label: CLOSING_LABEL, status: "Done", locked: true });
  later(() => {
    if (h?.page?.closed) return;
    h.page?.error?.(CLOSE_BY_HAND);
    h.finish({ label: RETURN_LABEL, status: "Done" });
  }, CLOSE_GRACE);
  return true;
}

// B123: signing.selfUpdate's states as they come (onState(state)) -> the last one, or null (an older shell without the
// call, or no self-update running)
export async function watchSelfUpdate(onState = () => {}, native) {
  let r;
  try { r = await bridge(native).call("signing.selfUpdate", {}, (ev) => { if (ev?.state) onState(ev.state); }); } catch { return null; }
  return r?.state ?? null;
}
