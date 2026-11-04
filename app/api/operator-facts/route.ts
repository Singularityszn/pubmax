// What a pub has said about itself, as published by a moderator's acceptance
// of a verified operator's proposal (launch plan 1 Nov 2026, section 7 item 1).
//
//   GET ?venueId=<id>  -> 200 { status, facts }
//
// ONLY PUBLISHED FACTS LEAVE. A pending or declined proposal has no fact, and
// a decline after an accept withdraws it (lib/operatorFactsStore.ts). The read
// projects every row through `toPublicOperatorFact`, so the operator's account
// id and the proposal id never reach a browser. A dated event or offer leaves
// once its night is over (`venueSheetOperatorFacts`).
//
// IT CHANGES NOTHING ELSE. The venue sheet prints these in their own block,
// "From the pub". No rank, pin colour, price band or order reads them
// (docs/SPONSORSHIP_POLICY.md; __tests__/operatorFactsFence.test.ts).
//
// A read is not a write, so no rate limit is spent here, and nothing is cached
// so a withdrawal is gone on the next open. A store that cannot answer says
// `degraded` with no facts, never an empty pub.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { toPublicOperatorFact, venueSheetOperatorFacts } from "@/lib/operatorFacts";
import { operatorFactsStore } from "@/lib/operatorFactsStore";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";

export const runtime = "nodejs";

const VENUE_ID_MAX = 120;

export async function GET(request: Request): Promise<Response> {
  const rawVenue = new URL(request.url).searchParams.get("venueId")?.trim() ?? "";
  if (!rawVenue || rawVenue.length > VENUE_ID_MAX) {
    return publicApiError("Ask for a pub.", "INVALID_REQUEST", 400);
  }
  let venueId = rawVenue;
  try {
    venueId = await resolveCanonicalVenueId(rawVenue);
  } catch {
    // An alias table that cannot answer leaves the id as asked.
  }
  try {
    const read = await operatorFactsStore().listPublishedForVenue(venueId);
    const facts = venueSheetOperatorFacts(read.facts, Date.now()).map(toPublicOperatorFact);
    return jsonNoStore({ status: read.status, facts }, { status: 200 });
  } catch {
    // A backend that refuses to start is a read that could not answer.
    return jsonNoStore({ status: "degraded", facts: [] }, { status: 200 });
  }
}
