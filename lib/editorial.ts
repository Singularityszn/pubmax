// Editorial overlay policy: what a stored pick is, what the rail may say,
// and how a failed read differs from a quiet week. The XML parse and the
// allowlist live in lib/editorialRss.mjs so the Node poller can share them.

import {
  EDITORIAL_ITEM_KEYS as RSS_ITEM_KEYS,
  dedupeEditorialItems,
  licenceForSource,
  storedEditorialItem,
  type EditorialItem,
} from "@/lib/editorialRss.mjs";

export const EDITORIAL_RAIL_TITLE = "Also picked this week";
export const EDITORIAL_EMPTY_LINE = "No picks this week.";
export const EDITORIAL_DEGRADED_LINE = "Some picks could not be checked.";
export const EDITORIAL_DEGRADED_EMPTY_LINE = "Picks could not be checked.";
export const EDITORIAL_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const EDITORIAL_RAIL_LIMIT = 12;
export const EDITORIAL_ITEM_KEYS = RSS_ITEM_KEYS;

export type { EditorialItem };

export type EditorialSnapshot = {
  version: 1;
  generatedAt: string;
  status: "ready" | "degraded";
  items: EditorialItem[];
};

export function editorialViaChip(label: string): string {
  return `via ${label}`;
}

export function editorialOglMark(licence: string): "OGL" | null {
  return licence === "ogl" ? "OGL" : null;
}

export function editorialOglMarkForSource(sourceId: string): "OGL" | null {
  return editorialOglMark(licenceForSource(sourceId));
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readItem(value: unknown): EditorialItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.source_id !== "string" || row.source_id.trim().length === 0) return null;
  if (typeof row.title !== "string" || row.title.trim().length === 0) return null;
  if (!isHttpUrl(row.canonical_url)) return null;
  if (!isIso(row.published_at)) return null;
  if (typeof row.excerpt !== "string") return null;
  if (typeof row.attribution_label !== "string" || row.attribution_label.trim().length === 0) {
    return null;
  }
  return storedEditorialItem({
    source_id: row.source_id,
    title: row.title,
    canonical_url: row.canonical_url,
    published_at: new Date(Date.parse(row.published_at)).toISOString(),
    excerpt: row.excerpt.slice(0, 240),
    attribution_label: row.attribution_label,
  });
}

export function parseEditorialSnapshot(raw: unknown): EditorialSnapshot {
  if (!raw || typeof raw !== "object") {
    return { version: 1, generatedAt: "", status: "degraded", items: [] };
  }
  const body = raw as Record<string, unknown>;
  const items = Array.isArray(body.items)
    ? dedupeEditorialItems(body.items.map(readItem).filter((item): item is EditorialItem => item !== null))
    : [];
  const status = body.status === "ready" ? "ready" : "degraded";
  const generatedAt = isIso(body.generatedAt) ? body.generatedAt : "";
  if (body.status !== "ready" && body.status !== "degraded") {
    return { version: 1, generatedAt, status: "degraded", items };
  }
  if (!Array.isArray(body.items)) {
    return { version: 1, generatedAt, status: "degraded", items: [] };
  }
  return { version: 1, generatedAt, status, items };
}

export function editorialThisWeekItems(
  snapshot: EditorialSnapshot,
  now: number = Date.now(),
): EditorialItem[] {
  const from = now - EDITORIAL_WEEK_MS;
  return snapshot.items
    .filter((item) => {
      const ms = Date.parse(item.published_at);
      return Number.isFinite(ms) && ms >= from && ms <= now;
    })
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
    .slice(0, EDITORIAL_RAIL_LIMIT);
}
