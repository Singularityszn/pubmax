import { jsonNoStore } from "@/lib/apiResponses";
import { isWhatsOnLimited } from "@/lib/citymcpRateLimit";
import { isWhatsOnKind, type WhatsOnKind } from "@/lib/whatsOn";
import {
  loadWhatsOn,
  type LoadWhatsOnDeps,
  type LoadWhatsOnParams,
  type WhatsOnLocalityBasis,
  type WhatsOnSourceFreshnessKind,
} from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

const MAX_LIMIT = 100;

export type WhatsOnResponse = {
  rows: WhatsOnRow[];
  servedAt: string;
  sourceObservedAt: string | null;
  sourceFreshnessKind: WhatsOnSourceFreshnessKind;
  localityBasis: WhatsOnLocalityBasis;
  /** Compatibility alias for pre-L15 clients; always equals sourceObservedAt. */
  asOf: string | null;
};

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

// Handler with injectable store deps.
export async function handleWhatsOnRequest(
  request: Request,
  deps: LoadWhatsOnDeps = {},
): Promise<Response> {
  // Own key/budget (lib/citymcpRateLimit.ts): whats-on is partly served from
  // bundled data, so it must not share (and prematurely exhaust) the CityMCP
  // proxy surface's budget. A 429 here is an allowed exception to the "never
  // 500" fail-soft contract described above — upstream failures still 200.
  if (await isWhatsOnLimited(request)) {
    return jsonNoStore({ rows: [], error: "Too many requests, slow down." }, { status: 429 });
  }

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

    const result = await loadWhatsOn(load, deps);
    const response: WhatsOnResponse = {
      rows: result.rows,
      servedAt: result.servedAt,
      sourceObservedAt: result.sourceObservedAt,
      sourceFreshnessKind: result.sourceFreshnessKind,
      localityBasis: result.localityBasis,
      asOf: result.sourceObservedAt,
    };
    return jsonNoStore(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "What's-On request failed";
    return jsonNoStore({ rows: [], error: message });
  }
}
