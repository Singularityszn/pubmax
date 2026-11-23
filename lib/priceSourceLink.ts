import { isHttpUrl } from "@/lib/httpUrl";

/**
 * Who published a price, as the screen may show it (docs/VOICE.md). A valid
 * label links only when its URL is safe. A refused URL keeps the label as
 * plain text. "Publisher not recorded" is only for a price with no label.
 */
export type PriceSource =
  | { kind: "link"; label: string; href: string }
  | { kind: "refused"; label: string }
  | { kind: "missing" };

/**
 * The href a price publisher link may carry, or null. Only an absolute
 * http(s) URL with no credentials passes, so a record cannot run script, open
 * a data document, or dress another host as the publisher.
 */
/** What a refused publisher link says beside its label (docs/VOICE.md). */
export const LINK_UNAVAILABLE = "Link unavailable.";

export function safePriceSourceHref(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!isHttpUrl(trimmed)) return null;
  const parsed = new URL(trimmed);
  return parsed.username || parsed.password ? null : trimmed;
}

export function priceSourceOf(label: string | null | undefined, url: unknown): PriceSource {
  const name = typeof label === "string" ? label.trim() : "";
  if (!name) return { kind: "missing" };
  const href = safePriceSourceHref(url);
  return href ? { kind: "link", label: name, href } : { kind: "refused", label: name };
}
