// Leave a league. Its owner deletes it instead.
//   POST → { left: true }

import { leaveLeague } from "@/lib/leagues.server";
import { leagueDoor, leagueError, leagueFailure, leagueJson, leagueNotFound } from "@/lib/leagueHttp.server";
import { isLeagueId } from "@/lib/leagues";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const { id } = await context.params;
  if (!isLeagueId(id)) return leagueNotFound();
  const door = await leagueDoor(request, { name: "league-write", max: 10, windowMs: 10 * 60_000 });
  if (!door.ok) return door.response;
  try {
    const result = await leaveLeague(door.viewer, id);
    if (result === "owner") {
      return door.reply(leagueError("You run this league, so delete it instead.", "OWNER_CANNOT_LEAVE", 409));
    }
    return door.reply(result === "left" ? leagueJson({ left: true }) : leagueNotFound());
  } catch (err) {
    return door.reply(leagueFailure(err, "POST /api/leagues/[id]/leave"));
  }
}
