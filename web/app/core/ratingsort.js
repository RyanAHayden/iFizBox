// F450: ranking by the stars given here: a list's Rating sort (the Filter panel's Sort > Rating, catalog.refine's
// "rating"; catalog.js loads this only then). Popular's order (core/catalog.js rankPopular) uses the same compare.
// Pure JS.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   `ratings`: { <package id>: [average, count] } (the review server's GET /reviews, core/reviews.js
//     reviewsApi().ratings()).
//   ratingOf(ratings, id)    -> { avg, count } | null (unrated, or not a rating)        (core/sections.js)
//   compareRatings(x, y)     -> rated before unrated, the highest average first, then the most ratings (core/sections.js)
//   rankByRating(rows, ratings) -> rows, a new array: by compareRatings, then by name (so unrated last, by name)
import { compareNames, ratingOf, compareRatings } from "./sections.js";

export { ratingOf, compareRatings };

export function rankByRating(rows, ratings = {}) {
  const at = new Map(rows.map((r) => [r, ratingOf(ratings, r.id)]));
  return [...rows].sort((a, b) => compareRatings(at.get(a), at.get(b)) || compareNames(a, b));
}
