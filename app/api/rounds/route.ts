// Create a Round (GH #26, PRD § The Spill — The Round is the group crawl that
// builds itself live).
//   POST { title?, handle } → 201 { round, members, stops }   (RoundState)
//
// Identity is the self-asserted `handle` (no auth yet — same trust boundary as the
// rest of the social layer). The creator is the first member of their own Round.
// Store choice is the usual seam: Supabase when configured, process-memory
// otherwise. Writes are rate-limited per handle + hashed IP, like the app's other
// write routes.

import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { roundsStore } from "@/lib/roundsStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const handle = normalizeHandle(readString(body.handle) ?? "");
  if (!handle) return Response.json({ error: "Add a handle to start a Round." }, { status: 400 });

  const key = `round-create:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return Response.json({ error: "Too many Rounds, slow down." }, { status: 429 });
  }

  const result = await roundsStore().create({ title: body.title, createdByHandle: handle });
  if (!result.ok) {
    // A store failure is a degraded dependency (503, fail-soft), not a bug (500)
    // — the house contract every other write route uses (see pint-drops).
    const status = result.error === "invalid" ? 400 : 503;
    return Response.json({ error: "Could not start the Round." }, { status });
  }
  return Response.json(result.state, { status: 201 });
}
