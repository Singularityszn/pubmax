// Pure URL-param parsing for app/api/chaos-card/route.tsx, split out into its
// own module so it can be unit tested without importing next/og / JSX (the
// route file is a .tsx edge handler; vitest here only picks up __tests__/**
// /*.test.ts). Mirrors the trust-boundary discipline in app/api/crawl-card
// (share-card params are untrusted URL input — always clamp, never throw).

import { CHAOS_BANDS, computeChaosScore, type ChaosGrade } from "@/lib/chaosScore";

// Strip control chars and cap length. Exported for reuse by the route (the
// `title` param uses this directly, with no chaos-specific parsing).
export function clampParam(raw: string | null, max: number, fallback = ""): string {
  if (!raw) return fallback;
  const cleaned = Array.from(raw)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const GRADE_SET: ReadonlySet<string> = new Set(CHAOS_BANDS.map((b) => b.grade));

export function isChaosGrade(value: string): value is ChaosGrade {
  return GRADE_SET.has(value);
}

export type ResolvedChaosCard = {
  score: number;
  grade: ChaosGrade;
  oneLiner: string;
};

/**
 * Resolve the score/grade/oneLiner a chaos-card request should render. Two
 * calling conventions, in priority order:
 *
 *   1. `?score=&grade=&line=` — the caller (e.g. the crawl story page) has
 *      already run computeChaosScore and just wants a card for that exact
 *      result. Values are clamped/validated, never trusted outright; an
 *      invalid/missing grade or one-liner falls back to the rubric band for
 *      the given score.
 *   2. Raw signal params (`stops`, `spread`, `hour`, `hops`, `vibes`) — the
 *      route recomputes via computeChaosScore itself, so a share link can be
 *      built straight from a crawl's public fields with no caller-side math.
 *
 * Malformed/out-of-range input degrades to a safe default (never throws) —
 * this runs on every request to a public, unauthenticated route.
 */
export function resolveChaosCardParams(searchParams: URLSearchParams): ResolvedChaosCard {
  const explicitScore = searchParams.get("score");
  if (explicitScore !== null) {
    const score = clampInt(explicitScore, 0, 100, 0);
    const gradeRaw = clampParam(searchParams.get("grade"), 20, "");
    const oneLiner = clampParam(searchParams.get("line"), 80, "");
    if (isChaosGrade(gradeRaw) && oneLiner) {
      return { score, grade: gradeRaw, oneLiner };
    }
    // Missing/invalid grade or one-liner: fall back to the rubric band for
    // this score so the card copy always matches a labelled band, never
    // freeform/mismatched text.
    const band = CHAOS_BANDS.slice()
      .reverse()
      .find((b) => score >= b.min);
    return {
      score,
      grade: isChaosGrade(gradeRaw) ? gradeRaw : (band?.grade ?? "Quiet"),
      oneLiner: oneLiner || (band?.oneLiner ?? ""),
    };
  }

  const stopCount = clampInt(searchParams.get("stops"), 0, 30, 0);
  const spread = clampInt(searchParams.get("spread"), 0, 100, 0);
  const hour = searchParams.has("hour") ? clampInt(searchParams.get("hour"), 0, 23, 0) : null;
  const hops = clampInt(searchParams.get("hops"), 0, 10, 0);
  const vibesRaw = clampParam(searchParams.get("vibes"), 200, "");
  const vibeTags = vibesRaw ? vibesRaw.split(",").map((t) => t.trim()) : [];
  // `spread` arrives as a single GBP number (max-min already computed by the
  // caller) — represent it as two synthetic prices so computeChaosScore's
  // spread math (max - min) reproduces it exactly.
  const prices = spread > 0 ? [0, spread] : [];

  return computeChaosScore({
    stopCount,
    prices,
    vibeTags,
    lastDropHour: hour,
    boroughHops: hops,
  });
}
