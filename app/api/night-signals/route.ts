import snapshot from "@/public/data/night_signals/latest.json";
import { jsonNoStore } from "@/lib/apiResponses";
import { activeNightSignalClaims } from "@/lib/nightSignalClaims";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId")?.trim() ?? "";
  const claims = activeNightSignalClaims(snapshot).filter((claim) => !entityId || claim.entity.id === entityId);
  return jsonNoStore({ version: 1, asOf: snapshot.generatedAt, claims });
}
