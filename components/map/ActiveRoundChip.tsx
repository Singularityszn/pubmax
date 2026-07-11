"use client";

import { Copy, Users, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  clearActiveRoundCode,
  readActiveRoundCode,
  subscribeActiveRound,
} from "@/lib/activeRound";

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
    if (!code) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/rounds/${code}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          clearActiveRoundCode(code);
          setCode("");
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as RoundPollBody;
        if (body.round?.closedAt) {
          clearActiveRoundCode(code);
          setCode("");
        }
      } catch {
        // Network blip — keep showing; next poll retries.
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [code]);

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — code remains visible.
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
      <Link href={`/rounds/${code}`} className="activeRoundChipBoard">
        Board
      </Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss Round chip">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
