// F193: the bar that says what a swipe just queued, with Undo. iOS 6 had no toast, so it is the kit's
// "Semi-transparent black bar" (the keyboard toolbar, 44pt) docked above the tab bar, the message on the left and the
// blue bar button on the right. It slides up, hides after `duration` ms, and a new one replaces the old. Styles:
// ios6.css (.undo-bar); iOS 7 a flat toolbar, iOS 13 a rounded card and iOS 26 a glass capsule floating over the
// tab bar (B333: style.css's --undo-* hooks place it, each era's sheet paints it). Transform and opacity only.
//
//   showUndoBar({ message, onUndo, duration = 4000 }) -> close()

let open = null; // { el, close }

export function showUndoBar({ message, onUndo, duration = 4000 }) {
  if (open) open.close(true);
  const bar = document.createElement("div");
  bar.className = "undo-bar";
  bar.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "undo-bar-text";
  text.textContent = message;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "bar-button done undo-bar-button"; // the kit's blue bar button (sources.css .bar-button.done)
  undo.textContent = "Undo";
  undo.addEventListener("click", () => { close(); onUndo?.(); });
  bar.append(text, undo);
  document.body.append(bar);
  // Next frame: from below its own height, so the transition plays.
  requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add("shown")));
  const timer = setTimeout(() => close(), duration);

  function close(instant = false) {
    if (open !== ctl) return;
    open = null;
    clearTimeout(timer);
    if (instant) { bar.remove(); return; }
    bar.classList.remove("shown");
    const gone = () => bar.remove();
    bar.addEventListener("transitionend", gone, { once: true });
    setTimeout(gone, 400);
  }
  const ctl = { el: bar, close };
  open = ctl;
  return () => close();
}
