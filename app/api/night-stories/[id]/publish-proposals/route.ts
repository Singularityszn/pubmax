import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { proposeNightStoryPublication } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  // Solo-operator emergency freeze (U15): proposing a Story publication is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const actorId = await callerUserId(request);
  if (!actorId) return jsonNoStore({ error: "Sign in to propose Story publication." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const { id } = await context.params;
  const proposal = await proposeNightStoryPublication(actorId, id, body);
  return proposal
    ? jsonNoStore(proposal, { status: 201 })
    : jsonNoStore({ error: "Every selected Moment needs current owner approval." }, { status: 409 });
}
