// B397: every spinner keeps turning after a trip out of the app (Shortcuts, Settings, the lock screen). iOS takes an
// app's Core Animation animations away while it is behind, and WebKit puts its own back; a spinner left standing still
// after a trip was reported (iOS 27, 0.26.0), so on the return each one is started again where it was. Only the
// hud-spin animations (style.css), which look the same when restarted.
export function respin(doc = globalThis.document) {
  let n = 0;
  for (const a of doc?.getAnimations?.() ?? []) {
    if (!/^hud-spin/.test(a.animationName ?? "") || a.playState !== "running") continue;
    const t = a.currentTime;
    a.pause();
    a.currentTime = t;
    a.play(); // a new Core Animation animation
    n++;
  }
  return n;
}

export function respinOnReturn(doc = globalThis.document, win = globalThis.window) {
  const back = () => { if (doc.visibilityState === "visible") respin(doc); };
  doc?.addEventListener?.("visibilitychange", back);
  win?.addEventListener?.("pageshow", back);
}
