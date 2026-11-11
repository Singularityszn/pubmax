"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import PintReceiptPaper from "@/components/pintdrop/PintReceiptPaper";
import type { ReceiptShare } from "@/lib/pintReceipt";

import "./receiptShareStep.css";

// "Share your receipt": the step right after Log it (lib/pintReceipt.ts decides
// which saved drops may offer it). The receipt prints out of the success line,
// and one secondary button sends its link through the OS share sheet, or copies
// it where there is no sheet. The share code loads on tap.

type Status = { tone: "ok" | "error"; text: string } | null;

const SHARE_FAILED = "Couldn't share that. Open the receipt and copy its link.";

export default function ReceiptShareStep({ share }: { share: ReceiptShare }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const onShare = useCallback(async () => {
    setStatus(null);
    setBusy(true);
    try {
      const { shareReceipt } = await import("@/lib/pintShareAction");
      const outcome = await shareReceipt(share);
      if (outcome === "copied") setStatus({ tone: "ok", text: "Link copied. Paste it anywhere." });
      else if (outcome === "failed") setStatus({ tone: "error", text: SHARE_FAILED });
    } catch {
      setStatus({ tone: "error", text: SHARE_FAILED });
    } finally {
      setBusy(false);
    }
  }, [share]);

  return (
    <div className="receiptShareStep">
      <div className="receiptShareStep__counter">
        <PintReceiptPaper receipt={share.receipt} variant="stub" />
      </div>
      <div className="receiptShareStep__actions">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void onShare();
          }}
        >
          <Share2 size={16} aria-hidden="true" />
          Share your receipt
        </Button>
        <Link className="receiptShareStep__open" href={share.path}>
          Open the receipt
        </Link>
      </div>
      {status ? (
        <p
          className={`receiptShareStep__status receiptShareStep__status--${status.tone}`}
          role={status.tone === "error" ? "alert" : "status"}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
