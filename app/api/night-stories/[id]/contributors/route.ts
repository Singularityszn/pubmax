import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { acceptStoryContribution, upsertStoryContributor } from "@/lib/nightMemoryStore";
import { profileStore } from "@/lib/profileStore";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return jsonNoStore({ error: "Sign in to invite a contributor." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }
  const { id } = await context.params;
  const contributor = await upsertStoryContributor(actorId, id, body);
  const handle = body && typeof body === "object" && typeof (body as { handle?: unknown }).handle === "string"
    ? (body as { handle: string }).handle.toLocaleLowerCase()
    : "";
  return contributor
    ? jsonNoStore({ contributor: { storyId: contributor.storyId, handle, role: contributor.role, status: contributor.status, joinedAt: contributor.joinedAt } }, { status: 201 })
    : jsonNoStore({ error: "Only a host or editor can invite contributors." }, { status: 403 });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const actorId = await callerUserId(request);
  if (!actorId) return jsonNoStore({ error: "Sign in to accept this invitation." }, { status: 401 });
  const { id } = await context.params;
  const contributor = await acceptStoryContribution(actorId, id);
  const profile = contributor ? await profileStore().getByUserId(actorId) : null;
  return contributor
    ? jsonNoStore({ contributor: { storyId: contributor.storyId, handle: profile?.handle ?? null, role: contributor.role, status: contributor.status, joinedAt: contributor.joinedAt } })
    : jsonNoStore({ error: "No active Story invitation was found." }, { status: 404 });
}
