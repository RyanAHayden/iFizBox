// F450: ranking by the stars given here: a list's Rating sort (the Filter panel's Sort > Rating, catalog.refine's
// "rating") and Popular's order (core/catalog.js rankPopular). Pure JS.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   `ratings`: { <package id>: [average, count] } (the review server's GET /reviews, core/reviews.js
//     reviewsApi().ratings()).
//   ratingOf(ratings, id)    -> { avg, count } | null (unrated, or not a rating)
//   compareRatings(x, y)     -> rated before unrated, the highest average first, then the most ratings; 0 between two
//     unrated or two equal
//   rankByRating(rows, ratings) -> rows, a new array: by compareRatings, then by name (so unrated last, by name)
import { compareNames } from "./sections.js";

export function ratingOf(ratings, id) {
  // hasOwnProperty, not Object.hasOwn: that needs iOS 15.4 and the app runs on 15.0
  const v = ratings && Object.prototype.hasOwnProperty.call(ratings, id) ? ratings[id] : null;
  const avg = Array.isArray(v) ? Number(v[0]) : NaN;
  return Number.isFinite(avg) && avg > 0 ? { avg, count: Number(v[1]) || 0 } : null;
}

export function compareRatings(x, y) {
  if (x && y) return y.avg - x.avg || y.count - x.count;
  return x ? -1 : y ? 1 : 0;
}

export function rankByRating(rows, ratings = {}) {
  const at = new Map(rows.map((r) => [r, ratingOf(ratings, r.id)]));
  return [...rows].sort((a, b) => compareRatings(at.get(a), at.get(b)) || compareNames(a, b));
}
