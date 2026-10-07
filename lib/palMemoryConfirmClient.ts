// The one write behind a Pal memory card: the person's own Confirm tap posts the
// proposed memory to POST /api/pub-pal/memories. The Pal never reaches this.

import { accountBoundFetch, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import type { PubPalMemoryKind } from "@/lib/palMemoryKinds.mjs";

const SAVE_FAILED = "Couldn't save that memory.";

type ConfirmOutcome = { ok: true } | { ok: false; error: string; needsSignIn?: boolean };

/** Cards that are saving or saved. A failure releases its card so the person can try again. */
const claimedCards = new Set<string>();

/**
 * Save one memory card. A second tap on a card that is saving or saved sends
 * nothing and answers null, so one card can never become two memories.
 */
export async function confirmPalMemoryProposal(
  input: { id: string; memoryKind: PubPalMemoryKind; value: string },
  auth: AccountAuthSnapshot | null,
  request?: typeof fetch,
): Promise<ConfirmOutcome | null> {
  if (!auth) return { ok: false, error: "Sign in to keep a Pal memory.", needsSignIn: true };
  if (claimedCards.has(input.id)) return null;
  claimedCards.add(input.id);
  const outcome = await postMemory(input, auth, request);
  if (!outcome.ok) claimedCards.delete(input.id);
  return outcome;
}

async function postMemory(
  input: { memoryKind: PubPalMemoryKind; value: string },
  auth: AccountAuthSnapshot,
  request?: typeof fetch,
): Promise<ConfirmOutcome> {
  try {
    const response = await accountBoundFetch(
      auth,
      "/api/pub-pal/memories",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: input.memoryKind, value: input.value }),
      },
      request,
    );
    if (response.status === 401) {
      discardBody(response);
      return { ok: false, error: "Sign in to keep a Pal memory.", needsSignIn: true };
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as unknown;
      return { ok: false, error: errorMessageFrom(body, SAVE_FAILED) };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: SAVE_FAILED };
  }
}
