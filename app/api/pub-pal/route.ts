import { callerUserId } from "@/lib/authServer";
import { jsonNoStore } from "@/lib/apiResponses";
import { createPubPal, deletePubPal, getPubPal, updatePubPal } from "@/lib/pubPalStore";

async function owner(request: Request): Promise<string | Response> { return await callerUserId(request) ?? jsonNoStore({ error: "Sign in to own a Pub Pal." }, { status: 401 }); }
export async function GET(request: Request) { const id = await owner(request); return typeof id === "string" ? jsonNoStore({ pal: await getPubPal(id) }) : id; }
export async function POST(request: Request) { const id = await owner(request); if (typeof id !== "string") return id; let body: unknown; try { body = await request.json(); } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); } const pal = await createPubPal(id, body); return pal ? jsonNoStore({ pal }, { status: 201 }) : jsonNoStore({ error: "Complete every required Pal field and confirm you are 18+." }, { status: 400 }); }
export async function PATCH(request: Request) { const id = await owner(request); if (typeof id !== "string") return id; let body: unknown; try { body = await request.json(); } catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); } const pal = await updatePubPal(id, body); return pal ? jsonNoStore({ pal }) : jsonNoStore({ error: "Pub Pal not found." }, { status: 404 }); }
export async function DELETE(request: Request) { const id = await owner(request); if (typeof id !== "string") return id; return await deletePubPal(id) ? jsonNoStore({ deleted: true }) : jsonNoStore({ error: "Pub Pal not found." }, { status: 404 }); }
