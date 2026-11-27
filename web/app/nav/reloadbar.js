// F150: Cydia's reload bar. While sources refresh, a dark translucent strip shows, with a small white spinner at its
// left, a line saying what is happening (core/reloadsteps.js) and a blue Cancel at its right. It blocks nothing:
// there is no scrim, only the strip itself takes touches. F204: it sits on top of the tab bar and slides up from
// behind it; nothing on the page moves. B154: a modal sheet covers it, as on iOS 6 (ios6.css), and it shows again
// when the sheet closes. html.has-reload only gives every
// scroller 44 pt more room at its end (ios6.css) so the last row still scrolls clear of the strip. It slides back
// down behind the tab bar when hidden. Only transform animates.
//
//   const bar = showReloadBar("Updating Sources", { onCancel: () => stop() });
//   bar.set("Loading Data");  bar.hide();   // hide() waits until the last step has had its time
//
// F179: only Cydia's few general steps ever show (core/reloadsteps.js STEP_TEXT): any other text is dropped, and
// "Downloading <anything>" shows as "Downloading Packages", so no source name, URL or count reaches the strip. Each
// step stays up at least `minMs` (0.6 s) even when the work is faster: later steps queue behind it, and hide()
// lets the queue play out before the bar slides away. Cancel, or a new bar, takes it away at once.
//
// One bar at a time: showing another takes the first away at once. `doc` and `clock` are for the tests.
//
// F456: the bar is also where a failure with no page of its own shows (a source refresh, a repo that won't load).
//
//   showReloadFailure([{ title: "BigBoss", detail: "HTTP 404" }], { text })
//
// The bar turns into the failure line (FAILED_TEXT, or `text`) with Show Info where Cancel was, and slides away by
// itself after FAILED_MS. While a refresh is still under way, its bar takes the failures and turns when it ends
// (bar.add(failures) then bar.hide()); on a failure line already up, more failures join its list. Show Info opens
// the black log (screens/apprun.js openFailureLog) with the run's steps and every failure. Cancel drops them.

import { STEP_TEXT } from "../core/reloadsteps.js";
import { EASE, DURATION } from "./motion.js";

export const PHASES = Object.freeze(Object.values(STEP_TEXT));
export const MIN_STEP_MS = 600;

// The fixed step a text stands for, or null for a text that is none of them.
export function phaseOf(text) {
  const t = String(text ?? "").trim();
  if (PHASES.includes(t)) return t;
  if (/^Downloading\b/.test(t)) return STEP_TEXT.download;
  return null;
}

export const FAILED_TEXT = "Some sources couldn't be updated.";
export const INFO_LABEL = "Show Info";
export const FAILED_MS = 6000;

const realClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) };

const openLog = (failures, steps) => import("../screens/apprun.js").then((m) => m.openFailureLog(failures, steps)).catch(() => {});

let current = null;

// `steps` are for the log of a run that had no bar of its own.
export function showReloadFailure(failures, { text, ms, onInfo, steps, ...opts } = {}) {
  const list = (failures ?? []).filter(Boolean);
  if (!list.length) return null;
  const up = current;
  const bar = up ?? showReloadBar("", opts);
  bar.add(list, { text, ms, onInfo, steps });
  if (!up) bar.hide();
  return bar;
}

export function showReloadBar(text = "", { onCancel = null, doc = globalThis.document, minMs = MIN_STEP_MS, clock = realClock } = {}) {
  // F456: failures a run took but hasn't shown yet go on to the bar that replaces it.
  const carried = current?.take() ?? null;
  current?.dismiss();
  if (!doc?.createElement) return { set() {}, add() {}, take: () => null, hide() {}, dismiss() {}, el: null, get hidden() { return true; } };
  const bar = doc.createElement("div");
  bar.className = "reload-bar";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = '<span class="reload-spinner" aria-hidden="true"></span>' // F166: UIKit's white spinner (ios6.css)
    + '<span class="reload-text"></span>';
  const label = bar.querySelector?.(".reload-text") ?? null;
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "bar-button done reload-cancel";
  cancel.textContent = "Cancel";
  bar.append(cancel);

  let hidden = false;   // hide() was asked: the run is over, set() changes nothing more
  let gone = false;     // the strip has started sliding away
  let shown = null;     // the step on screen
  let shownAt = -Infinity;
  const queue = [];     // steps waiting for the one on screen to have had its time
  let timer = null;
  const root = doc.documentElement;
  const steps = [];     // F456: every step the run reached, for the log
  const failures = [];
  let said = {};        // the failure line's { text, ms, onInfo }
  let failed = false;   // the strip is the failure line now
  let failedAt = 0;

  const show = (t) => { shown = t; shownAt = clock.now(); if (label) label.textContent = t; };
  const slide = () => {
    if (gone) return;
    gone = true;
    hidden = true;
    queue.length = 0;
    if (timer != null) { clock.clearTimeout(timer); timer = null; }
    if (current === handle) current = null;
    root?.classList?.remove("has-reload");
    const a = bar.animate?.([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 250, easing: "ease-in", fill: "forwards" });
    if (a?.finished) a.finished.then(() => bar.remove(), () => bar.remove());
    else bar.remove();
  };
  // F456: the failure line stays `ms` from the last failure that joined it.
  const linger = () => {
    if (timer != null) clock.clearTimeout(timer);
    timer = clock.setTimeout(slide, said.ms ?? FAILED_MS);
  };
  const turn = () => {
    failed = true;
    failedAt = clock.now();
    bar.querySelector?.(".reload-spinner")?.remove();
    if (label) label.textContent = said.text ?? FAILED_TEXT;
    cancel.textContent = INFO_LABEL;
    linger();
  };
  const finish = () => (failures.length ? turn() : slide());
  // Shows what waits once the step on screen has had minMs, then (hide() asked) turns to the failure line or slides away.
  const pump = () => {
    timer = null;
    if (gone) return;
    const left = shownAt + minMs - clock.now();
    if (left > 0 && (queue.length || hidden)) { timer = clock.setTimeout(pump, left); return; }
    if (queue.length) { show(queue.shift()); if (queue.length || hidden) timer = clock.setTimeout(pump, minMs); return; }
    if (hidden) finish();
  };
  const handle = {
    // F456: failures to show once the run ends (at once on a failure line already up).
    add(list, opts = {}) {
      if (gone) return;
      for (const [k, v] of Object.entries(opts)) if (v != null) said[k] ??= v;
      for (const f of list ?? []) if (!failures.some((x) => x.title === f.title && x.detail === f.detail)) failures.push(f);
      if (failed) linger();
    },
    // What a bar replacing this one carries on: failures not shown yet, or on a line too new to have been read.
    take: () => (gone || !failures.length || (failed && clock.now() - failedAt >= minMs) ? null : { list: [...failures], opts: said }),
    el: bar,
    get hidden() { return hidden; },
    set(t) {
      if (hidden) return;
      const p = phaseOf(t);
      if (!p || p === (queue.at(-1) ?? shown)) return;
      steps.push(p);
      queue.push(p);
      if (timer == null) pump();
    },
    hide() {
      if (hidden) return;
      hidden = true;
      if (timer == null) pump();
    },
    dismiss: slide,
  };
  cancel.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    if (gone) return;
    const asked = hidden;
    slide();
    if (failed) (said.onInfo ?? openLog)([...failures], steps.length ? [...steps] : [...(said.steps ?? [])]);
    else if (!asked) onCancel?.();
  });
  handle.set(text);
  if (carried) handle.add(carried.list, carried.opts);
  doc.body.append(bar);
  bar.animate?.([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: DURATION, easing: EASE });
  root?.classList?.add("has-reload");
  current = handle;
  return handle;
}
