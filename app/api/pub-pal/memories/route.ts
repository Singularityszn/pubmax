import { callerUserId } from "@/lib/authServer";
import { jsonNoStore } from "@/lib/apiResponses";
import { confirmPalMemory, listPalMemories } from "@/lib/pubPalStore";

export async function GET(request: Request) { const owner = await callerUserId(request); return owner ? jsonNoStore({ memories: await listPalMemories(owner) }) : jsonNoStore({ error: "Sign in to read Pal memory." }, { status: 401 }); }
export async function POST(request: Request) { const owner = await callerUserId(request); if (!owner) return jsonNoStore({ error: "Sign in to confirm Pal memory." }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); } const memory = await confirmPalMemory(owner, body); return memory ? jsonNoStore({ memory }, { status: 201 }) : jsonNoStore({ error: "Choose a valid memory type and value." }, { status: 400 }); }
