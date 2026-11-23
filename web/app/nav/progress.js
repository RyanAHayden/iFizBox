// F151: the install progress page, Cydia's Running/Complete screen made cleaner and more like a terminal
// (docs/cydia.md "Running: the console"; the brain is core/progress.js, the look progress.css):
//
//   const p = openProgress({ onCancel })   a black page over everything, "Running" in the black nav bar
//   p.line(kind, text)                     kind "step" (bold Helvetica Neue, white) | "raw" (monospace, grey)
//                                          | "error" (red, the x badge) | "warning" (yellow, the warning badge)
//   p.help(text, { label, action })        F252: a grey line with a bar button (Help) at its right; action(page)
//   p.status(text) / p.progress(percent)   the status line and the bar at the bottom
//   p.cancellable(bool)                    Cancel at the top left (onCancel), while a step can be stopped
//   p.finish({ label, action, status })    "Complete": the big bottom button (drawn from the 4S's
//                                          UIAlertSheetBlackButton) and Close at the top right. action() runs on the
//                                          button; a truthy return keeps the page up. Close only closes.
//                                          locked: true (B49, iFizBox's own sideload update handed to iOS): the button
//                                          and Close are greyed and do nothing (iOS closes iFizBox to install over
//                                          it; a Close tap had lost the update), Close coming back after LOCK_LIMIT.
//                                          also: { label, action } (B90) a second button above it, the same way
//                                          (Try Again over Return on an install cancelled in iOS's prompt).
//   p.reopen()                             "Running" again, for the next job of a run (progressHUD)
//   p.stoppable(fn)                        F188: Cancel at the top right from now until finish (the IPA installs: iOS's
//                                          own Install prompt can be cancelled, which would leave the page waiting for
//                                          ever). Its tap runs fn() and closes the page; finish() puts Done in its
//                                          place. stoppable(null) goes back to Close at the end.
//   p.close() / p.closed / p.onClose(fn)
//   F234, the queue run's page (screens/queuerun.js):
//   p.line(kind, text, pkg)                a line that knows its package; p.filter(pkg | null) shows only its lines
//   p.segmented(labels, onPick)            a segmented control on a band under the nav bar -> { select(i) }
//   p.pane(node) / p.view("pane" | "log")  another view in the body (the Packages list) in place of the log
//   openOn(page, seg, count)               F247: a run of one item opens on the Log tab, two or more on the rows list
//   p.bar({ left, right })                 the caller's own bar buttons in place of Cancel / Close from now on
//   p.hide() / p.show() / p.hidden         slides away and back, alive (the run goes on under the tabs)
//
// Every line is selectable and copyable. The log follows the newest line and stops while the user scrolls up
// (core/progress.js createFollow); a "New Output" pill brings it back. Lines come in batched, one paint a frame.
//
//   progressHUD(label)                     the HUD interface ({ set, hide, done, fail }, nav/hud.js liveHUD's) on this
//                                          page: the sideload IPA's and the website's installs (signing-client.js),
//                                          each label a step, its percent on the bar; a job started while the page
//                                          is still up continues on it. Beyond liveHUD's: finish({ label, action,
//                                          status }) ends it on another button, F155's "Open <app>" (signing-sheet.js
//                                          followInstall) once iOS says the app is installed. With several
//                                          on the page (a queue run), it completes when the last one ends (B27).
//                                          F188: Cancel at the top right all through (page.stoppable): its tap ends
//                                          the job, h.cancelled turns true, h.signal aborts and h.onCancel(fn)'s run
//                                          (the job's own stops: the Web Worker, the download, the bridge call's
//                                          answer); every later set/done/fail is ignored. Done replaces it at the end.
// SPDX-License-Identifier: GPL-3.0-or-later
import { el, barButton } from "./ui.js";
import { showSheet } from "./sheet.js";
import { createFollow, hudLine } from "../core/progress.js";
import { NAME } from "../brand.js";
import { FINISH_LABEL } from "../core/queue.js";
import { EASE, DURATION, SHEET_IN } from "./motion.js";
import { createLogBuffer, selectionIn } from "../screens/progress.js";

// B67: the plain finish button, Cydia's "Return to Cydia"
export const RETURN_LABEL = FINISH_LABEL.return;

// F247: the view a run page with rows (screens/apprun.js, screens/queuerun.js) opens on: a run of one item opens on
// the Log (a one-row list says nothing the log doesn't), two or more on the rows list. -> "log" | "pane"
export function startView(count) {
  return Number(count) === 1 ? "log" : "pane";
}

// F247: open a rows page on startView(count): selects the segmented control's tab (`seg`, page.segmented's; the rows
// list is tab 0, the Log tab `logTab`) and shows that view.
export function openOn(page, seg, count, { logTab = 1 } = {}) {
  const v = startView(count);
  seg.select(v === "log" ? logTab : 0);
  page.view(v);
  return v;
}

// B324: a row's bar on a rows page (screens/apprun.js, screens/queuerun.js). Under the native controls hook
// (native-controls.js) it is WebKit's own <progress>, iOS 26's UIProgressView (no value: WebKit's indeterminate bar);
// otherwise the drawn .qr-bar track and .qr-fill, which sweeps while indeterminate.
// F391: `waiting` (signed, waiting its turn) covers either with .qr-wait, the full bar with moving stripes (progress.css).
// -> { bar, set(fraction, sweep, waiting) }
export function rowBar(doc = globalThis.document) {
  if (doc?.documentElement?.getAttribute?.("data-style") === "ios26") {
    const bar = el("div", "qr-native");
    const progress = Object.assign(el("progress", "qr-progress"), { max: 1 });
    bar.append(progress, el("div", "qr-wait")); // a <progress> draws no children: the stripes lie over it
    return {
      bar,
      set(fraction, sweep, waiting = false) {
        bar.classList.toggle("is-waiting", !!waiting);
        if (sweep) progress.removeAttribute("value"); else progress.value = Math.max(0, Math.min(1, Number(fraction) || 0));
      },
    };
  }
  const bar = el("div", "qr-bar");
  const fill = el("div", "qr-fill");
  bar.append(fill, el("div", "qr-wait"));
  return {
    bar,
    set(fraction, sweep, waiting = false) {
      bar.classList.toggle("is-waiting", !!waiting);
      bar.classList.toggle("is-indeterminate", !!sweep);
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, Number(fraction) || 0))})`;
    },
  };
}

const MAX_LINES = 1500; // lines kept on screen while it follows; the callers' logs keep everything
// B49: how long a locked finish keeps Close greyed if iOS never closes iFizBox (no prompt came): then Close works
// again, so the page can't trap the user. iOS's prompt and the native CloseForUpdate exit normally come in seconds.
export const LOCK_LIMIT = 120_000;
// B49: the finish button while iFizBox's own update is with iOS (disabled; iOS closes iFizBox to finish it).
export const CLOSING_LABEL = `Closing ${NAME}`;
// B123: the locked finish button while iOS hasn't got the whole new IPA yet (iOS's prompt up, or its download going):
// CLOSING_LABEL only once the shell says it is closing (signing.selfUpdate finished or guessed).
export const WAITING_LABEL = "Waiting for iOS";
// B123: how long after "Closing" the page waits for iFizBox to be gone before it says to close it by hand (the
// shell exits 3 s after finished, 8 s after guessed).
export const CLOSE_GRACE = 20_000;
// B123: the honest end where iFizBox can't (or didn't) close by itself.
export const CLOSE_BY_HAND = `${NAME} didn't close by itself: close it from the app switcher so iOS can install the new version, then open the new ${NAME}.`;
export const RESTART_BY_HAND = `The new ${NAME} is installed. Close ${NAME} from the app switcher and open it again to use it.`;

export function openProgress({ title = "Running", onCancel = null } = {}) {
  const cancel = barButton("Cancel");
  cancel.hidden = true;
  const close = barButton("Close");
  close.hidden = true;

  const scroll = el("div", "progress-scroll");
  const out = el("div", "progress-out");
  out.setAttribute("role", "log");
  out.setAttribute("aria-live", "polite");
  const cursor = el("span", "progress-cursor");
  cursor.setAttribute("aria-hidden", "true");
  scroll.append(out, cursor);
  const jump = el("button", "progress-jump", "New Output");
  jump.type = "button";
  jump.hidden = true;
  const foot = el("div", "progress-foot");
  const statusText = el("div", "progress-status", "Preparing");
  // F345a: under the native controls hook (native-controls.js) the bar is WebKit's own <progress>, iOS 26's
  // UIProgressView; otherwise the drawn track and fill.
  const native = globalThis.document?.documentElement?.getAttribute?.("data-style") === "ios26";
  const track = native ? Object.assign(el("progress", "progress-bar"), { max: 100, value: 0 }) : el("div", "progress-track");
  const fill = el("div", "progress-fill");
  if (!native) track.append(fill);
  const finishButton = el("button", "progress-finish");
  finishButton.type = "button";
  finishButton.hidden = true;
  // B90: finish({ also }) draws a second button above it (Try Again over Return)
  const alsoButton = el("button", "progress-finish progress-also");
  alsoButton.type = "button";
  alsoButton.hidden = true;
  alsoButton.style.order = "1"; // drawn above the finish button, after it in the DOM (the finish button stays first)
  finishButton.style.order = "2";
  foot.append(statusText, track, finishButton, alsoButton);
  // nav/sheet.js's scaffold; Escape does nothing (the page closes through its own buttons, which know the run)
  const shell = showSheet({ title, body: [scroll, jump, foot], left: cancel, right: close, cls: "console progress-page",
    bodyCls: "progress-body", escape: false });
  const { sheet, h1, left, right, content: body } = shell;

  // ---- auto-scroll ----
  const follow = createFollow();
  const metrics = () => ({ top: scroll.scrollTop, height: scroll.scrollHeight, client: scroll.clientHeight });
  const toBottom = () => { scroll.scrollTop = scroll.scrollHeight; };
  scroll.addEventListener("scroll", () => {
    follow.scrolled(metrics());
    if (follow.following) jump.hidden = true;
  }, { passive: true });
  scroll.addEventListener("touchstart", () => follow.touch(true), { passive: true });
  const lift = () => follow.touch(false, metrics());
  scroll.addEventListener("touchend", lift, { passive: true });
  scroll.addEventListener("touchcancel", lift, { passive: true });
  jump.addEventListener("click", () => { follow.jump(); jump.hidden = true; toBottom(); });

  // ---- lines, one paint a frame ----
  let filterPkg = null; // F234: only this package's lines show (page.filter)
  // B93 (screens/progress.js): one append a frame, a repeating byte/percent line updated in place, and nothing
  // added while a selection is in the log (it goes out once the selection ends). No layout reads on this path.
  const doc = globalThis.document;
  const selecting = () => selectionIn(out, doc);
  const log = createLogBuffer({
    container: out,
    fragment: () => doc.createDocumentFragment(),
    held: selecting,
    max: MAX_LINES,
    make: ({ kind, text, pkg, label, action }) => {
      if (kind === "help") return helpLine(text, label, action);
      const d = el("div", `pl pl-${kind}`, text);
      if (pkg) d.dataset.pkg = pkg; // F234: the queue run's lines know their package (page.filter)
      if (filterPkg && pkg !== filterPkg) d.hidden = true;
      if (kind === "error" || kind === "warning") d.setAttribute("role", kind === "error" ? "alert" : "note");
      return d;
    },
    onFlush: () => {
      if (follow.shouldScroll()) {
        while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
        scroll.scrollTop = 1e9; // to the bottom without reading scrollHeight (the browser clamps it)
      } else if (!follow.following) jump.hidden = false;
    },
  });
  const flush = () => { log.flush(); };
  const onSelection = () => { if (!selecting()) log.release(); };
  doc?.addEventListener?.("selectionchange", onSelection);

  let closed = false;
  let finished = false;
  let custom = false;      // F234: page.bar put the caller's own buttons up
  let paneNode = null;     // F234: page.pane's view
  let hiddenPage = false;  // F234: page.hide
  const closers = [];
  let segNode = null;      // B303: page.segmented's control, in the title's place
  const setTitle = (t) => { if (!segNode) h1.textContent = t; sheet.setAttribute("aria-label", t); };
  const setProgress = (pct) => {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    if (native) track.value = p;
    else fill.style.transform = `scaleX(${p / 100})`;
  };
  setProgress(0);

  cancel.addEventListener("click", () => { if (!cancel.disabled && onCancel) onCancel(); });

  // F188: the right button is Cancel while a stoppable page runs, Done once it has finished (else Close, at the end)
  let stop = null;
  // B49: a locked finish (iFizBox's own update handed to iOS): Close greyed at the top right, not tappable, until the
  // safety timer (LOCK_LIMIT) gives it back in case iOS never takes over
  let locked = false;
  let lockTimer = 0;
  const rightButton = () => {
    close.textContent = locked ? "Close" : stop ? (finished ? "Done" : "Cancel") : "Close";
    close.hidden = custom || (!locked && !stop && !finished);
    close.disabled = locked;
  };
  const unlockRight = () => { clearTimeout(lockTimer); lockTimer = 0; locked = false; rightButton(); };

  const page = {
    sheet, scroll, out,
    get closed() { return closed; },
    get finished() { return finished; },
    line(kind, text, pkg = null) {
      const t = String(text ?? "");
      if (!t || closed) return;
      log.push({ kind: ["step", "raw", "error", "warning"].includes(kind) ? kind : "raw", text: t, pkg: pkg || null });
    },
    // F252: a grey line with a bar button at its right (the IPA install's "Not on the Home Screen?" and Help).
    // action(page) runs on the button's tap.
    help(text, { label = "Help", action = null } = {}) {
      const t = String(text ?? "");
      if (!t || closed) return;
      log.push({ kind: "help", text: t, label, action: () => action?.(page) });
    },
    // ---- F234: the queue run's page (screens/queuerun.js) ----
    // Only `pkg`'s lines (null: all of them).
    filter(pkg) {
      flush();
      filterPkg = pkg || null;
      for (const d of out.children) d.hidden = Boolean(filterPkg) && d.dataset.pkg !== filterPkg;
      toBottom();
    },
    get filtered() { return filterPkg; },
    // A segmented control in the nav bar's title slot (B303: one bar, as iOS 6's Phone > Recents; the title
    // "Running" / "Complete" stays the page's label): labels, onPick(index). -> { select(index) }
    segmented(labels, onPick) {
      const seg = el("div", "progress-seg");
      seg.setAttribute("role", "tablist");
      const buttons = labels.map((label, i) => {
        const b = el("button", "progress-seg-item", label);
        b.type = "button";
        b.setAttribute("role", "tab");
        b.addEventListener("click", () => { select(i); onPick?.(i); });
        seg.append(b);
        return b;
      });
      const select = (i) => buttons.forEach((b, j) => { b.classList.toggle("selected", i === j); b.setAttribute("aria-selected", String(i === j)); });
      select(0);
      segNode = seg;
      h1.replaceChildren(seg);
      h1.classList.add("has-seg");
      return { select };
    },
    // Another view in the page's body (the Packages list), shown in place of the log by view("pane").
    pane(node) {
      node.classList.add("progress-pane");
      body.insertBefore(node, jump);
      paneNode = node;
      return node;
    },
    view(which) {
      const pane = which === "pane" && paneNode;
      if (paneNode) paneNode.hidden = !pane;
      scroll.hidden = Boolean(pane);
      if (pane) jump.hidden = true;
      else if (follow.shouldScroll()) toBottom();
    },
    // Bar buttons of the caller's own in place of Cancel/Close: { left, right } nodes (null: none there).
    bar({ left: l = null, right: r = null } = {}) {
      custom = true;
      cancel.hidden = true;
      close.hidden = true;
      for (const n of [...left.children]) if (n !== cancel) n.remove();
      for (const n of [...right.children]) if (n !== close) n.remove();
      if (l) left.append(l);
      if (r) right.append(r);
    },
    // Hide: the page slides down and stays alive (show() brings it back); the caller draws what reopens it.
    hide() {
      if (closed || hiddenPage) return;
      hiddenPage = true;
      shell.cover(false); // B401: the theme's status-bar text while it is away
      sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: DURATION, easing: EASE, fill: "forwards" })
        .finished.then(() => { if (hiddenPage) sheet.style.visibility = "hidden"; }, () => {});
    },
    show() {
      if (closed || !hiddenPage) return;
      hiddenPage = false;
      shell.cover(true);
      sheet.style.visibility = "";
      sheet.getAnimations?.().forEach((a) => a.cancel());
      sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: SHEET_IN, easing: EASE });
      flush();
      if (follow.shouldScroll()) toBottom();
    },
    get hidden() { return hiddenPage; },
    step(text) { page.line("step", text); },
    raw(text) { page.line("raw", text); },
    error(text) { page.line("error", text); },
    warning(text) { page.line("warning", text); },
    status(text) { statusText.textContent = String(text ?? ""); },
    progress: setProgress,
    setTitle,
    flush,
    cancellable(on, { disabled = false } = {}) { cancel.hidden = custom || !on; cancel.disabled = Boolean(disabled); },
    stoppable(fn) { stop = typeof fn === "function" ? fn : null; rightButton(); },
    get stopping() { return Boolean(stop) && !finished; },
    finish({ label = RETURN_LABEL, action = null, status = null, title: t = "Complete", locked: lock = false, unlockAfter = LOCK_LIMIT, also = null } = {}) {
      flush();
      finished = true;
      clearTimeout(lockTimer);
      lockTimer = 0;
      locked = Boolean(lock);
      finishButton.classList.toggle("is-locked", locked);
      setTitle(t);
      setProgress(100);
      if (status != null) statusText.textContent = status;
      // B67: no status line over the finished page's button (it only repeated the log's last line)
      statusText.hidden = true;
      cancel.hidden = true;
      cursor.hidden = true;
      track.hidden = true;
      finishButton.textContent = label;
      finishButton.hidden = false;
      finishButton.disabled = locked;
      if (locked && unlockAfter > 0) lockTimer = setTimeout(unlockRight, unlockAfter);
      finishButton.onclick = locked ? null : async () => {
        if (finishButton.disabled) return;
        finishButton.disabled = true;
        let keep = false;
        try { keep = action ? await action() : false; } catch { keep = true; }
        finishButton.disabled = false;
        if (!keep) page.close();
      };
      // B90: { label, action } a second button above the first, the same way (a truthy return keeps the page up)
      alsoButton.hidden = locked || !also?.label;
      alsoButton.textContent = also?.label ?? "";
      alsoButton.disabled = false;
      alsoButton.onclick = alsoButton.hidden ? null : async () => {
        if (alsoButton.disabled) return;
        alsoButton.disabled = true;
        let keep = false;
        try { keep = also.action ? await also.action() : false; } catch { keep = true; }
        alsoButton.disabled = false;
        if (!keep) page.close();
      };
      rightButton();
      if (follow.shouldScroll()) toBottom();
    },
    reopen({ title: t = "Running", status = "Preparing" } = {}) {
      finished = false;
      clearTimeout(lockTimer);
      lockTimer = 0;
      locked = false;
      finishButton.classList.remove("is-locked");
      finishButton.disabled = false;
      setTitle(t);
      statusText.textContent = status;
      statusText.hidden = false;
      setProgress(0);
      track.hidden = false;
      cursor.hidden = false;
      finishButton.hidden = true;
      alsoButton.hidden = true;
      alsoButton.onclick = null;
      rightButton();
    },
    onClose(fn) { closers.push(fn); },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      clearTimeout(lockTimer);
      log.cancel();
      doc?.removeEventListener?.("selectionchange", onSelection);
      for (const f of closers.splice(0)) { try { f(); } catch { /* the page goes anyway */ } }
      return shell();
    },
  };
  close.addEventListener("click", () => {
    if (close.disabled || locked) return;
    if (stop && !finished) { const f = stop; stop = null; try { f(); } catch { /* the page goes anyway */ } }
    page.close();
  });
  return page;
}

// F252: page.help's line: the text grey on the left, a bar button (the black bar's, .console .bar-button) on the right
function helpLine(text, label, action) {
  const d = el("div", "pl pl-help");
  d.setAttribute("role", "note");
  const b = barButton(label || "Help", "pl-help-button");
  b.addEventListener("click", () => action?.());
  d.append(el("span", "pl-help-text", text), b);
  return d;
}

// ---- the HUD interface on the page ------------------------------------------------------------------------------

let hudPage = null; // the page progressHUD drew last, while it is up
// B27: the HUDs still running on each page. A queue run starts the next app's job while the last one's
// signing.progress still streams on the same page, so the page completes only once every one of them has ended
// (the last to end gives the button); before, the first to end said Complete over the other's "Installing 72%".
const running = new WeakMap();
// B49: pages a job ended locked (lockSelfUpdate), with its label
const lockedPages = new WeakMap();

// B49: iFizBox's own sideload update is with iOS (the itms-services link opened; native CloseForUpdate exits once
// iOS's prompt is answered). The page ends on "Closing iFizBox", greyed, with Close greyed too: a Close tap there had
// lost the update (user 2026-11-18, 0.9.6 to 0.9.7). A HUD without finish (tests, an older caller) ends on Done after
// 1.2 s as before. -> true when it locked.
// B123: `label` WAITING_LABEL while the shell still waits for iOS (followSelfUpdate turns it to CLOSING_LABEL).
export function lockSelfUpdate(h, { later = setTimeout, label = CLOSING_LABEL } = {}) {
  if (typeof h?.finish === "function") {
    h.set?.("Done");
    h.finish({ label, status: "Done", locked: true });
    return true;
  }
  later(() => (h?.done ? h.done("Done") : h?.hide?.()), 1200);
  return false;
}

// B83: iFizBox's own update ended without iOS taking it (native CloseForUpdate said notStarted or stalled; iFizBox
// stays open): the locked page (lockSelfUpdate) gets its buttons back, the error in red, and Try Again as its finish
// button (`retry`, which runs on the tap; the page closes first). -> true when the page was there to change.
export const TRY_AGAIN_LABEL = "Try Again";
export function unlockSelfUpdate(h, { message = "", retry = null } = {}) {
  const page = h?.page;
  if (!page || page.closed || typeof page.finish !== "function") return false;
  lockedPages.delete(page);
  if (message) page.error?.(message);
  page.finish({ label: retry ? TRY_AGAIN_LABEL : RETURN_LABEL, status: "Failed", title: "Not Updated",
    action: retry ? () => { setTimeout(() => { retry(); }, 0); return false; } : null });
  return true;
}

// `open` stands in for openProgress (tests).
export function progressHUD(label = "Preparing", { open = openProgress, done: doneLabel = RETURN_LABEL } = {}) {
  let page = hudPage && !hudPage.closed ? hudPage : null;
  if (page) page.reopen();
  else {
    page = open({ title: "Running" });
    hudPage = page;
    page.onClose?.(() => { if (hudPage === page) hudPage = null; });
  }
  if (!running.has(page)) running.set(page, new Set());
  const mine = {};
  running.get(page).add(mine);
  let last = null;
  let ended = false;
  let cancelled = false;
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const stops = [];
  const runStop = (f) => { try { f(); } catch { /* the rest still stop */ } };
  const cancel = () => {
    if (ended) return;
    ended = true;
    cancelled = true;
    try { ctl?.abort(); } catch { /* no signal */ }
    for (const f of stops.splice(0)) runStop(f);
  };
  page.stoppable?.(cancel);
  const set = (t) => {
    if (ended) return;
    const { text, percent } = hudLine(t);
    if (!text) return;
    if (text !== last) page.step(text);
    last = text;
    page.status(t);
    if (percent != null) page.progress(percent);
  };
  set(label);
  const end = (status, { label = doneLabel, action = null, locked = false, title = undefined, also = null } = {}) => {
    if (ended) return;
    ended = true;
    if (locked) lockedPages.set(page, label);
    const open = running.get(page);
    open?.delete(mine);
    if (open?.size) return; // another job still runs on the page: it stays Running
    // B49: once one job on the page was iFizBox's own update, the page ends locked whichever job ends last
    if (lockedPages.has(page)) page.finish({ label: lockedPages.get(page), status, locked: true });
    else page.finish({ label, action, status, ...(title ? { title } : {}), ...(also ? { also } : {}) });
  };
  return {
    set,
    // a job that ends without saying how (its alert says it): the page completes, Return under it
    hide: () => end(null),
    done: (t = "Done") => { if (!ended) { if (t !== last) page.step(t); last = t; } end(t); },
    fail: (message) => { if (!ended && message) page.error(message); end("Failed"); },
    // B90: title ("Not Installed") in place of Complete, and also: { label, action }, a second button above
    finish: ({ label = doneLabel, action = null, status = last, locked = false, title = undefined, also = null } = {}) => end(status, { label, action, locked, title, also }),
    get cancelled() { return cancelled; },
    signal: ctl?.signal ?? null,
    onCancel: (fn) => { if (typeof fn !== "function") return; if (cancelled) runStop(fn); else stops.push(fn); },
    cancel,
    page,
  };
}
