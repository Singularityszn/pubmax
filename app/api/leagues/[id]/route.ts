// One league.
//   GET    → visible member standings and available district leaders
//   DELETE → deletes it, for its owner
// A league that is gone and one the reader is not in answer the same 404.

import { deleteLeague, readLeague } from "@/lib/leagues.server";
import { leagueDoor, leagueFailure, leagueJson, leagueNotFound } from "@/lib/leagueHttp.server";
import { isLeagueId } from "@/lib/leagues";
import { socialFreezeResponse } from "@/lib/opsFreeze";
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
    const board = await readLeague(door.viewer, id);
    return door.reply(board ? leagueJson(board) : leagueNotFound());
  } catch (err) {
    return door.reply(leagueFailure(err, "GET /api/leagues/[id]"));
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const { id } = await context.params;
  if (!isLeagueId(id)) return leagueNotFound();
  const door = await leagueDoor(request, { name: "league-write", max: 10, windowMs: 10 * 60_000 });
  if (!door.ok) return door.response;
  try {
    return door.reply((await deleteLeague(door.viewer, id)) ? leagueJson({ deleted: true }) : leagueNotFound());
  } catch (err) {
    return door.reply(leagueFailure(err, "DELETE /api/leagues/[id]"));
  }
}
