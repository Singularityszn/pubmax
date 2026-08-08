import { callerUserId } from "@/lib/authServer";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { addMasteryEvent, getPubPal } from "@/lib/pubPalStore";

export async function GET(request: Request) { const owner = await callerUserId(request); return owner ? jsonNoStore({ pal: await getPubPal(owner) }) : publicApiError("Sign in to read mastery.", "UNAUTHENTICATED", 401); }
export async function POST(request: Request) { const owner = await callerUserId(request); if (!owner) return publicApiError("Sign in to record mastery.", "UNAUTHENTICATED", 401); let body: unknown; try { body = await request.json(); } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); } const event = await addMasteryEvent(owner, body); return event ? jsonNoStore({ event }, { status: 201 }) : publicApiError("Mastery comes only from checked activity in PUBMAXX.", "INVALID_REQUEST", 400); }
