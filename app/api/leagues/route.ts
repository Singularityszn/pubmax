// Your leagues.
//   GET              → { leagues: [{ id, name, owner }] }
//   POST { name }    → 201 { id }
// Both need a verified Social account. lib/leagues.server.ts owns the rules.

import { createLeague, listLeagues } from "@/lib/leagues.server";
import {
  leagueBody,
  leagueDoor,
  leagueError,
  leagueFailure,
  leagueJson,
  malformedLeagueBody,
} from "@/lib/leagueHttp.server";
import { LEAGUES_COPY, parseLeagueName } from "@/lib/leagues";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const door = await leagueDoor(request, { name: "leagues-read", max: 30, windowMs: 60_000 });
  if (!door.ok) return door.response;
  try {
    return door.reply(leagueJson({ leagues: await listLeagues(door.viewer) }));
  } catch (err) {
    return door.reply(leagueFailure(err, "GET /api/leagues"));
  }
}

export async function POST(request: Request): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const body = await leagueBody(request);
  if (!body) return malformedLeagueBody();
  const name = parseLeagueName(body.name);
  if (!name) return leagueError(LEAGUES_COPY.badName, "INVALID_NAME", 400);

  const door = await leagueDoor(request, { name: "leagues-create", max: 5, windowMs: 60 * 60_000 });
  if (!door.ok) return door.response;
  try {
    const result = await createLeague(door.viewer, name);
    if (result.status === "created") return door.reply(leagueJson({ id: result.id }, 201));
    if (result.status === "limit") return door.reply(leagueError(LEAGUES_COPY.limit, "LEAGUE_LIMIT", 409));
    return door.reply(leagueFailure(new Error("No free invite code"), "POST /api/leagues"));
  } catch (err) {
    return door.reply(leagueFailure(err, "POST /api/leagues"));
  }
}
