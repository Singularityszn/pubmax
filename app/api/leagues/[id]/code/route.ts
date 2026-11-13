// A new invite code, for the league's owner. The old code stops working.
//   POST → { code }

import { newInviteCode } from "@/lib/leagues.server";
import { leagueDoor, leagueFailure, leagueJson, leagueNotFound } from "@/lib/leagueHttp.server";
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
    const result = await newInviteCode(door.viewer, id);
    if (result.status === "set") return door.reply(leagueJson({ code: result.code }));
    if (result.status === "not_found") return door.reply(leagueNotFound());
    return door.reply(leagueFailure(new Error("No free invite code"), "POST /api/leagues/[id]/code"));
  } catch (err) {
    return door.reply(leagueFailure(err, "POST /api/leagues/[id]/code"));
  }
}
