// The wait on cellular, as the installs of one run see it (F417; core/cellular.js): the popup is up while any of them
// waits, goes by itself when none does any more, and its answer holds for the whole run.
//   const cell = cellularAsk({ alert, onServer })
//   const wait = cell.watch(stop)          one install; stop(): its call to the shell is to be cancelled
//     wait.phase("airplane" | …)           the shell's step
//     wait.end()                           the call answered: true when the shell was stopped here (then wait.answer)
//   cell.answer    null | "server" | "cancel"
//   cell.forget()  a cancelled run tried again: asks anew
import { onCellularChoice, cellularQuestion, CELLULAR_ANSWERS, CELLULAR_CANCELLED } from "../core/cellular.js";
import { showAlert } from "../nav/alert.js";

const OFF = new Set(["offCellular", "airplaneOff", "networkWait", "copying", "installing"]); // the wait is over
export function cellularAsk({ alert = showAlert, choice = onCellularChoice, onServer = () => {} } = {}) {
  const waiting = new Set();
  let popup = null; // its AbortController
  const cell = { answer: null, watch, useServer, forget: () => { if (cell.answer === "cancel") cell.answer = null; } };

  function useServer() {
    if (cell.answer === "server") return;
    cell.answer = "server";
    onServer();
  }
  function open() {
    if (popup) return;
    const ctl = popup = new AbortController();
    const gone = (r) => {
      popup = null;
      if (ctl.signal.aborted || !(r?.index >= 0)) { if (waiting.size && !ctl.failed) open(); return; } // cellular came back as it closed
      if (CELLULAR_ANSWERS[r.index] === "server") useServer(); else cell.answer = "cancel";
      for (const w of [...waiting]) w.stopNow();
    };
    Promise.resolve().then(() => alert({ ...cellularQuestion(), signal: ctl.signal })).then(gone, () => { ctl.failed = true; gone(null); });
  }
  function leave(w) {
    if (waiting.delete(w) && !waiting.size) popup?.abort();
  }
  function watch(stop) {
    const w = { answer: null, stopNow: () => { leave(w); w.answer = cell.answer; stop(); } };
    return {
      phase(p) {
        if (w.answer) return;
        if (p === "airplane") {
          if (!cell.answer && choice() === "server") useServer();
          waiting.add(w);
          if (cell.answer) w.stopNow(); else open();
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
