"use client";

import { offlineOrMessage } from "@/lib/apiErrorMessage";

import { Copy, Users, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  clearActiveRoundCode,
  readActiveRoundCode,
  subscribeActiveRound,
} from "@/lib/activeRound";
import { discardBody } from "@/lib/responseBody";
import { subscribeVisiblePolling } from "@/lib/visiblePolling";

import "./activeRoundChip.css";

const POLL_MS = 15_000;

type RoundPollBody = {
  round?: { closedAt?: string | null };
  error?: string;
};

type ActiveRoundChipProps = {
  /** Bump from parent when a Round just started so the chip lights without waiting on storage events. */
  refreshKey?: string | number | null;
};

/**
 * Persistent map chrome for tonight's active Round — code, copy, board link.
 * Polls lightly; clears storage and hides when the Round is gone or closed.
 */
export default function ActiveRoundChip({
  refreshKey = null,
}: ActiveRoundChipProps): React.JSX.Element | null {
  const [code, setCode] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  const syncFromStorage = useCallback(() => {
    setCode(readActiveRoundCode());
  }, []);

  useEffect(() => {
    // Defer out of the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      syncFromStorage();
    });
    const unsubscribe = subscribeActiveRound(() => {
      setDismissed(false);
      syncFromStorage();
    });
    return unsubscribe;
  }, [syncFromStorage]);

  // Parent bump after Start Round — re-read immediately + un-dismiss.
  useEffect(() => {
    if (refreshKey == null || refreshKey === "") return;
    void Promise.resolve().then(() => {
      setDismissed(false);
      syncFromStorage();
    });
  }, [refreshKey, syncFromStorage]);

  useEffect(() => {
    if (!code || dismissed) return;
    let cancelled = false;
    let pending: AbortController | null = null;

    async function poll() {
      if (cancelled || document.visibilityState === "hidden") return;
      if (pending && !pending.signal.aborted) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const res = await fetch(`/api/rounds/${code}`, { cache: "no-store", signal: controller.signal });
        if (cancelled || controller.signal.aborted || pending !== controller) {
          discardBody(res);
          return;
        }
        if (res.status === 404) {
          discardBody(res);
          clearActiveRoundCode(code);
          syncFromStorage();
          return;
        }
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as RoundPollBody;
        if (cancelled || controller.signal.aborted || pending !== controller) return;
        if (body.round?.closedAt) {
          clearActiveRoundCode(code);
          syncFromStorage();
        }
      } catch {
        // Network blip — keep showing; next poll retries.
      } finally {
        if (pending === controller) pending = null;
      }
    }

    const stop = subscribeVisiblePolling(() => void poll(), POLL_MS, () => pending?.abort());
    return () => {
      cancelled = true;
      stop();
    };
  }, [code, dismissed, syncFromStorage]);

  async function copyCode() {
    if (!code) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(
        offlineOrMessage("Could not copy link. Try again.")
      );
    }
  }

  function dismiss() {
    setDismissed(true);
  }

  if (!code || dismissed) return null;

  return (
    <div className="activeRoundChip" role="status" aria-live="polite" data-testid="active-round-chip">
      <Users size={16} aria-hidden="true" />
      <div>
        <strong>Tonight&apos;s Round</strong>
        <span>{code}</span>
      </div>
      <button type="button" onClick={() => void copyCode()} aria-label="Copy Round code">
        <Copy size={14} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
      </button>
      {copyError ? <span role="status">{copyError}</span> : null}
      <Link href={`/rounds/${code}`} className="activeRoundChipBoard">
        Board
      </Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss Round chip">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
