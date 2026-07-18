import snapshot from "@/public/data/night_signals/latest.json";
import { jsonCached } from "@/lib/apiResponses";
import { activeNightSignalClaims } from "@/lib/nightSignalClaims";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId")?.trim() ?? "";
  const claims = activeNightSignalClaims(snapshot).filter((claim) => !entityId || claim.entity.id === entityId);
  // Derived purely from the shipped snapshot (refreshed via a redeploy, which
  // purges the edge) — safe to hold at the CDN. Short window keeps a snapshot
  // refresh visible quickly. Was no-store, which hit a function on every poll.
  return jsonCached({ version: 1, asOf: snapshot.generatedAt, claims }, { sMaxAge: 300, staleWhileRevalidate: 600 });
}
