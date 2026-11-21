// The concept phone takes a mouse as a finger (tools/concept/build.py puts this in the iframe's <head> right after
// shell.js, before any of the app runs). A classic script, no imports. SPDX-License-Identifier: GPL-3.0-or-later
//
// What Chromium's device mode does with "touch" on, done in the page because an Artifact can't ask the browser for
// it: the app never sees the mouse. A press is a touch (pointerdown with pointerType "touch", then touchstart), a
// move is pointermove + touchmove, a release is pointerup + touchend and, for a tap, the compatibility mouse events
// and a click. So the app's own touch code runs: the pressed rows (app.js .is-pressed), long presses, the edge swipe
// back (nav/swipe.js), swipe to delete (nav/rowswipe.js), pull to refresh, the switches.
//
// A drag pans like a finger: once it moves past SLOP in a direction the touch-action under it allows, the pointer
// is cancelled (pointercancel, as a browser does when it takes a touch for a scroll), the nearest scroller that way
// follows the finger, keeps going with momentum on release and rubber-bands past its ends. A touchstart or an
// early touchmove that calls preventDefault keeps the drag for the app; so does a scroller the app sets to
// overflow: hidden mid-drag (pull to refresh, the scroll indicator's grab).
//
// The rest of the touch look: :active and :hover are rewritten at build time (build.py touch_css) to
// .concept-active, set here on the touched element and its ancestors while the finger is down and off once it pans,
// and to nothing (no hover on a phone); (hover)/(pointer) media queries answer as a phone's, in CSS and matchMedia;
// the cursor is a round touch dot.
(function () {
  "use strict";
  if (window.__conceptTouch) return;
  window.__conceptTouch = true;

  var SLOP = 10;            // px a press may move and still be a tap (and before a drag pans)
  var POINTER = 2;          // the finger's pointerId (the mouse is 1)
  var DECEL = 0.998;        // UIScrollView's normal deceleration, per ms
  var MIN_V = 0.02;         // px/ms where a fling stops
  var SPRING_MS = 450;      // a rubber band's way back
  var doc = document;

  // ---- what the page asks about the device
  if (!("ontouchstart" in window)) { try { window.ontouchstart = null; doc.ontouchstart = null; } catch (e) { /* kept */ } }
  var mq = window.matchMedia;
  if (mq) {
    window.matchMedia = function (q) { return mq.call(window, phoneQuery(String(q))); };
  }
  function phoneQuery(q) {
    return q.replace(/\(\s*(any-)?hover\s*:\s*hover\s*\)/g, "(max-width: 0px)")
      .replace(/\(\s*(any-)?hover\s*:\s*none\s*\)/g, "(min-width: 0px)")
      .replace(/\(\s*(any-)?pointer\s*:\s*fine\s*\)/g, "(max-width: 0px)")
      .replace(/\(\s*(any-)?pointer\s*:\s*coarse\s*\)/g, "(min-width: 0px)")
      .replace(/\(\s*(any-)?(hover|pointer)\s*\)/g, "(min-width: 0px)");
  }
  window.__conceptPhoneQuery = phoneQuery;

  // The touch dot: a grey disc like device mode's, darker while pressed. On every element, over the app's own
  // cursor: pointer and grab.
  function dot(alpha) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10.5" fill="rgba(0,0,0,' + alpha +
      ')" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 12 12, pointer';
  }
  var style = doc.createElement("style");
  style.setAttribute("data-concept-touch", "");
  style.textContent = "html, html * { cursor: " + dot(0.28) + " !important; }\n" +
    "html.concept-touching, html.concept-touching * { cursor: " + dot(0.5) + " !important; }";
  (doc.head || doc.documentElement).appendChild(style);

  // ---- pointer capture for the finger (the browser only knows the mouse's pointer, so its own calls would throw)
  var proto = Element.prototype;
  var realSet = proto.setPointerCapture, realRelease = proto.releasePointerCapture, realHas = proto.hasPointerCapture;
  var g = null; // the touch: { target, capture, x0, y0, x, y, state: "down"|"pan"|"taken", ... }
  proto.setPointerCapture = function (id) {
    if (id !== POINTER) return realSet.call(this, id);
    if (!g || g.state !== "down") throw new DOMException("No active pointer with the given id is found.", "NotFoundError");
    if (g.capture === this) return;
    var was = g.capture;
    g.capture = this;
    if (was) fire(was, "lostpointercapture", false);
    fire(this, "gotpointercapture", false);
  };
  proto.releasePointerCapture = function (id) {
    if (id !== POINTER) return realRelease.call(this, id);
    if (g && g.capture === this) { g.capture = null; fire(this, "lostpointercapture", false); }
  };
  proto.hasPointerCapture = function (id) {
    if (id !== POINTER) return realHas.call(this, id);
    return Boolean(g && g.capture === this);
  };

  // ---- the events the app gets
  function pointerInit(x, y, extra) {
    return Object.assign({ bubbles: true, cancelable: true, composed: true, view: window, pointerId: POINTER, pointerType: "touch",
      isPrimary: true, clientX: x, clientY: y, screenX: x, screenY: y, width: 23, height: 23, pressure: 0.5, button: -1, buttons: 1 }, extra);
  }
  function fire(target, type, cancelable, extra) {
    var x = g ? g.x : 0, y = g ? g.y : 0;
    var bubbles = !/^(pointerenter|pointerleave)$/.test(type);
    var ev = new PointerEvent(type, pointerInit(x, y, Object.assign({ cancelable: cancelable, bubbles: bubbles }, extra)));
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  function touchList(t) { return t ? [t] : []; }
  // A browser without Touch/TouchEvent constructors (desktop Safari) gets the pointer events only.
  var HAS_TOUCH = (function () {
    try { return typeof Touch === "function" && typeof TouchEvent === "function" && Boolean(new Touch({ identifier: 0, target: doc })); }
    catch (e) { return false; }
  })();
  function touch(type, cancelable) {
    if (!HAS_TOUCH) return false;
    var t = new Touch({ identifier: 0, target: g.target, clientX: g.x, clientY: g.y, screenX: g.x, screenY: g.y,
      pageX: g.x + scrollX, pageY: g.y + scrollY, radiusX: 11.5, radiusY: 11.5, rotationAngle: 0, force: 1 });
    var down = type === "touchstart" || type === "touchmove";
    var ev = new TouchEvent(type, { bubbles: true, cancelable: cancelable, composed: true, view: window,
      touches: touchList(down ? t : null), targetTouches: touchList(down ? t : null), changedTouches: [t] });
    g.target.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  function mouse(target, type, x, y, extra) {
    var Ctor = type === "click" ? PointerEvent : MouseEvent;
    var init = Object.assign({ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: type === "mousedown" ? 1 : 0, detail: /^(mousedown|mouseup|click)$/.test(type) ? 1 : 0 }, extra);
    if (type === "click") Object.assign(init, { pointerId: POINTER, pointerType: "touch", isPrimary: true });
    target.dispatchEvent(new Ctor(type, init));
  }
  function activeOn(el) {
    activeOff();
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) n.classList.add("concept-active");
  }
  function activeOff() {
    var on = doc.querySelectorAll(".concept-active");
    for (var i = 0; i < on.length; i++) on[i].classList.remove("concept-active");
  }

  // ---- panning: which way the touch-action under the finger lets the browser pan, and what scrolls that way
  // As a browser does: the touch-action of the element under the finger and its ancestors up to (and including)
  // the scroller that would pan that way; a vertical page's pan-y doesn't stop a sideways strip inside it.
  function panAllowed(el, axis) {
    var stop = scrollerFor(el, axis);
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var ta = getComputedStyle(n).touchAction || "auto";
      if (ta !== "auto" && ta !== "manipulation") {
        if (ta === "none") return false;
        if (axis === "x" ? !/pan-(x|left|right)/.test(ta) : !/pan-(y|up|down)/.test(ta)) return false;
      }
      if (n === stop) break;
    }
    return true;
  }
  function scrollerFor(el, axis) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n), ov = axis === "y" ? cs.overflowY : cs.overflowX;
      var range = axis === "y" ? n.scrollHeight - n.clientHeight : n.scrollWidth - n.clientWidth;
      if (n === doc.documentElement || n === doc.body) {
        if (ov !== "hidden" && ov !== "clip" && range > 1) return doc.scrollingElement || n;
        continue;
      }
      if ((ov === "auto" || ov === "scroll") && range > 1) return n;
    }
    return null;
  }
  function canScroll(el, axis) {
    var cs = getComputedStyle(el), ov = axis === "y" ? cs.overflowY : cs.overflowX;
    return el === doc.scrollingElement ? ov !== "hidden" : ov === "auto" || ov === "scroll";
  }
  function pos(el, axis) { return axis === "y" ? el.scrollTop : el.scrollLeft; }
  function setPos(el, axis, v) { if (axis === "y") el.scrollTop = v; else el.scrollLeft = v; }
  function range(el, axis) { return Math.max(0, axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth); }
  function dim(el, axis) { return (axis === "y" ? el.clientHeight : el.clientWidth) || 480; }
  // UIScrollView's rubber band: the farther past the end, the less the content follows
  function rubber(d, size) { var a = Math.abs(d); return (d < 0 ? -1 : 1) * (1 - 1 / (a * 0.55 / size + 1)) * size; }

  // The overscroll is drawn by moving the scroller's children (a scroller can't scroll past its ends from script),
  // as an animation added on top of whatever transform they have, so it never fights the app's own.
  var bands = new Map(); // scroller -> { axis, off, anims: [Animation] }
  function shift(axis, off) { return axis === "y" ? "translateY(" + off + "px)" : "translateX(" + off + "px)"; }
  function band(sc, axis, off) {
    var b = bands.get(sc);
    if (!b) { b = { axis: axis, off: 0, anims: [] }; bands.set(sc, b); }
    b.anims.forEach(function (a) { a.cancel(); });
    b.off = off;
    b.anims = [];
    if (!off) { bands.delete(sc); return; }
    for (var c = sc.firstElementChild; c; c = c.nextElementSibling) {
      var a = c.animate([{ transform: shift(axis, off) }, { transform: shift(axis, off) }], { duration: 1e9, composite: "add" });
      a.pause();
      b.anims.push(a);
    }
  }
  function springBack(sc) {
    var b = bands.get(sc);
    if (!b) return;
    var from = b.off, axis = b.axis;
    band(sc, axis, 0);
    for (var c = sc.firstElementChild; c; c = c.nextElementSibling) {
      c.animate([{ transform: shift(axis, from) }, { transform: shift(axis, 0) }],
        { duration: SPRING_MS, easing: "cubic-bezier(.25,.8,.3,1)", composite: "add" });
    }
  }
  // Running into an end with speed left: out past it and back, farther the faster (up to 80 px)
  function bounce(sc, axis, v) {
    var d = Math.min(80, Math.abs(v) * 22) * (v < 0 ? 1 : -1);
    if (Math.abs(d) < 4) return;
    for (var c = sc.firstElementChild; c; c = c.nextElementSibling) {
      c.animate([{ transform: shift(axis, 0), easing: "cubic-bezier(.15,.6,.35,1)" }, { transform: shift(axis, d), offset: 0.2,
        easing: "cubic-bezier(.3,0,.15,1)" }, { transform: shift(axis, 0) }], { duration: 900, composite: "add" });
    }
  }

  var glide = 0;
  function stopGlide() { if (glide) { cancelAnimationFrame(glide); glide = 0; return true; } return false; }
  function fling(sc, axis, v) {
    var last = performance.now();
    function step(now) {
      var dt = Math.min(32, now - last);
      last = now;
      v *= Math.pow(DECEL, dt);
      var max = range(sc, axis), prev = pos(sc, axis), next = Math.max(0, Math.min(max, prev + v * dt));
      setPos(sc, axis, next);
      if ((next <= 0 && v < 0) || (next >= max && v > 0)) { glide = 0; bounce(sc, axis, v); return; }
      if (Math.abs(v) < MIN_V) { glide = 0; return; }
      glide = requestAnimationFrame(step);
    }
    glide = requestAnimationFrame(step);
  }
  function velocity(samples, now, axis) { // px/ms of finger travel over the last ~80 ms
    var recent = samples.filter(function (s) { return now - s.t < 80; });
    if (recent.length < 2) return 0;
    var a = recent[0], z = recent[recent.length - 1];
    return z.t > a.t ? ((axis === "y" ? z.y - a.y : z.x - a.x) / (z.t - a.t)) : 0;
  }

  // ---- the mouse, taken from the app
  var MOUSE = ["mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "click", "dblclick", "auxclick",
    "contextmenu", "pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel",
    "gotpointercapture", "lostpointercapture", "dragstart", "selectstart"];
  var FIELD = "input, textarea, select, [contenteditable]:not([contenteditable=false])";
  function isMouse(e) {
    if (!e.isTrusted) return false;
    return e.pointerType == null || e.pointerType === "mouse" || e.pointerType === "";
  }
  MOUSE.forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (!isMouse(e)) return;
      e.stopImmediatePropagation();
      var field = e.target && e.target.closest && e.target.closest(FIELD);
      // a field keeps its native focus, caret and picker; nothing else selects text, and no native click runs (the
      // finger's own click does)
      if (/^(click|dblclick|auxclick|contextmenu|dragstart)$/.test(type) || (!field && /^(mousedown|selectstart)$/.test(type))) e.preventDefault();
      if (type === "pointerdown") down(e);
      else if (type === "pointermove") move(e);
      else if (type === "pointerup") up(e, false);
      else if (type === "pointercancel" || type === "lostpointercapture") { if (g && type === "pointercancel") up(e, true); }
    }, { capture: true, passive: false });
  });
  addEventListener("blur", function () { if (g) up(null, true); });

  function down(e) {
    if (e.button !== 0) return;
    if (g) up(null, true);
    var stopped = stopGlide();
    g = { target: e.target, capture: null, mouseId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, state: "down",
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }], noScroll: false, noClick: stopped, noMouse: false, sc: null, axis: null };
    try { realSet.call(doc.documentElement, e.pointerId); } catch (err) { /* moves outside the phone are lost, that's all */ }
    doc.documentElement.classList.add("concept-touching");
    // a press during a rubber band's way back catches it where it is
    bands.forEach(function (b, sc) { springBack(sc); });
    fire(g.target, "pointerover", true, { button: 0 });
    fire(g.target, "pointerenter", false, { button: 0 });
    g.noMouse = fire(g.target, "pointerdown", true, { button: 0 });
    if (!g) return;
    if (touch("touchstart", true)) { g.noScroll = true; g.noClick = true; }
    if (g && g.target.isConnected) activeOn(g.target);
  }

  function move(e) {
    if (!g) return; // hovering: a finger that isn't down isn't anywhere
    g.x = e.clientX; g.y = e.clientY;
    g.samples.push({ t: e.timeStamp, x: g.x, y: g.y });
    if (g.samples.length > 12) g.samples.shift();
    if (g.state === "down") {
      if (fire(g.capture || g.target, "pointermove", true)) { /* the app keeps the touch either way */ }
      if (!g) return;
      if (touch("touchmove", true)) g.noScroll = true;
      if (!g) return;
      var dx = g.x - g.x0, dy = g.y - g.y0;
      if (Math.hypot(dx, dy) <= SLOP || g.noScroll) return;
      var axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
      if (!panAllowed(g.target, axis)) return; // the app has this direction (edge swipe, row swipe)
      startPan(axis);
      return;
    }
    touch("touchmove", false); // a pan's moves still come to the page (iOS sends them too), not cancelable
    if (!g || g.state !== "pan") return;
    if (!canScroll(g.sc, g.axis)) { // the app took it (pull to refresh, the indicator's grab)
      band(g.sc, g.axis, 0);
      g.state = "taken";
      return;
    }
    var finger = g.axis === "y" ? g.y : g.x;
    var want = g.from - (finger - g.f0), max = range(g.sc, g.axis);
    var over = want < 0 ? want : want > max ? want - max : 0;
    setPos(g.sc, g.axis, Math.max(0, Math.min(max, want)));
    band(g.sc, g.axis, -rubber(over, dim(g.sc, g.axis)));
  }

  function startPan(axis) {
    var target = g.capture || g.target;
    fire(target, "pointercancel", false, { buttons: 0, pressure: 0 });
    fire(target, "pointerout", false, { buttons: 0, pressure: 0 });
    fire(target, "pointerleave", false, { buttons: 0, pressure: 0 });
    if (g.capture) { var c = g.capture; g.capture = null; fire(c, "lostpointercapture", false, { buttons: 0 }); }
    activeOff();
    g.noClick = true;
    g.axis = axis;
    g.sc = scrollerFor(g.target, axis);
    if (!g.sc) { g.state = "taken"; return; } // nothing scrolls that way: the drag just ends the press
    g.state = "pan";
    g.f0 = axis === "y" ? g.y : g.x;
    g.from = pos(g.sc, axis);
  }

  function up(e, cancelled) {
    var t = g;
    if (!t) return;
    if (e) { t.x = e.clientX; t.y = e.clientY; }
    try { realRelease.call(doc.documentElement, t.mouseId); } catch (err) { /* not held */ }
    doc.documentElement.classList.remove("concept-touching");
    activeOff();
    if (t.state === "down") {
      var target = t.capture || t.target;
      fire(target, cancelled ? "pointercancel" : "pointerup", !cancelled, { button: 0, buttons: 0, pressure: 0 });
      fire(target, "pointerout", false, { buttons: 0, pressure: 0 });
      fire(target, "pointerleave", false, { buttons: 0, pressure: 0 });
      if (t.capture) { var c = t.capture; t.capture = null; fire(c, "lostpointercapture", false, { buttons: 0 }); }
      var noClick = touch(cancelled ? "touchcancel" : "touchend", !cancelled) || t.noClick || cancelled;
      g = null;
      if (!noClick && t.target.isConnected) {
        if (!t.noMouse) {
          mouse(t.target, "mouseover", t.x, t.y);
          mouse(t.target, "mousemove", t.x, t.y);
          mouse(t.target, "mousedown", t.x, t.y);
          mouse(t.target, "mouseup", t.x, t.y);
        }
        if (t.target.isConnected) mouse(t.target, "click", t.x, t.y);
      }
      return;
    }
    touch("touchend", false);
    g = null;
    if (t.state !== "pan") return;
    if (bands.has(t.sc)) { springBack(t.sc); return; }
    var v = -velocity(t.samples, e ? e.timeStamp : performance.now(), t.axis);
    if (Math.abs(v) > 0.1) fling(t.sc, t.axis, v);
  }
})();
