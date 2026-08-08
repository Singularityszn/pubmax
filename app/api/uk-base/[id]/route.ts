// GET /api/uk-base/[id] — cold resolve one `venue-uk-*` base pub by id.
//
// Shared /map?sel=venue-uk-* links need the full record (name, address, coords)
// before the viewport stream has that cell. The client tries a hint-scoped
// shard fetch first; this route is the fail-closed authority when there is no
// `at=` hint or the hint's cell does not carry the id. Never invents a pub:
// missing → 404, pack unavailable → 503.

import { NextResponse } from "next/server";

import { publicApiError } from "@/lib/apiError";

import { lookupUkBasePub } from "@/lib/ukBaseIndex";
import { isUkBaseId } from "@/lib/ukBasePubs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  if (!isUkBaseId(id)) {
    return publicApiError("Not a UK base pub id.", "INVALID_REQUEST", 400);
  }
  const result = await lookupUkBasePub(id);
  if (result.status === "missing") {
    return publicApiError("Pub not found.", "NOT_FOUND", 404);
  }
  if (result.status === "unavailable") {
    return publicApiError("UK base pubs unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
  return NextResponse.json(
    { pub: result.pub },
    {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
