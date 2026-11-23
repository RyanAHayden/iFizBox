// F181: the package page as the iOS 6 App Store's (journal/F181/concept/TweakDetails.dc.html, TweakReviews.dc.html),
// for APT packages (screens/browse.js renderPackage) and AltStore apps (screens/altstore.js renderApp) alike.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   storeHeader({ art, name, author, authorHref, line, mark, action })  -> { head, setRating(r), setLine(text), setAuthor(name, href) }
//     The band at the top: the large glossy icon with its reflection, the name, the author, a stars row (F206: there
//     from the first paint as grey empty stars, filled in place by setRating, "No Ratings" with none) and "Version 2.1.3 · 412 kB · Free". No install button: Install / Modify stays the
//     nav bar's right button (user 2026-11-18: "keep the install / modify button in the top right"). `action`: an
//     element for the header's right edge, where the App Store's install button sat (F194: an app page's Share).
//   headerLine({ version, size, price })   -> "Version 2.1.3 · 412 kB · Free"
//   storeTabs({ details, reviews, related }) -> { control, panes: { details, reviews, related }, select(i), swipeOn(body), nodes }
//     The Details / Reviews / Related segmented control (ios6.css .store-segmented) over three panes. Details is
//     filled by the caller at once; reviews(pane) and related(pane) run the first time their tab is chosen or a swipe
//     begins to show it. swipeOn(body), once `nodes` are in the page: swipes and taps slide the panes (F390, nav/tabswipe.js).
//   tileRow({ rating })                    -> { row, set(key, tile | null) }  the sideways info tiles, in TILE_ORDER
//     (F206: starts with the Rating tile's placeholder, pendingRatingTile(), unless rating: false)
//   worksOnTile(fit)                       -> { label, value, sub, ok }  compat()'s verdict as the Works On tile
//   ratingTile(r), sizeTile(text, price), sectionTile(name, sub), updatedTile(date, now)
//   ratingsCard(r, { reviews, selected, onPick, pending }) -> the Reviews tab's ratings card: the average beside
//     five tappable bars (F206: r.histogram, else the written `reviews` counted), .select(stars), .table, .rows
//     B82: { build: true } is an app page's This Build card (no header, ours alone, "Rated by people using this build.")
//   appStoreCard(r, { name, seller })      -> B82: the App Store view's card: big average, stars, count, no bars, and
//     "For <name> by <seller> on the App Store, not this build."
//   reviewsGroup(reviews, renderText)    -> the review cells: title, stars, "by name – Version – date", text
//   storeStars(rating, cls)                -> five stars filled to the rating (the App Store's orange)
//
// A rating r: { average (0-5), count, noun: "Ratings" | "Reviews", histogram?: [n5, n4, n3, n2, n1], from }.
// Everything moves by transform/opacity only (120 Hz).
import { el, grouped, segmented } from "../nav/ui.js";
import { tabPager } from "../nav/tabswipe.js";
import { starCounts } from "../core/reviews.js";

export const TAB_LABELS = ["Details", "Reviews", "Related"];
export const TILE_ORDER = ["rating", "works", "size", "section", "updated"];

// ---- the header ------------------------------------------------------------------------------------------------

export function headerLine({ version = null, size = null, price = null } = {}) {
  return [version ? `Version ${version}` : null, size, price].filter(Boolean).join(" · ");
}

// A rating worth drawing: an average in 0-5 (a count alone is not one).
export const hasRating = (r) => r != null && Number.isFinite(Number(r.average)) && r.average !== null;

export function storeStars(rating, cls = "") {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const s = el("span", `store-stars${cls ? ` ${cls}` : ""}`);
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", `${Math.round(r * 10) / 10} out of 5 stars`);
  const fill = el("span", "store-stars-fill");
  fill.style.width = `${(r / 5) * 100}%`;
  s.append(fill);
  return s;
}

export function storeHeader({ art, name, author = null, authorHref = null, line = "", mark = null, action = null }) {
  const head = el("div", "store-head");
  const icon = el("div", "store-icon");
  if (art) icon.append(art);
  icon.append(el("span", "store-icon-gloss"));
  const text = el("div", "store-head-text");
  const top = el("span", "store-head-top");
  top.append(el("span", "store-head-name", name));
  if (mark) top.append(mark);
  text.append(top);
  let authorEl = null;
  const setAuthor = (name, href = null) => {
    if (!name) return;
    const a = el(href ? "a" : "span", "store-head-author", name);
    if (href) a.href = href;
    if (authorEl) authorEl.replaceWith(a); else top.after(a);
    authorEl = a;
  };
  setAuthor(author, authorHref);
  // F206: the stars row is there from the first paint (grey empty stars while the reviews load) and filled in place,
  // so the page under it never moves; no rating at all says "No Ratings" rather than taking the row away.
  const rating = el("span", "store-head-rating");
  rating.dataset.state = "pending";
  rating.append(storeStars(0));
  const lineEl = el("span", "store-head-line", line);
  text.append(rating, lineEl);
  head.append(icon, text);
  if (action) head.append(action);
  return {
    head,
    // The concept's "(212)" only when there is one to count.
    setRating(r) {
      if (!hasRating(r)) {
        rating.dataset.state = "none";
        rating.replaceChildren(storeStars(0), el("span", "store-head-count", "No Ratings"));
        return;
      }
      rating.dataset.state = "rated";
      // B82: the App Store's, shown only when nobody rated this build here, says whose it is.
      const count = r.count ? `(${Number(r.count).toLocaleString("en-US")})` : null;
      const label = r.onAppStore ? [count, "on the App Store"].filter(Boolean).join(" ") : count;
      rating.dataset.from = r.onAppStore ? "appstore" : "build";
      rating.replaceChildren(storeStars(r.average), ...(label ? [el("span", "store-head-count", label)] : []));
    },
    setLine(t) { lineEl.textContent = t; },
    setAuthor,
  };
}

// ---- the segmented control and its panes ---------------------------------------------------------------------

// nav/ui.js segmented(): the one grey segmented control; re-exported for older importers.
export { segmented };

export function storeTabs({ reviews = null, related = null } = {}) {
  const panes = { details: el("div", "store-pane store-details"), reviews: el("div", "store-pane store-reviews"),
    related: el("div", "store-pane store-related") };
  const keys = ["details", "reviews", "related"];
  const fill = { reviews, related };
  const filled = new Set(["details"]);
  const fillPane = (i) => {
    const k = keys[i];
    if (filled.has(k)) return;
    filled.add(k);
    try { Promise.resolve(fill[k]?.(panes[k])).catch(() => {}); } catch { /* a pane that fails stays empty */ }
  };
  const control = segmented(TAB_LABELS, { onSelect: (i) => pager.select(i) });
  const pager = tabPager({ panes: keys.map((k) => panes[k]), mark: control.mark, fill: fillPane });
  pager.select(0);
  return { control: control.bar, buttons: control.buttons, panes, select: pager.select, selected: () => keys[pager.selected()],
    swipeOn: pager.attach, nodes: [control.bar, panes.details, panes.reviews, panes.related] };
}

// ---- the info tiles --------------------------------------------------------------------------------------------

function tile({ label, value, sub = null, ok = null, stars = null, pending = false }) {
  const t = el("div", "store-tile");
  if (pending) t.dataset.pending = "true";
  t.append(el("span", "store-tile-label", label), el("span", "store-tile-value", value ?? "—"));
  if (stars != null) t.append(storeStars(stars, "small"));
  else if (sub) {
    const s = el("span", "store-tile-sub", sub);
    if (ok != null) s.dataset.ok = String(ok);
    t.append(s);
  }
  t.dataset.label = label;
  return t;
}

// F206: the Rating tile holds its place from the first paint (a dash over grey empty stars) and is filled in place
// when the reviews arrive, so the other tiles never shift sideways. `{ rating: false }` for a row without one.
export function tileRow({ rating = true } = {}) {
  const row = el("div", "store-tiles");
  const tiles = new Map();
  const api = {
    row,
    tiles,
    set(key, data) {
      tiles.get(key)?.remove();
      tiles.delete(key);
      row.dataset.count = String(tiles.size);
      if (!data) return;
      const t = tile(data);
      t.dataset.key = key;
      const after = TILE_ORDER.slice(TILE_ORDER.indexOf(key) + 1).map((k) => tiles.get(k)).find(Boolean);
      if (after) after.before(t); else row.append(t);
      tiles.set(key, t);
      row.dataset.count = String(tiles.size);
    },
  };
  if (rating) api.set("rating", pendingRatingTile());
  return api;
}

// "iOS 15.0 or later" -> "iOS 15+"; "iOS 14.0 – 16.2" -> "iOS 14–16.2"; "iOS 15 to below 17" -> "iOS 15–16"
export function shortRange(range) {
  const s = String(range ?? "");
  const tidy = (v) => v.replace(/\.0$/, "");
  let m = s.match(/^iOS ([\d.]+) or later$/);
  if (m) return `iOS ${tidy(m[1])}+`;
  m = s.match(/^iOS ([\d.]+) – ([\d.x]+)$/);
  if (m) return `iOS ${tidy(m[1])}–${tidy(m[2])}`;
  m = s.match(/^iOS ([\d.]+) to below ([\d.]+)$/);
  if (m) {
    const hi = tidy(m[2]);
    return /^\d+$/.test(hi) ? `iOS ${tidy(m[1])}–${Number(hi) - 1}` : `iOS ${tidy(m[1])}–<${hi}`;
  }
  m = s.match(/^iOS below ([\d.]+)$/);
  if (m) return `iOS <${tidy(m[1])}`;
  m = s.match(/^iOS ([\d.]+) or earlier$/);
  if (m) return `≤ iOS ${tidy(m[1])}`;
  m = s.match(/^iOS ([\d.]+)$/);
  if (m) return `iOS ${tidy(m[1])}`;
  return null;
}

const NEEDS = { rootless: "Rootless", rootful: "Rootful", roothide: "Roothide" };

// compat()'s verdict (core/compat.js) as the Works On tile: the iOS range it states (else the jailbreak it's built for,
// else "Any iOS"), and under it whether this iPhone can run it: a check, a cross, or a question.
export function worksOnTile(fit) {
  const value = shortRange(fit?.range) ?? NEEDS[fit?.need] ?? (fit?.need === "any" || !fit?.need ? "Any iOS" : fit.need);
  if (fit?.status === "works") return { label: "Works On", value, sub: "Your iPhone ✓", ok: true };
  // B184: a deb on a phone without a jailbreak: say so, never beside its iOS range as if the version were wrong.
  if (fit?.status === "no" && fit.reason === "jailbreak") return { label: "Works On", value, sub: "Needs Jailbreak ✗", ok: false };
  if (fit?.status === "no") return { label: "Works On", value, sub: "Not Your iPhone ✗", ok: false };
  if (fit?.status === "unchecked") return { label: "Works On", value, sub: "Not Checked", ok: null };
  return { label: "Works On", value, sub: "Unknown", ok: null };
}

// F206: never null: no rating is "—" with "No Ratings" under it, so the tile stays and nothing moves.
export function ratingTile(r) {
  if (!hasRating(r)) return { label: "Rating", value: "—", sub: "No Ratings" };
  // B82: the App Store's (nobody rated this build here yet): the tile names it rather than drawing it as ours.
  if (r.onAppStore) return { label: "Rating", value: (Math.round(r.average * 10) / 10).toFixed(1), sub: "App Store" };
  return { label: "Rating", value: (Math.round(r.average * 10) / 10).toFixed(1), stars: r.average };
}
// F206: the placeholder while the reviews load: a dash over grey empty stars (the filled tile's shape).
export const pendingRatingTile = () => ({ label: "Rating", value: "—", stars: 0, pending: true });

// F195: the unit stays in the value ("48 kB"); under it the price ("Free"), or nothing.
export function sizeTile(text, price = null) {
  if (!text) return null;
  return { label: "Size", value: String(text), sub: price || null };
}

export function sectionTile(name, sub = null) {
  return name ? { label: "Section", value: name, sub } : null;
}

const DAY = 86400000;
export function updatedTile(date, now = Date.now(), locale = "en-US") {
  const t = date ? new Date(date).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / DAY));
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  const value = new Date(t).toLocaleDateString(locale, sameYear ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
  const sub = days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 60 ? `${days} days ago` : days < 730 ? `${Math.round(days / 30)} months ago` : `${Math.round(days / 365)} years ago`;
  return { label: "Updated", value, sub };
}

// ---- the Reviews tab -------------------------------------------------------------------------------------------

// F206: the hint under the ratings card, by what the list shows.
export const barsHint = (stars) => (stars ? `Showing ${stars}-star reviews. Tap the row again for all.` : "Tap a row to see only those reviews.");

const validHistogram = (h) => (Array.isArray(h) && h.length === 5 && h.every((n) => Number(n) >= 0) ? h.map(Number) : null);

// F206: the card always draws the five bars beside the average, iOS 6 style: each row five small stars (the rating's
// dark, the rest light grey), the grey bar, the count in bold and a chevron. The bars are the source's histogram, else
// the written reviews we have counted (`reviews`), and the line under the card says how many they come from. Each row
// is a button: onPick(stars) when tapped (the Reviews tab filters its list); card.select(stars | null) marks one.
// `pending`: the skeleton drawn while the reviews load, the same shape (so filling it moves nothing).
// No rating keeps the card, saying "No Ratings".
// B82: `build`: an app page's This Build card: no group header (the This Build / App Store toggle names it), ours alone,
// and its line "Rated by people using this build. Bars from N ratings." or, with none, "Nobody has rated this build
// yet. Be the first." (the card and its empty bars stay).
export function ratingsCard(r, { reviews = null, selected = null, onPick = null, pending = false, build = false } = {}) {
  const g = el("div", "group store-ratings-group");
  if (build) g.dataset.build = "true";
  else g.append(el("h2", "group-header", "Ratings"));
  const card = el("div", "table grouped store-ratings");
  if (pending) card.dataset.pending = "true";
  const rated = !pending && hasRating(r);
  const top = el("div", "store-ratings-top");
  const avg = el("div", "store-ratings-avg");
  avg.append(el("span", "store-ratings-big", rated ? (Math.round(r.average * 10) / 10).toFixed(1) : "—"), storeStars(rated ? r.average : 0));
  const noun = r?.noun ?? "Ratings";
  const countText = pending ? " " : rated ? (r.count ? `${Number(r.count).toLocaleString("en-US")} ${r.count === 1 ? noun.replace(/s$/, "") : noun}` : " ")
    : r?.count ? `${r.count} ${r.noun ?? "Reviews"}, none rated` : "No Ratings";
  avg.append(el("span", "store-ratings-count", countText));
  top.append(avg);

  const given = pending ? null : validHistogram(r?.histogram);
  const h = given ?? (pending || !reviews ? [0, 0, 0, 0, 0] : starCounts(reviews));
  const total = h.reduce((a, b) => a + b, 0);
  const most = Math.max(1, ...h);
  const bars = el("div", "store-bars");
  bars.setAttribute("role", "group");
  bars.setAttribute("aria-label", "Ratings by stars");
  const rows = h.map((n, i) => {
    const stars = 5 - i;
    const row = el("button", "store-bar");
    row.type = "button";
    row.dataset.stars = String(stars);
    row.setAttribute("aria-label", `${stars} star${stars === 1 ? "" : "s"}: ${n}`);
    if (pending || !onPick) row.disabled = true;
    const st = el("span", "store-bar-stars");
    for (let k = 1; k <= 5; k++) st.append(el("span", k <= stars ? "store-bar-star on" : "store-bar-star", "★"));
    const track = el("span", "store-bar-track");
    const fill = el("span", "store-bar-fill");
    // transform, not width: the bar is drawn once at full width and scaled (120 Hz rule; no layout).
    fill.style.transform = `scaleX(${n / most})`;
    track.append(fill);
    row.append(st, track, el("b", "store-bar-n", pending ? "" : String(n)), el("span", "store-bar-chevron"));
    if (onPick && !pending) row.addEventListener("click", () => onPick(stars));
    bars.append(row);
    return row;
  });
  top.append(bars);
  card.append(top);

  const plural = (n, one) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;
  const source = pending ? "Loading Reviews…"
    : given ? `Bars from ${plural(total, "rating")}.`
    : total ? `Bars from ${plural(total, "review")}.` : "No reviews to count yet.";
  const lead = rated && r.from ? String(r.from).replace(/([^.!?])$/, "$1.") : null;
  const line = !build || pending ? [lead, source].filter(Boolean).join(" ")
    : rated || total ? `Rated by people using this build. Bars from ${plural(total, "rating")}.`
    : "Nobody has rated this build yet. Be the first.";
  card.append(el("div", "store-ratings-from", line));
  g.append(card);

  const hint = onPick && !pending ? el("p", "group-footer store-ratings-hint", barsHint(null)) : null;
  if (hint) g.append(hint);
  g.select = (stars) => {
    rows.forEach((row) => {
      const on = Number(row.dataset.stars) === stars;
      row.classList.toggle("selected", on);
      row.setAttribute("aria-pressed", String(on));
    });
    if (hint) hint.textContent = barsHint(stars);
  };
  g.select(selected);
  g.table = card;
  g.rows = rows;
  return g;
}

// B82: the App Store view's one grouped card: the average big beside its stars and "50,123,456 Ratings" (no bars:
// Apple gives no per-star counts), and a note row saying whose rating it is. r: { average, count } or null.
export function appStoreCard(r, { name = null, seller = null } = {}) {
  const g = el("div", "group store-appstore-group");
  const card = el("div", "table grouped store-appstore");
  const rated = hasRating(r) && Number(r.average) > 0;
  const top = el("div", "store-appstore-top");
  top.append(el("span", "store-appstore-big", rated ? (Math.round(r.average * 10) / 10).toFixed(1) : "—"));
  const side = el("span", "store-appstore-side");
  const n = Number(r?.count) || 0;
  side.append(storeStars(rated ? r.average : 0), el("span", "store-appstore-count",
    !rated ? "No Ratings" : n ? `${n.toLocaleString("en-US")} ${n === 1 ? "Rating" : "Ratings"}` : "Ratings"));
  top.append(side);
  const what = name ? `${name}${seller ? ` by ${seller}` : ""}` : "the original app";
  card.append(top, el("div", "store-ratings-from store-appstore-note", `For ${what} on the App Store, not this build.`));
  g.append(card);
  g.table = card;
  return g;
}

// review: { title, author, rating, version?, date?, text, response? }; renderText(review) -> the body element.
export function reviewCell(rv, i, renderText = (x) => el("div", "store-review-text", x.text)) {
  const c = el("div", "store-review");
  const head = el("div", "store-review-head");
  head.append(el("span", "store-review-title", `${i + 1}. ${rv.title || "Review"}`));
  if (rv.rating != null) head.append(storeStars(rv.rating, "small"));
  c.append(head);
  const by = [rv.author ? `by ${rv.author}` : null, rv.version ? `Version ${rv.version}` : null, rv.date ?? null].filter(Boolean).join(" – ");
  if (by) c.append(el("span", "store-review-by", by));
  if (rv.text) c.append(renderText(rv));
  if (rv.response) {
    const resp = el("div", "store-review-response");
    resp.append(el("b", null, "Developer Response"), ` – ${rv.response}`);
    c.append(resp);
  }
  return c;
}

export function reviewsGroup(reviews, renderText) {
  const g = el("div", "group store-reviews-group");
  g.append(el("h2", "group-header", "Reviews"));
  const card = el("div", "table grouped store-review-list");
  reviews.forEach((rv, i) => card.append(reviewCell(rv, i, renderText)));
  g.append(card);
  return g;
}

// ---- What's New ------------------------------------------------------------------------------------------------

// The What's New card: "What's New in 2.1.3" with the date on the right, the notes, and Version under them
// in the same card. `history`: a row ({ label, href }) or null.
export function whatsNewGroup({ version = null, date = null, notes = null, history = null } = {}) {
  if (!notes && !history) return null;
  const g = el("div", "group store-whatsnew");
  if (notes) {
    const h = el("h2", "group-header store-whatsnew-head");
    h.append(el("span", null, version ? `What’s New in ${version}` : "What’s New"));
    if (date) h.append(el("span", "store-whatsnew-date", date));
    g.append(h);
  }
  const rows = history ? grouped([{ rows: [history] }]).firstElementChild.querySelector("ul") : el("ul", "table grouped");
  if (notes) {
    const li = el("li", "cell store-whatsnew-cell");
    li.append(el("div", "pkg-description store-whatsnew-text", notes));
    rows.prepend(li);
  }
  g.append(rows);
  return g;
}
