"use client";

import { useCallback, useRef } from "react";

import { proposeWithTagsForDrop } from "@/components/map/composer/proposeWithTags";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { readProviderAccountRevision } from "@/lib/authProviderRevision";
import { authedActionFetch } from "@/lib/authedFetch";
import { PINT_DROP_STARS_NOT_SAVED } from "@/lib/pintDropRating";
import type { PintDropDTO } from "@/lib/feed";
import {
  RETRY_DETAILS_GONE,
  buildOptimisticSpillRetryFormData,
  emitOptimisticSpillChange,
  failOptimisticSpill,
  markOptimisticSpillRetrying,
  newOptimisticSpillClientId,
  readOptimisticSpills,
  reconcileOptimisticSpill,
  rotateOptimisticSpillRetryKey,
  writeOptimisticSpills,
} from "@/lib/optimisticSpillPost";
import { startPintDropSubmission, transitionPintDropSubmission } from "@/lib/pintDropSubmission";
import { venueMapUrl } from "@/lib/venueMapUrl";

export function useOptimisticSpillRetry() {
  const retriesInFlight = useRef(new Set<string>());
  return useCallback(async (clientRequestId: string) => {
    if (typeof window === "undefined") return;
    if (retriesInFlight.current.has(clientRequestId)) return;
    const writeLocalEntries = (entries: ReturnType<typeof readOptimisticSpills>) => {
      writeOptimisticSpills(window.localStorage, entries);
      emitOptimisticSpillChange();
    };
    const stored = readOptimisticSpills(window.localStorage);
    const entry = stored.find((candidate) => candidate.clientRequestId === clientRequestId);
    if (!entry?.retry) {
      writeLocalEntries(
        failOptimisticSpill(
          stored,
          clientRequestId,
          RETRY_DETAILS_GONE,
        ),
      );
      return;
    }

    const submittedAccountRevision = readProviderAccountRevision();
    let submission = startPintDropSubmission(clientRequestId, submittedAccountRevision);
    let keySpent = false;
    retriesInFlight.current.add(clientRequestId);

    try {
      writeLocalEntries(markOptimisticSpillRetrying(stored, clientRequestId));
      const body = await buildOptimisticSpillRetryFormData(entry.retry);
      if (submittedAccountRevision !== readProviderAccountRevision()) return;
      const response = await authedActionFetch("/api/pint-drops", { method: "POST", body }, { requiresIdentity: true });
      const data = (await response.json().catch(() => ({}))) as {
        drop?: PintDropDTO;
        ratingSaved?: boolean;
        error?: string;
        code?: string;
      };
      if (response.status === 409 && data.code === "IDEMPOTENCY_CONFLICT") {
        keySpent = true;
        throw new Error("An earlier try saved this Spill with other details. Retry to post it as a new one.");
      }
      if (!response.ok || !data.drop) {
        throw new Error(errorMessageFrom(data, "Could not save that Spill."));
      }
      submission = transitionPintDropSubmission(submission, {
        type: "succeeded", requestId: clientRequestId,
        accountRevision: readProviderAccountRevision(), dropId: data.drop.id,
      });
      if (submission.phase !== "saved") return;
      const reconciledDrop: PintDropDTO = {
        ...data.drop,
        venueName: entry.retry.venueName,
        venueMapUrl: venueMapUrl(entry.retry.venueId),
        ...(entry.retry.rating != null &&
          (data.ratingSaved === false || data.drop.rating !== entry.retry.rating)
          ? { optimistic: {
              state: "failed" as const,
              message: PINT_DROP_STARS_NOT_SAVED,
              uploadProgress: null,
              canRetry: false,
              clientRequestId,
            } }
          : {}),
      };
      writeLocalEntries(
        reconcileOptimisticSpill(
          readOptimisticSpills(window.localStorage),
          clientRequestId,
          reconciledDrop,
        ),
      );
      window.localStorage.setItem("pubmax_handle", entry.retry.handle.trim());
      // The tags ride the retry: the first attempt never got a drop id to
      // tag, and proposing is idempotent on drop id plus handle.
      void proposeWithTagsForDrop(data.drop, entry.retry.withHandles ?? []);
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : "Network or storage error. Try again.";
      submission = transitionPintDropSubmission(submission, {
        type: "failed", requestId: clientRequestId,
        accountRevision: readProviderAccountRevision(), message, canRetry: true,
      });
      if (submission.phase !== "failed") return;
      const current = readOptimisticSpills(window.localStorage);
      writeLocalEntries(
        failOptimisticSpill(
          keySpent ? rotateOptimisticSpillRetryKey(current, clientRequestId, newOptimisticSpillClientId()) : current,
          clientRequestId,
          submission.message,
        ),
      );
    } finally {
      retriesInFlight.current.delete(clientRequestId);
    }
  }, []);
}
