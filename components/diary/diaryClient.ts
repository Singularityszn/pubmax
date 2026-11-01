"use client";

// Client plumbing for the Diary: the account-bound log write.

import {
  accountBoundFetch,
  type AccountAuthSnapshot,
} from "@/lib/accountBoundFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
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
  /** "Your usual here", private. */
  usualDrink?: string;
  /** The raw "With" field: names stay private, each `@handle` is asked first. */
  withWho?: string;
  /** "Tell your lot": sent only when the owner turned it on for this log. */
  shareToLot?: boolean;
};

export type DiaryPostResult =
  | { ok: true; entry: DiaryEntryDTO; shared: boolean; tagsSent?: boolean }
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
    shared?: unknown;
    tagsSent?: unknown;
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
  return {
    ok: true,
    entry: body.entry,
    shared: body.shared === true,
    ...(typeof body.tagsSent === "boolean" ? { tagsSent: body.tagsSent } : {}),
  };
}

export type DiaryEntryChange = {
  visitedOn?: string;
  rating?: number | null;
  review?: string;
  /** "Your usual here". An empty string clears it. */
  usualDrink?: string;
  /** A raw field whose `@handles` are asked, the same way as on a new log. */
  withAdd?: string;
  /** The ids of tags the owner takes off. */
  withRemove?: string[];
};

export type DiaryChangeResult =
  | { ok: true; entry: DiaryEntryDTO; tagsSent?: boolean }
  | { ok: false; error: string };

/** Correct an entry the account already logged: its day, stars, words or usual. The
 * server finds it by id AND the session's account, so it is never another
 * person's. A day that collides with another log of the same pub answers 409
 * and the line says so. */
export async function updateDiaryEntry(
  id: string,
  change: DiaryEntryChange,
): Promise<DiaryChangeResult> {
  try {
    const res = await authedActionFetch(
      "/api/diary",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, ...change }),
      },
      { requiresIdentity: true },
    );
    const body = (await res.json().catch(() => ({}))) as {
      entry?: DiaryEntryDTO;
      tagsSent?: unknown;
      error?: unknown;
    };
    if (!res.ok || !body.entry) {
      return {
        ok: false,
        error: offlineOrMessage(errorMessageFrom(body, "Couldn't save that change just now.")),
      };
    }
    return {
      ok: true,
      entry: body.entry,
      ...(typeof body.tagsSent === "boolean" ? { tagsSent: body.tagsSent } : {}),
    };
  } catch {
    return { ok: false, error: offlineOrMessage("Couldn't save that change just now.") };
  }
}

/** Remove an entry the account logged. */
export async function deleteDiaryEntry(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await authedActionFetch(
      "/api/diary",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      },
      { requiresIdentity: true },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return {
        ok: false,
        error: offlineOrMessage(errorMessageFrom(body, "Couldn't remove that entry just now.")),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: offlineOrMessage("Couldn't remove that entry just now.") };
  }
}
