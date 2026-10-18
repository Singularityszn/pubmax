// The one write behind a Pal memory card: the person's own Confirm tap posts the
// proposed memory to POST /api/pub-pal/memories. The Pal never reaches this.
// An update card PATCHes the memory it replaces and a forget card DELETEs it,
// through the same owner-checked routes the Pal page uses.

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
  input: {
    id: string;
    memoryKind: PubPalMemoryKind;
    value: string;
    relation?: "update" | "delete";
    supersedesMemoryId?: string;
  },
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

function memoryWrite(input: {
  memoryKind: PubPalMemoryKind;
  value: string;
  relation?: "update" | "delete";
  supersedesMemoryId?: string;
}): { path: string; init: RequestInit } {
  if (input.relation && input.supersedesMemoryId) {
    const path = `/api/pub-pal/memories/${encodeURIComponent(input.supersedesMemoryId)}`;
    if (input.relation === "delete") return { path, init: { method: "DELETE" } };
    return {
      path,
      init: { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: input.value }) },
    };
  }
  return {
    path: "/api/pub-pal/memories",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: input.memoryKind, value: input.value }),
    },
  };
}

async function postMemory(
  input: Parameters<typeof confirmPalMemoryProposal>[0],
  auth: AccountAuthSnapshot,
  request?: typeof fetch,
): Promise<ConfirmOutcome> {
  try {
    const write = memoryWrite(input);
    let response = await accountBoundFetch(auth, write.path, write.init, request);
    // The memory a card replaces was deleted after the card was made. A forget
    // card has nothing left to do; an update card keeps the new fact.
    if (response.status === 404 && input.relation === "delete") {
      discardBody(response);
      return { ok: true };
    }
    if (response.status === 404 && input.relation === "update") {
      discardBody(response);
      const fresh = memoryWrite({ memoryKind: input.memoryKind, value: input.value });
      response = await accountBoundFetch(auth, fresh.path, fresh.init, request);
    }
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
