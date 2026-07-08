import { jsonNoStore } from "@/lib/apiResponses";
import { getPintDropById } from "@/lib/pintDropLookup";

// GET /api/pint-drops/[id] — the single public read behind a Pint Drop
// permalink. Returns the leak-proof PublicDrop DTO (getPintDropById selects only
// public columns and never surfaces a hidden/reported drop). 200 { drop } on a
// hit, 404 { error } for an unknown/hidden/absent id. Never leaks moderation
// state: a hidden id is indistinguishable from a missing one.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const drop = await getPintDropById(id);
  if (!drop) {
    return jsonNoStore({ error: "Pint drop not found." }, { status: 404 });
  }
  return jsonNoStore({ drop });
}
