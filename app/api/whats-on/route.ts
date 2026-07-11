// GET /api/whats-on?kind=&window=tonight&near=lat,lng&limit=
//
// Merged baseline + live What's-On rows (Task B1). Read-only over bundled static
// data + a fail-soft CityMCP live layer, so it never needs prod-only guards and
// never 500s: unknown params are dropped (not 400), and any failure lands as
// 200 + { rows: [], error }. On success: 200 + { rows, asOf }.

import { jsonNoStore } from "@/lib/apiResponses";
import { isWhatsOnKind, type WhatsOnKind } from "@/lib/whatsOn";
import {
  loadWhatsOn,
  type LoadWhatsOnDeps,
  type LoadWhatsOnParams,
} from "@/lib/whatsOnStore";

export const runtime = "nodejs";

const MAX_LIMIT = 100;

function parseKind(raw: string | null): WhatsOnKind | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return isWhatsOnKind(v) ? v : undefined; // unknown kind dropped, not 400
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, MAX_LIMIT);
}

function parseNear(raw: string | null): { lat: number; lng: number } | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => Number.parseFloat(s.trim()));
  if (parts.length !== 2) return undefined;
  const [lat, lng] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

// Exported for tests: handler with injectable store deps.
export async function handleWhatsOnRequest(
  request: Request,
  deps: LoadWhatsOnDeps = {},
): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const load: LoadWhatsOnParams = {};
    const kind = parseKind(params.get("kind"));
    if (kind) load.kind = kind;
    if ((params.get("window") ?? "").trim().toLowerCase() === "tonight") load.window = "tonight";
    const near = parseNear(params.get("near"));
    if (near) load.near = near;
    const limit = parseLimit(params.get("limit"));
    if (limit) load.limit = limit;

    const { rows, asOf } = await loadWhatsOn(load, deps);
    return jsonNoStore({ rows, asOf });
  } catch (err) {
    const message = err instanceof Error ? err.message : "What's-On request failed";
    return jsonNoStore({ rows: [], error: message });
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleWhatsOnRequest(request);
}
