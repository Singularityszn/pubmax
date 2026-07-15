import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { createNightMemory, listNightMemories } from "@/lib/nightMemoryStore";

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  return ownerId
    ? jsonNoStore({ memories: await listNightMemories(ownerId) })
    : jsonNoStore({ error: "Sign in to view Night Memories." }, { status: 401 });
}

export async function POST(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to create a Night Memory." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const memory = await createNightMemory(ownerId, body);
  return memory
    ? jsonNoStore({ memory }, { status: 201 })
    : jsonNoStore({ error: "Add a title to create this Night Memory." }, { status: 400 });
}
