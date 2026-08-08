// GET /api/uk-base/[id] — cold resolve one `venue-uk-*` base pub by id.
//
// Shared /map?sel=venue-uk-* links need the full record (name, address, coords)
// before the viewport stream has that cell. The client tries a hint-scoped
// shard fetch first; this route is the fail-closed authority when there is no
// `at=` hint or the hint's cell does not carry the id. Never invents a pub:
// missing → 404, pack unavailable → 503.

import { NextResponse } from "next/server";

import { lookupUkBasePub } from "@/lib/ukBaseIndex";
import { isUkBaseId } from "@/lib/ukBasePubs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  if (!isUkBaseId(id)) {
    return NextResponse.json({ error: "Not a UK base pub id." }, { status: 400 });
  }
  const result = await lookupUkBasePub(id);
  if (result.status === "missing") {
    return NextResponse.json({ error: "Pub not found." }, { status: 404 });
  }
  if (result.status === "unavailable") {
    return NextResponse.json({ error: "UK base pubs unavailable." }, { status: 503 });
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
