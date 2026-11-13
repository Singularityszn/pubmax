// Join a league with its invite code.
//   POST { code } → { id }
// The code is the whole invite, so this door is rate limited hard.

import { joinLeague } from "@/lib/leagues.server";
import {
  leagueBody,
  leagueDoor,
  leagueError,
  leagueFailure,
  leagueJson,
  malformedLeagueBody,
} from "@/lib/leagueHttp.server";
import { LEAGUES_COPY, normalizeInviteCode } from "@/lib/leagues";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const body = await leagueBody(request);
  if (!body) return malformedLeagueBody();
  const code = normalizeInviteCode(body.code);
  if (!code) return leagueError(LEAGUES_COPY.badCode, "INVALID_CODE", 400);

  const door = await leagueDoor(request, { name: "leagues-join", max: 10, windowMs: 10 * 60_000 });
  if (!door.ok) return door.response;
  try {
    const result = await joinLeague(door.viewer, code);
    switch (result.status) {
      case "joined":
        return door.reply(leagueJson({ id: result.id }));
      case "not_found":
        return door.reply(leagueError(LEAGUES_COPY.badCode, "INVALID_CODE", 404));
      case "full":
        return door.reply(leagueError(LEAGUES_COPY.full, "LEAGUE_FULL", 409));
      case "limit":
        return door.reply(leagueError(LEAGUES_COPY.limit, "LEAGUE_LIMIT", 409));
    }
  } catch (err) {
    return door.reply(leagueFailure(err, "POST /api/leagues/join"));
  }
}
