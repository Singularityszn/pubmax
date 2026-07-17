import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { deletePalMemoryResult, updatePalMemoryResult } from "@/lib/pubPalStore";

type Context = { params: Promise<{ memoryId: string }> };

function unauthenticated(): Response {
  return jsonNoStore({ error: "Sign in to manage Pal memory.", code: "AUTH_REQUIRED", retryable: false }, { status: 401 });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return unauthenticated();
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonNoStore({ error: "Malformed request body.", code: "INVALID_JSON", retryable: false }, { status: 400 }); }
  const { memoryId } = await context.params;
  const result = await updatePalMemoryResult(ownerId, memoryId, body);
  if (result.ok) return jsonNoStore({ memory: result.value });
  return result.error === "error"
    ? jsonNoStore({ error: "Pal memory could not be updated.", code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true }, { status: 503 })
    : jsonNoStore({ error: "Pal memory was not found or the correction is empty.", code: "PAL_MEMORY_NOT_FOUND", retryable: false }, { status: 404 });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return unauthenticated();
  const { memoryId } = await context.params;
  const result = await deletePalMemoryResult(ownerId, memoryId);
  if (result.ok) return jsonNoStore({ deleted: true });
  return result.error === "error"
    ? jsonNoStore({ error: "Pal memory could not be deleted.", code: "PAL_MEMORY_STORE_UNAVAILABLE", retryable: true }, { status: 503 })
    : jsonNoStore({ error: "Pal memory not found.", code: "PAL_MEMORY_NOT_FOUND", retryable: false }, { status: 404 });
}
