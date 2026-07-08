// The handles this profile follows (its followees). Powers the Friends feed lane
// (lib/feed.ts): the /feed page fetches this once for the viewer's own handle,
// then keeps only drops authored by a handle in the returned set.
//
// Store choice is the same seam as the sibling routes: Supabase when configured,
// process-memory otherwise. This is a pure read and MUST never 500 — a bad
// handle or a backend hiccup degrades to an empty list so the feed still renders
// (the Friends lane just falls through to its "follow people" empty state).

import { jsonNoStore } from "@/lib/apiResponses";
import { normalizeHandle } from "@/lib/profiles";
import { followStore } from "@/lib/followStore";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  // An empty handle has no follow graph — return the empty list, not a 400, so
  // the feed's fetch has one uniform shape to read.
  if (!handle) return jsonNoStore({ following: [] }, { status: 200 });

  try {
    const following = await followStore().listFollowing(handle);
    return jsonNoStore({ following }, { status: 200 });
  } catch {
    // Fail-soft: a backend error must not break the feed. The Friends lane will
    // simply show its "follow people" empty state.
    return jsonNoStore({ following: [] }, { status: 200 });
  }
}
