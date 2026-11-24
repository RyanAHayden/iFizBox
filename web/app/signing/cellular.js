// The wait on cellular, as the installs of one run see it (F417; core/cellular.js): while any of them waits the Shortcut
// runs (Use Shortcut) or the popup is up, which goes by itself when none does, and whose answer holds for the whole run.
//   const cell = cellularAsk({ alert, onServer })
//   const wait = cell.watch(stop)          one install; stop(): its call to the shell is to be cancelled
//     wait.phase("airplane" | …)           the shell's step
//     wait.end()                           the call answered: true when the shell was stopped here (then wait.answer)
//   cell.answer    null | "server" | "cancel"
//   cell.forget()  a cancelled run tried again: asks anew
import { onCellularChoice, setOnCellular, cellularQuestion, CELLULAR_CANCELLED } from "../core/cellular.js";
import { showAlert } from "../nav/alert.js";
import { nativeBridge } from "../native.js";

const OFF = new Set(["offCellular", "airplaneOff", "networkWait", "copying", "installing"]); // the wait is over
const RUNS = 2; // runs of the Shortcut for one install before the popup asks
async function appShortcut(alert) {
  const native = nativeBridge();
  return native?.call ? (await import("./cellularsetup.js")).popupShortcut(native, { alert }) : null;
}
// `shortcut()`: signing/cellularsetup.js popupShortcut
export function cellularAsk({ alert = showAlert, choice = onCellularChoice, setChoice = setOnCellular, onServer = () => {}, shortcut = () => appShortcut(alert) } = {}) {
  const waiting = new Set();
  let popup = null; // its AbortController
  let deciding = false, waits = false; // one thing at a time; waits: an install came to wait meanwhile
  let sc; // popupShortcut's, read once
  let picked = false, failed = null; // the Shortcut, picked in the popup; its last run's code
  const cell = { answer: null, watch, useServer, forget: () => { if (cell.answer === "cancel") cell.answer = null; } };

  function useServer() {
    if (cell.answer === "server") return;
    cell.answer = "server";
    onServer();
  }
  async function decide() {
    waits = true;
    if (deciding) return;
    deciding = true;
    let again = false;
    try {
      while ((waits || again) && waiting.size && !cell.answer) {
        waits = false;
        if (sc === undefined) { sc = await Promise.resolve().then(shortcut).catch(() => null) ?? null; if (!waiting.size) break; }
        again = sc && !failed && (picked || choice() === "shortcut") ? await run() : await ask();
      }
    } finally { deciding = false; }
  }
  // Both answer whether to go on deciding while any install waits.
  async function run() {
    const mine = [...waiting];
    const code = await sc.run();
    if (code === "not_waiting") return false; // off cellular, or paused: the shell says when it waits again
    sc.added = sc.added || !code;
    if (!code && picked) setChoice("shortcut"); // set up from the popup: used from now on
    for (const w of mine) w.runs++;
    failed = code ?? (mine.some((w) => waiting.has(w) && w.runs >= RUNS) ? "ran_out" : null);
    return true;
  }
  async function ask() {
    const ctl = popup = new AbortController();
    const { answers, add, ...question } = cellularQuestion({ shortcut: sc, failed });
    let r;
    try { r = await alert({ ...question, signal: ctl.signal }); } catch { return false; } finally { popup = null; }
    const a = ctl.signal.aborted ? null : answers[r?.index];
    if (!a) return true; // cellular came back as it closed
    if (a === "shortcut") {
      if (!add || await sc.add()) { picked = true; failed = null; }
      return true;
    }
    if (a === "server") useServer(); else cell.answer = "cancel";
    for (const w of [...waiting]) w.stopNow();
    return false;
  }
  function leave(w) {
    if (waiting.delete(w) && !waiting.size) popup?.abort();
  }
  function watch(stop) {
    const w = { answer: null, runs: 0, stopNow: () => { leave(w); w.answer = cell.answer; stop(); } };
    return {
      phase(p) {
        if (w.answer) return;
        if (p === "airplane") {
          if (!cell.answer && choice() === "server") useServer();
          waiting.add(w);
          if (cell.answer) w.stopNow(); else decide();
        } else if (OFF.has(p)) leave(w); // appWait, and connecting after it: the app was left meanwhile, still on cellular
      },
      end: () => { leave(w); return w.answer; },
      get answer() { return w.answer; },
    };
  }
  return cell;
}

// What a call the popup stopped ends with: code "cell_server" (the same app through the Signing Server) or "cellular".
export const cellularStopped = (answer) => Object.assign(new Error(answer === "server" ? "Use Signing Server" : CELLULAR_CANCELLED),
  { code: answer === "server" ? "cell_server" : "cellular" });
