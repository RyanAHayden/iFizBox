// F464: the Donate page (#/home/donate), opened from Home and from Credits: the Ko-fi link, then what it took to build
// the app (core/devstats.js, written by tools/dev_stats.py).
import { KOFI_URL, NAME } from "../brand.js";
import { DEV_STATS } from "../core/devstats.js";
import { format } from "../router.js";

export const DONATE_ROW = { label: "Donate", href: format({ tab: "home", path: ["donate"] }) };
export const DONATE_FOOTER = `${NAME} is free, with no paid features. If it helps you, you can support its work on Ko-fi.`;

export const count = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} million`
  : n.toLocaleString("en-US"));
// "2026-11-17" -> "17 Nov 2026" (UTC, so no time zone moves the day)
export const day = (iso) => new Date(`${iso}T00:00:00Z`)
  .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function donateSections(stats = DEV_STATS) {
  return [
    { rows: [{ label: "Chip in on Ko-fi", chevron: true, onClick: () => window.open(KOFI_URL, "_blank", "noopener") }],
      footer: DONATE_FOOTER },
    { header: "What It Took So Far",
      rows: [["Prompts", stats.prompts], ["Tokens", stats.tokens], ["Sessions", stats.sessions], ["Commits", stats.commits]]
        .map(([label, n]) => ({ label, detail: count(n) })),
      footer: `Since ${day(stats.since)}, counted ${day(stats.updated)}.` },
  ];
}
