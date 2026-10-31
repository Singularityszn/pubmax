import { authedActionFetch } from "@/lib/authedFetch";
import { normalizeHandle } from "@/lib/handleNormalize";
import { discardBody } from "@/lib/responseBody";
import { splitWithInput, WITH_TAG_MAX } from "@/lib/pintDropWithTags";
import type { Visibility } from "@/lib/spill";

/**
 * The handles a just-saved drop proposes, or none. An anonymous drop takes no
 * tags, because the inbox would name its author to the person tagged.
 */
export function withTagHandlesFor(withWho: string, visibility: Visibility): string[] {
  if (visibility === "anonymous") return [];
  return splitWithInput(withWho).handles;
}

// SENT ONCE PER DROP AND HANDLE. Every save attempt (the first, and a retry
// from the feed) sends its tags once the drop has an id, so this ledger is the
// client half of "never double-tagged": a handle already proposed on a drop is
// not sent again. The server half is the unique (drop, person) pair, which
// writes nothing for a repeat and answers the same either way.
const sentPairs = new Set<string>();

function pairKey(dropId: string, handle: string): string {
  return `${dropId}\n${handle}`;
}

/** Test-only: forget what this page already sent. */
export function __resetSentWithTags(): void {
  sentPairs.clear();
}

/** A failure worth one more try: the network, a rate limit or a server fault. */
function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

async function postTags(dropId: string, handles: readonly string[]): Promise<{ ok: boolean; transient: boolean }> {
  try {
    const response = await authedActionFetch(
      "/api/social/tags/with",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropId, handles }),
      },
      { requiresIdentity: true },
    );
    discardBody(response);
    return { ok: response.ok, transient: !response.ok && isTransient(response.status) };
  } catch {
    return { ok: false, transient: true };
  }
}

/**
 * Send the "With" handles to the tag inbox once the drop has an id. Fail-soft:
 * the drop has already landed, and a tag that did not send leaves it saying
 * nothing about that person, which is the consented default anyway. A
 * transient failure is tried once more; a handle already sent for this drop
 * is skipped.
 */
export async function proposeWithTags(dropId: string, handles: readonly unknown[]): Promise<boolean> {
  if (!dropId || !Array.isArray(handles)) return false;
  const wanted: string[] = [];
  for (const raw of handles) {
    const handle = typeof raw === "string" ? normalizeHandle(raw) : "";
    if (!handle || wanted.includes(handle) || sentPairs.has(pairKey(dropId, handle))) continue;
    wanted.push(handle);
    if (wanted.length >= WITH_TAG_MAX) break;
  }
  if (wanted.length === 0) return false;
  // Claimed before the first await, so two calls in one task send once.
  for (const handle of wanted) sentPairs.add(pairKey(dropId, handle));
  let result = await postTags(dropId, wanted);
  if (!result.ok && result.transient) result = await postTags(dropId, wanted);
  if (!result.ok) {
    // Not sent: a later attempt for this drop may try again.
    for (const handle of wanted) sentPairs.delete(pairKey(dropId, handle));
  }
  return result.ok;
}

/** The same, from the saved drop the create route answered with. */
export function proposeWithTagsForDrop(drop: unknown, handles: readonly unknown[]): Promise<boolean> {
  const id = drop && typeof drop === "object" ? (drop as { id?: unknown }).id : undefined;
  return proposeWithTags(typeof id === "string" ? id : "", handles);
}
