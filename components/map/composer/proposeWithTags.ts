import { authedActionFetch } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { splitWithInput } from "@/lib/pintDropWithTags";
import type { Visibility } from "@/lib/spill";

/**
 * The handles a just-saved drop proposes, or none. An anonymous drop takes no
 * tags, because the inbox would name its author to the person tagged.
 */
export function withTagHandlesFor(withWho: string, visibility: Visibility): string[] {
  if (visibility === "anonymous") return [];
  return splitWithInput(withWho).handles;
}

/**
 * Send the "With" handles to the tag inbox once the drop has an id. Fail-soft:
 * the drop has already landed, and a tag that did not send leaves it saying
 * nothing about that person, which is the consented default anyway.
 */
export async function proposeWithTags(dropId: string, handles: readonly string[]): Promise<boolean> {
  if (!dropId || handles.length === 0) return false;
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
    return response.ok;
  } catch {
    return false;
  }
}

/** The same, from the saved drop the create route answered with. */
export function proposeWithTagsForDrop(drop: unknown, handles: readonly string[]): Promise<boolean> {
  const id = drop && typeof drop === "object" ? (drop as { id?: unknown }).id : undefined;
  return proposeWithTags(typeof id === "string" ? id : "", handles);
}
