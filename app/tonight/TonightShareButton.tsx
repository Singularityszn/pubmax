"use client";

// "Share tonight" affordance (Wave D · D1). Shares the /tonight URL — whose
// crawler card is the D1 OG poster (app/tonight/opengraph-image) — via the
// native share sheet, falling back to clipboard. Fires the D0 `poster_shared`
// signal on a real share/copy. Fail-soft: never throws, and shows a brief
// "Link copied" acknowledgement on the clipboard path.

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

import { trackEvent } from "@/lib/analytics";

export default function TonightShareButton(): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/tonight`;
    const shareData = {
      title: "Tonight in London · PUBMAXXING",
      text: "What's on in London tonight — a grounded, live read.",
      url,
    };
    try {
      const nav = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
      };
      if (typeof nav.share === "function") {
        await nav.share(shareData);
        trackEvent("poster_shared", { surface: "tonight" });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
        trackEvent("poster_shared", { surface: "tonight" });
      }
    } catch {
      // User dismissed the share sheet, or the API is unavailable — no-op.
    }
  }

  return (
    <button
      type="button"
      className="tonightShare pressable"
      onClick={onShare}
      aria-label="Share tonight's listings"
    >
      {copied ? (
        <>
          <Check size={15} aria-hidden="true" />
          Link copied
        </>
      ) : (
        <>
          <Share2 size={15} aria-hidden="true" />
          Share
        </>
      )}
    </button>
  );
}
