"use client";

import { useCallback, useState } from "react";
import { Share2 } from "lucide-react";

import { PINT_SHARE_LABEL, type PintShare } from "@/lib/pintShare";

// The ghost text button's own sheet, worn as the primitive renders it
// (`uiButton uiButton--ghost`), without pulling the primitive's class-merging
// helpers into /near for one button.
import "@/components/ui/button.css";
import "./sharePint.css";

// "Share this pint": ONE quiet action beside a listed pint (lib/pintShare.ts).
// The caller only renders it with a `PintShare`, which exists only when the
// price, its publisher and its read day are all known, so the button cannot
// share a figure without its source. The share itself (OS sheet, then the
// clipboard) is loaded on tap, so the surface pays for a button and no more.

type Status = { tone: "ok" | "error"; text: string } | null;

export default function SharePintButton({
  share,
  className,
}: {
  share: PintShare;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const onShare = useCallback(async () => {
    setStatus(null);
    setBusy(true);
    try {
      const { sharePint } = await import("@/lib/pintShareAction");
      const outcome = await sharePint(share);
      if (outcome === "copied") {
        setStatus({ tone: "ok", text: "Link copied, with the price and who listed it." });
      } else if (outcome === "failed") {
        setStatus({ tone: "error", text: "Couldn't share that. Copy the link from your browser bar." });
      }
    } catch {
      setStatus({ tone: "error", text: "Couldn't share that. Copy the link from your browser bar." });
    } finally {
      setBusy(false);
    }
  }, [share]);

  return (
    <span className={`sharePint${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="uiButton uiButton--ghost sharePintButton"
        aria-label={`${PINT_SHARE_LABEL} at ${share.name}`}
        disabled={busy}
        onClick={() => {
          void onShare();
        }}
      >
        <Share2 size={14} aria-hidden="true" />
        {PINT_SHARE_LABEL}
      </button>
      {status ? (
        <span
          className={`sharePintStatus sharePintStatus--${status.tone}`}
          role={status.tone === "error" ? "alert" : "status"}
        >
          {status.text}
        </span>
      ) : null}
    </span>
  );
}
