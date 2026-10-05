"use client";

// Client plumbing for the Diary: the account-bound log write.

import {
  accountBoundFetch,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import {
  readContributionGateStatus,
  type ContributionGateStatus,
} from "@/lib/contributionGateStatus";
import type { DiaryEntryDTO } from "@/lib/diary";

export type DiaryDraftInput = {
  venueId: string;
  visitedOn: string;
  rating: number | null;
  review: string;
};

export type DiaryPostResult =
  | { ok: true; entry: DiaryEntryDTO }
  | { ok: false; error: string; status?: ContributionGateStatus };

/** Log one visit. Auth and onboarding refusals stay typed so the shared
 * contribution gate can close the composer. */
export async function postDiaryEntry(
  draft: DiaryDraftInput,
  auth: AccountAuthSnapshot,
): Promise<DiaryPostResult> {
  const res = await accountBoundFetch(auth, "/api/diary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  const body = (await res.json().catch(() => ({}))) as {
    entry?: DiaryEntryDTO;
    error?: unknown;
    status?: unknown;
  };
  if (!res.ok || !body.entry) {
    const status = readContributionGateStatus(body.status);
    return {
      ok: false,
      error: errorMessageFrom(body, "Couldn't log this visit just now."),
      ...(status ? { status } : {}),
    };
  }
  return { ok: true, entry: body.entry };
}
