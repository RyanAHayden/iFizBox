// The virtual clock (capture.mjs puts this in the page before any of the app runs). A classic script.
//
// Nothing in the page moves by itself: Date, performance.now, timers, requestAnimationFrame, event time stamps and
// every CSS transition, CSS animation and Web Animation stand still until capture.mjs calls
// __clock.tick(ms). One tick is one frame of the recording, so a slow screenshot never drops or stretches a frame.
// Promises, workers, IndexedDB and the fake bridge's answers still run in real time, between ticks.
(() => {
  const RealDate = Date;
  const real = { raf: window.requestAnimationFrame.bind(window), setTimeout: window.setTimeout.bind(window) };
  const epoch = RealDate.now();
  let now = 0, next = 1;
  const timers = new Map(); // id -> { at, f, args, every, seq }
  const frames = new Map(); // id -> f
  const wall = () => epoch + Math.round(now);

  window.Date = class Date extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(wall()); }
    static now() { return wall(); }
  };
  performance.now = () => now;
  Object.defineProperty(Event.prototype, "timeStamp", { configurable: true, get: () => now });

  const add = (f, ms, args, every) => {
    const id = next++;
    timers.set(id, { at: now + Math.max(every ? 4 : 0, Number(ms) || 0), f, args, every, seq: id });
    return id;
  };
  window.setTimeout = (f, ms, ...args) => add(f, ms, args, 0);
  window.setInterval = (f, ms, ...args) => add(f, ms, args, Math.max(4, Number(ms) || 0));
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (f) => { const id = next++; frames.set(id, f); return id; };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };
  window.requestIdleCallback = (f) => add(() => f({ didTimeout: false, timeRemaining: () => 20 }), 1, [], 0);
  window.cancelIdleCallback = window.clearTimeout;
  const run = (f, args) => { try { typeof f === "function" ? f(...args) : (0, eval)(String(f)); } catch (e) { console.error(e); } };

  // the page's animations, held at the clock's time
  const held = new WeakMap(); // Animation -> its time as of the last tick
  function hold(dt) {
    for (const a of document.getAnimations()) {
      if (a.timeline !== document.timeline) continue;
      if (a.playState === "finished" || a.playState === "idle") continue;
      if (!held.has(a)) {
        // one the page itself keeps paused (touch.js's rubber band) is its own
        if (a.playState === "paused") continue;
        a.pause();
        a.currentTime = 0;
        held.set(a, 0);
        continue;
      }
      if (a.playState === "running") a.pause();
      const t = held.get(a) + dt * (a.playbackRate || 1);
      held.set(a, t);
      const end = a.effect?.getComputedTiming().endTime ?? Infinity;
      if (t >= end) { held.delete(a); try { a.finish(); } catch {} } else a.currentTime = t;
    }
  }
  const painted = () => new Promise((r) => real.raf(() => real.setTimeout(r, 0)));

  window.__clock = {
    now: () => now,
    hold: () => hold(0),
    async tick(dt) {
      const to = now + dt;
      for (let n = 0; n < 5000; n++) {
        let first = null, fid = 0;
        for (const [id, t] of timers) if (t.at <= to && (!first || t.at < first.at || (t.at === first.at && t.seq < first.seq))) { first = t; fid = id; }
        if (!first) break;
        now = Math.max(now, first.at);
        if (first.every) { first.at = now + first.every; first.seq = next++; } else timers.delete(fid);
        run(first.f, first.args);
        await null;
      }
      now = to;
      hold(dt);
      const due = [...frames.values()];
      frames.clear();
      for (const f of due) run(f, [now]);
      await painted(); // observers run in the real frame; what they start is held before the screenshot
      hold(0);
    },
    // off the record: n frames' worth of time, quickly
    async skip(ms) { for (let t = 0; t < ms; t += 33) await this.tick(33); },
  };
})();
