import { callerUserId } from "@/lib/authServer";
import { jsonNoStore } from "@/lib/apiResponses";
import { addMasteryEvent, getPubPal } from "@/lib/pubPalStore";

export async function GET(request: Request) { const owner = await callerUserId(request); return owner ? jsonNoStore({ pal: await getPubPal(owner) }) : jsonNoStore({ error: "Sign in to read mastery." }, { status: 401 }); }
export async function POST(request: Request) { const owner = await callerUserId(request); if (!owner) return jsonNoStore({ error: "Sign in to record mastery." }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); } const event = await addMasteryEvent(owner, body); return event ? jsonNoStore({ event }, { status: 201 }) : jsonNoStore({ error: "Mastery comes only from checked activity in PUBMAXX." }, { status: 400 }); }
