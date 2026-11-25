// Hide's strip: a run's page put away with Hide (F234 screens/queuerun.js, F430 screens/apprun.js) leaves this black
// strip under every tab's nav bar (queue.css .qr-strip): `text()` on the left, Show on the right, which is onShow().
//   runStrip({ text, onShow }) -> { show(), update() (the text again), hide() }
// SPDX-License-Identifier: GPL-3.0-or-later
import { el } from "../nav/ui.js";

export function runStrip({ text, onShow }) {
  let node = null;
  const strip = {
    show() {
      if (node) return;
      node = el("button", "qr-strip");
      node.type = "button";
      node.append(el("span", "qr-strip-text"), el("span", "qr-strip-show", "Show"));
      node.addEventListener("click", onShow);
      document.body.append(node);
      document.body.classList.add("qr-stripped");
      strip.update();
    },
    update() { if (node) node.firstChild.textContent = text(); },
    hide() { node?.remove(); node = null; document.body.classList.remove("qr-stripped"); },
  };
  return strip;
}
