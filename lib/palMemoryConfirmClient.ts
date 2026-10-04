// The one write behind a Pal memory card: the person's own Confirm tap posts the
// proposed memory to POST /api/pub-pal/memories. The Pal never reaches this.

import { accountBoundFetch, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import type { PubPalMemoryKind } from "@/lib/palMemoryKinds.mjs";

const SAVE_FAILED = "Could not save that memory.";

export async function confirmPalMemoryProposal(
  input: { memoryKind: PubPalMemoryKind; value: string },
  auth: AccountAuthSnapshot | null,
  request?: typeof fetch,
): Promise<{ ok: true } | { ok: false; error: string; needsSignIn?: boolean }> {
  if (!auth) return { ok: false, error: "Sign in to keep a Pal memory.", needsSignIn: true };
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
