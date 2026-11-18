import { socialPubRankingPayload, socialPubRankingReadFailure, type SocialPubRankingEntry } from "@/lib/socialPubRankings";

export type RankSubject = { venueId: string; venueName: string; listedPrice: number | null };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function price(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

export function postVisitRankingPayload(body: unknown): SocialPubRankingEntry[] | null {
  const entries = socialPubRankingPayload(body);
  if (!entries) return null;
  const ids = new Set<string>();
  for (const row of entries) {
    if (ids.has(row.venueId) || (row.listedPrice !== undefined && !price(row.listedPrice))) return null;
    ids.add(row.venueId);
  }
  return entries;
}

export function rankingSubject(body: unknown): RankSubject | null | "unavailable" {
  const value = record(body)?.subject;
  if (value === undefined || value === null) return null;
  const subject = record(value);
  return subject && typeof subject.venueId === "string" && subject.venueId.trim() &&
    typeof subject.venueName === "string" && subject.venueName.trim() && price(subject.listedPrice)
    ? subject as RankSubject : "unavailable";
}

const BEFORE_WRITE = new Set(["SOCIAL_FROZEN", "SOCIAL_ACCESS_UNAVAILABLE", "VENUE_LOOKUP_UNAVAILABLE"]);

export function socialPubRankingSaveAnswer(status: number, body: unknown): "refused" | "rejected" | "stale" | "unknown" {
  if (socialPubRankingReadFailure(status, body) === "refused") return "refused";
  const code = record(body)?.code;
  if (status === 409) return code === "STALE_RANKING" ? "stale" : "unknown";
  if (status >= 400 && status < 500) return "rejected";
  if (status >= 500 && typeof code === "string" && BEFORE_WRITE.has(code)) return "rejected";
  return "unknown";
}
