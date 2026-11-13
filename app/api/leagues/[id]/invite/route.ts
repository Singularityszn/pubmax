import { leagueInviteMates, sendLeagueInvite } from "@/lib/leagueInvites.server";
import {
  leagueBody, leagueDoor, leagueError, leagueFailure, leagueJson, leagueNotFound, malformedLeagueBody,
} from "@/lib/leagueHttp.server";
import { isLeagueId } from "@/lib/leagues";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { normalizeHandle } from "@/lib/profiles";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isLeagueId(id)) return leagueNotFound();
  const door = await leagueDoor(request, { name: "league-read", max: 10, windowMs: 60_000 });
  if (!door.ok) return door.response;
  try {
    const mates = await leagueInviteMates(door.viewer, id);
    return door.reply(mates ? leagueJson({ mates }) : leagueNotFound());
  } catch (error) {
    return door.reply(leagueFailure(error, "GET /api/leagues/[id]/invite"));
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const { id } = await context.params;
  if (!isLeagueId(id)) return leagueNotFound();
  const door = await leagueDoor(request, { name: "league-invite", max: 5, windowMs: 10 * 60_000 });
  if (!door.ok) return door.response;
  const body = await leagueBody(request);
  const recipient = typeof body?.recipient === "string" ? normalizeHandle(body.recipient) : null;
  if (!recipient) return door.reply(malformedLeagueBody());
  try {
    const result = await sendLeagueInvite(door.viewer, id, recipient);
    if (result === "sent") return door.reply(leagueJson({ sent: true }));
    if (result === "not_found") return door.reply(leagueNotFound());
    if (result === "not_mate") return door.reply(leagueError("That invite couldn't reach your mate.", "NOT_MATE", 400));
    return door.reply(leagueError("The invite didn't send. Try again.", "INVITE_UNAVAILABLE", 503, true));
  } catch (error) {
    return door.reply(leagueFailure(error, "POST /api/leagues/[id]/invite"));
  }
}
