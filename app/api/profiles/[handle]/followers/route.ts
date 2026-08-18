// The handles that follow this profile. The exact mirror of /following, which
// has always been here; the reverse direction had no read at all, so a
// "Followers: 14" figure on a profile could be printed and never opened.
//
// Same store seam, same projection (handles only, nothing about the person),
// and the same fail-soft posture as its sibling: this is a pure read and MUST
// never 500. A bad handle or a backend hiccup degrades to an empty list so the
// list surface still renders its own empty state.

import { jsonNoStore } from "@/lib/apiResponses";
import { followListEntries } from "@/lib/followListProjection.server";
import { normalizeHandle } from "@/lib/profiles";
import { followStore } from "@/lib/followStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) return jsonNoStore({ followers: [] }, { status: 200 });

  try {
    const handles = await followStore().listFollowers(handle);
    const followers = await followListEntries(handles);
    return jsonNoStore({ followers }, { status: 200 });
  } catch {
    return jsonNoStore({ followers: [] }, { status: 200 });
  }
}
