import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { addNightMoment } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to add a Night Moment." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const { id } = await context.params;
  const moment = await addNightMoment(ownerId, id, body);
  return moment
    ? jsonNoStore({ moment }, { status: 201 })
    : jsonNoStore({ error: "That Memory cannot accept this Moment." }, { status: 400 });
}
