import { callerUserId } from "@/lib/authServer";
import { jsonNoStore } from "@/lib/apiResponses";
import { createPubPalResult, deletePubPalResult, getPubPalResult, updatePubPalResult } from "@/lib/pubPalStore";

async function owner(request: Request): Promise<string | Response> {
  return await callerUserId(request)
    ?? jsonNoStore({ error: "Sign in to own a Pub Pal.", code: "AUTH_REQUIRED", retryable: false }, { status: 401 });
}

export async function GET(request: Request): Promise<Response> {
  const id = await owner(request);
  if (typeof id !== "string") return id;
  const result = await getPubPalResult(id);
  return result.ok
    ? jsonNoStore({ pal: result.value })
    : jsonNoStore({ error: "Pub Pal is temporarily unavailable.", code: "PUB_PAL_STORE_UNAVAILABLE", retryable: true }, { status: 503 });
}

export async function POST(request: Request): Promise<Response> {
  const id = await owner(request);
  if (typeof id !== "string") return id;
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonNoStore({ error: "Malformed request body.", code: "INVALID_JSON", retryable: false }, { status: 400 }); }
  const result = await createPubPalResult(id, body);
  if (result.ok) return jsonNoStore({ pal: result.value }, { status: 201 });
  return result.error === "error"
    ? jsonNoStore({ error: "Pub Pal could not be created right now.", code: "PUB_PAL_STORE_UNAVAILABLE", retryable: true }, { status: 503 })
    : jsonNoStore({ error: "Complete every required Pal field and confirm you are 18+.", code: "INVALID_PUB_PAL", retryable: false }, { status: 400 });
}

export async function PATCH(request: Request): Promise<Response> {
  const id = await owner(request);
  if (typeof id !== "string") return id;
  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonNoStore({ error: "Malformed request body.", code: "INVALID_JSON", retryable: false }, { status: 400 }); }
  const result = await updatePubPalResult(id, body);
  if (result.ok) return jsonNoStore({ pal: result.value });
  return result.error === "error"
    ? jsonNoStore({ error: "Pub Pal controls are temporarily unavailable.", code: "PUB_PAL_STORE_UNAVAILABLE", retryable: true }, { status: 503 })
    : jsonNoStore({ error: "Pub Pal not found.", code: "PUB_PAL_NOT_FOUND", retryable: false }, { status: 404 });
}

export async function DELETE(request: Request): Promise<Response> {
  const id = await owner(request);
  if (typeof id !== "string") return id;
  const result = await deletePubPalResult(id);
  if (result.ok) return jsonNoStore({ deleted: true });
  return result.error === "error"
    ? jsonNoStore({ error: "Pub Pal could not be deleted.", code: "PUB_PAL_STORE_UNAVAILABLE", retryable: true }, { status: 503 })
    : jsonNoStore({ error: "Pub Pal not found.", code: "PUB_PAL_NOT_FOUND", retryable: false }, { status: 404 });
}
