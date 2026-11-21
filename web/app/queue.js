// The app's one install queue and console log store (N4), shared by the backend (backend-native.js queue()), the
// package pages and lists (browse.js marks queued rows), the Confirm sheet and console (screens/queue.js) and
// Settings > Console Logs. No DOM here; the model is core/queue.js.
// SPDX-License-Identifier: GPL-3.0-or-later
import { createQueue, createRunLog } from "./core/queue.js";
import { logSideloadRuns } from "./core/signing.js";

export const installQueue = createQueue();

// The page's localStorage (not read outside a page: node warns on it, and the tests bring their own).
function storage() {
  try { return globalThis.document ? globalThis.localStorage ?? null : null; } catch { return null; }
}
export const runLogs = createRunLog(storage());
// F361: every sideload sign and install goes to the same logs (core/signing.js loggedBridge).
logSideloadRuns(runLogs);
