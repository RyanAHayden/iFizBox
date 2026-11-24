// ---- F190: what iOS does after the upload -------------------------------------------------------------------
//
// Safari never hears back from itms-services, but the Worker sees iOS's own requests on the link and keeps them per
// token: GET /sign/up/<token>/status -> { manifest, started, finished } (worker/src/index.js). watchInstall polls it
// every `every` ms (KV reads are cheap; only the Worker's 3 marks are writes) and the progress page steps through
// installSteps, each shown at least `minShow` ms so a fast install still reads as steps. If iOS hasn't begun the
// download `askWithin` ms in, it says so and offers Retry (the itms link again, from that tap). The final install
// happens on the Home Screen, which Safari can't see: the last step says so.
//
//   const w = watchInstall(token, hud, { base, fetcher, app, itms, open, alert })
//   await w.first   after the first look: a Worker without /status (or no answer) ends the page on UPLOADED_TEXT
//   await w.end     "installed" (downloaded) | "not_asked" | "unknown" | "closed" | "timeout"
import { sayFirstLaunch } from "../core/firstlaunch.js"; // F415
import { SENT_TO_IOS } from "../core/signing.js";
import { openAppHelp } from "../screens/guides.js";
import { showAlert } from "../nav/alert.js";
import { EARLY_WINDOW } from "./early.js";

export const STATUS_EVERY = 500, STATUS_MIN_SHOW = 400, STATUS_ASK_WITHIN = 60 * 1000;

// The log's steps in order, and how far a status got: 0 waiting, 1 downloading, 2 downloaded.
export const installSteps = (app) => [
  "Waiting for iOS…",
  "iOS is asking: tap Install.",
  SENT_TO_IOS, // F252: short; the help line under it (watchInstall's `cause`) covers an app that doesn't appear
];
// The page completes once iOS starts the download (Cydia's Complete, Return under it): Safari can't see the rest, and
// "iOS is downloading…" left people waiting on a page with nothing more to show (user 2026-11-18).
export const installStage = (s) => (s?.finished || s?.started ? 2 : s?.manifest ? 1 : 0);
// B424: no word from the Worker on what iOS asked for: only the upload is known.
export const UPLOADED_TEXT = "Uploaded. Tap Install if iOS asks.";
export const notAskedText = "iOS didn't ask for the app. Tap Install again.";

// F236/F252: `cause` (core/signing.js notLandedText, "Not on the Home Screen?": the website couldn't check this
// iPhone's UDID) goes under the last step as a grey line with Help (page.help; `help(page)` opens Guides > "An app
// won't install"), once iOS has the app and when it never fetches it. No Retry there: iOS already has the app.
export function watchInstall(token, h, { base = "", fetcher = globalThis.fetch, app = "", itms = "", open = () => {}, alert = showAlert,
  cause = null, help = openAppHelp, every = STATUS_EVERY, minShow = STATUS_MIN_SHOW, askWithin = STATUS_ASK_WITHIN, upTo = EARLY_WINDOW,
  clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const steps = installSteps(app), t0 = clock();
  let shown = -1, shownAt = 0, firstDone;
  const first = new Promise((r) => { firstDone = r; });
  const look = async () => {
    try {
      const res = await fetcher(`${base}/sign/up/${token}/status`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const show = async (stage) => { // each step in turn up to `stage`, none for less than minShow
    while (shown < stage) {
      if (shown >= 0) { const left = minShow - (clock() - shownAt); if (left > 0) await sleep(left); }
      shown++;
      h.set(steps[shown]);
      shownAt = clock();
    }
  };
  const closed = () => Boolean(h.page?.closed);
  const end = (async () => {
    let s = await look();
    if (!s) { // a Worker without /status: as before F190
      if (h.done) h.done(UPLOADED_TEXT); else h.hide();
      firstDone();
      return "unknown";
    }
    await show(installStage(s));
    firstDone();
    for (;;) {
      if (closed()) return "closed";
      if (installStage(s) === 2) {
        const left = minShow - (clock() - shownAt);
        if (left > 0) await sleep(left);
        if (cause) h.page?.help?.(cause, { action: help });
        sayFirstLaunch(h.page); // F415
        if (h.done) h.done(steps[2]); else h.hide();
        return "installed";
      }
      if (!s.started && clock() - t0 >= askWithin) {
        if (h.finish) {
          h.set(notAskedText);
          h.finish({ label: "Retry", status: notAskedText, action: () => { open(itms); return true; } });
        } else {
          h.hide();
          await alert({ title: "Not Installed", message: notAskedText, buttons: ["Cancel", "Install"], cancel: 0,
            onTap: (i) => { if (i === 1) open(itms); } });
        }
        return "not_asked";
      }
      if (clock() - t0 >= upTo) {
        if (cause) h.page?.help?.(cause, { action: help });
        if (h.done) h.done(steps[shown]); else h.hide();
        return "timeout";
      }
      await sleep(every);
      s = (await look()) ?? s; // a missed look keeps the last answer
      await show(installStage(s));
    }
  })().catch(() => "unknown").finally(() => firstDone());
  return { first, end };
}
