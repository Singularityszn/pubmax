import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { getPubPalResult, listPalMemoriesResult } from "@/lib/pubPalStore";

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to export Pal memory.", code: "AUTH_REQUIRED", retryable: false }, { status: 401 });
  const palResult = await getPubPalResult(ownerId);
  if (!palResult.ok) return jsonNoStore({ error: "Pal memory export is temporarily unavailable.", code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true }, { status: 503 });
  const pal = palResult.value;
  if (!pal) return jsonNoStore({ error: "Pub Pal not found.", code: "PUB_PAL_NOT_FOUND", retryable: false }, { status: 404 });
  const result = await listPalMemoriesResult(ownerId);
  if (!result.ok) return result.error === "error"
    ? jsonNoStore({ error: "Pal memory export is temporarily unavailable.", code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true }, { status: 503 })
    : jsonNoStore({ error: "Pub Pal not found.", code: "PUB_PAL_NOT_FOUND", retryable: false }, { status: 404 });
  const memories = result.value;
  return jsonNoStore({
    version: 1,
    exportedAt: new Date().toISOString(),
    pal: { name: pal.name, species: pal.appearance.species },
    proposalPreferences: pal.proposalPreferences,
    memories: memories.map(({ id, kind, value, provenance, createdAt, updatedAt }) => ({ id, kind, value, provenance, createdAt, updatedAt })),
  }, {
    headers: { "content-disposition": `attachment; filename="pubmaxx-pal-memory-${pal.id}.json"` },
  });
}
