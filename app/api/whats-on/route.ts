// GET /api/whats-on?kind=&window=tonight&near=lat,lng&limit=
//
// Merged baseline + live What's-On rows (Task B1). Read-only over bundled static
// data + a fail-soft CityMCP live layer, so it never needs prod-only guards and
// never 500s: unknown params are dropped (not 400), and any failure lands as
// 200 + { rows: [], error }. Success separates servedAt from honest source
// freshness: { rows, servedAt, sourceObservedAt, sourceFreshnessKind,
// localityBasis, asOf } (asOf is a compatibility alias for sourceObservedAt).
//
// S2: per-IP rate limited (own key, isWhatsOnLimited) — the fail-soft "never
// 500" contract above is unaffected; a 429 is the one allowed exception.

import { handleWhatsOnRequest } from "@/lib/whatsOnHandler";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleWhatsOnRequest(request);
}
