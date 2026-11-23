// F166: iOS 6's UIActivityIndicatorView, redrawn from the 4S's UIKit frames (ref/4s/artwork/Shared@2x/
// UIActivityIndicatorViewStyle{White,Gray,WhiteLarge}.N.png, measured in journal/2026-11-18-f166-spinners/).
// 12 rounded spokes in one flat colour; frame 0 has its brightest spoke at 9 o'clock and five dimmer ones behind it
// (8 o'clock round to 4), the other six at the floor alpha. Every next frame is frame 0 turned 30 degrees clockwise,
// so one image turned a spoke at a time (ios6.css @keyframes hud-spin) is the whole animation.
// ios6.css holds these images as data URLs (--spinner-white, --spinner-gray, --spinner-large); spinner.test.js checks
// that they are the same as spinnerURL() here, so change both together. The app never loads this file: the spinners
// it shows are those tokens, and an era draws its own by setting them in its stylesheet (docs/eras.md, Overlays).

// Alphas (of 255) by spoke, spoke k pointing k * 30 degrees clockwise from 12 o'clock, as sampled from frame 0.
const WHITE_ALPHA = [69, 69, 69, 69, 94, 118, 143, 168, 192, 217, 69, 69];
const GRAY_ALPHA = [31, 31, 31, 31, 42, 53, 64, 75, 86, 98, 31, 31];

// size: the view box in points; r1-r2: where the spoke's centre line runs (the round caps add width/2 each end).
export const SPINNERS = {
  white: { size: 20, color: "#fff", width: 2, r1: 6, r2: 9, alpha: WHITE_ALPHA }, // UIActivityIndicatorViewStyleWhite
  gray: { size: 20, color: "#000", width: 2, r1: 6, r2: 9, alpha: GRAY_ALPHA }, // UIActivityIndicatorViewStyleGray
  large: { size: 37, color: "#fff", width: 3, r1: 10, r2: 16, alpha: WHITE_ALPHA }, // ...StyleWhiteLarge
};

// F381: the later eras' UIActivityIndicatorViews (measurements: journal/2026-11-23-f381-era-spinners/).
// iOS 7-12: still 12 round spokes, a little thinner and shorter than iOS 6's, and the tail fades smoothly all the way
// round (no flat floor): the brightest at 9 o'clock as iOS 6's, each spoke behind it (counter-clockwise) dimmer by the
// same step down to the floor. Alphas are fractions of 1 from here on.
const fade = (n, head, top, floor) => Array.from({ length: n }, (_, k) => {
  const behind = (head - k + n) % n; // spokes counter-clockwise from the brightest
  return top - behind * (top - floor) / (n - 1);
});
const I7_ALPHA = fade(12, 9, 1, 0.27);
// iOS 13-26: 8 spokes, thicker, rounder and further out, from Apple's iOS 27 UI Kit (Progress Indicators >
// Indeterminate Spinner, Regular 20 pt and Large 35 pt): the brightest at 12 o'clock and seven behind it 0.12 dimmer
// each. The colour is secondaryLabel (#3c3c43 at 60% light, #ebebf5 at 60% dark), the kit's fill.
const I13_ALPHA = [1, 0.15, 0.27, 0.39, 0.51, 0.63, 0.75, 0.87];

// Each era's styles: spokes (count, default 12), shape "rect" for rounded rectangles of corner radius rx (else a
// line with round caps), opacity (the whole image's, default 1). Large in iOS 13+ is 35 pt, drawn centred in the
// 37 pt box the HUD lays out.
export const ERA_SPINNERS = {
  ios6: SPINNERS,
  ios7: {
    white: { size: 20, color: "#fff", width: 1.75, r1: 5.5, r2: 8.5, alpha: I7_ALPHA }, // r 4.6..9.4
    gray: { size: 20, color: "#8e8e93", width: 1.75, r1: 5.5, r2: 8.5, alpha: I7_ALPHA },
    large: { size: 37, color: "#fff", width: 2.75, r1: 10, r2: 15.5, alpha: I7_ALPHA }, // r 8.6..16.9
  },
  ios13: {
    // the kit's 2.67 x 6.67 pt spokes (corner 1.5, so fully round) from r 3.33 to 10
    white: { size: 20, spokes: 8, color: "#fff", width: 2.67, r1: 4.665, r2: 8.665, alpha: I13_ALPHA },
    gray: { size: 20, spokes: 8, color: "#3c3c43", opacity: 0.6, width: 2.67, r1: 4.665, r2: 8.665, alpha: I13_ALPHA },
    grayDark: { size: 20, spokes: 8, color: "#ebebf5", opacity: 0.6, width: 2.67, r1: 4.665, r2: 8.665, alpha: I13_ALPHA },
    // the kit's 5 x 13 pt spokes, corner 2 (not quite round), from r 4.5 to 17.5
    large: { size: 37, spokes: 8, shape: "rect", rx: 2, color: "#fff", width: 5, r1: 4.5, r2: 17.5, alpha: I13_ALPHA },
  },
};
ERA_SPINNERS.ios26 = ERA_SPINNERS.ios13; // iOS 26 kept iOS 13's indicator

const num = (n) => String(Math.round(n * 1000) / 1000);

// The spinner as a standalone SVG document. iOS 6's alphas are of 255, the later eras' of 1.
export function spinnerSVG(kind, era = "ios6") {
  const s = ERA_SPINNERS[era]?.[kind];
  if (!s) throw new Error(`no spinner style ${kind} in ${era}`);
  const n = s.spokes ?? 12, step = 360 / n, c = num(s.size / 2), scale = era === "ios6" ? 255 : 1;
  const spokes = s.alpha.map((a, k) => {
    const turn = (k ? ` transform='rotate(${num(k * step)} ${c} ${c})'` : "") + ` opacity='${num(a / scale)}'/>`;
    if (s.shape === "rect") {
      return `<rect x='${num(s.size / 2 - s.width / 2)}' y='${num(s.size / 2 - s.r2)}' width='${num(s.width)}'`
        + ` height='${num(s.r2 - s.r1)}' rx='${num(s.rx)}'${turn}`;
    }
    return `<line x1='${c}' y1='${num(s.size / 2 - s.r2)}' x2='${c}' y2='${num(s.size / 2 - s.r1)}'${turn}`;
  }).join("");
  const group = s.shape === "rect" ? `<g fill='${s.color}'` : `<g stroke='${s.color}' stroke-width='${num(s.width)}' stroke-linecap='round'`;
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${s.size} ${s.size}'>`
    + `${group}${s.opacity != null ? ` opacity='${num(s.opacity)}'` : ""}>${spokes}</g></svg>`;
}

// The same as a CSS url() value.
export function spinnerURL(kind, era = "ios6") {
  return `url("data:image/svg+xml,${spinnerSVG(kind, era).replace(/[<>#"]/g, encodeURIComponent)}")`;
}
