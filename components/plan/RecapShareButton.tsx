"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { trackEvent } from "@/lib/analytics";

// The recap share affordance — deliberately two-state and approval-gated.
//
//   • No `shareUrl` (the PRIVATE crew recap): there is nothing public to share
//     yet. A night can only leave the crew through the existing Night Story
//     consent flow — where every person approves their own photos and identity
//     first. So this renders a route INTO that flow, never a public link. We
//     never leak an unapproved recap.
//
//   • `shareUrl` present (the PUBLIC recap, which exists only AFTER approval and
//     publication): the WhatsApp-native share is unlocked, pointing at that
//     already-approved URL.
//
// React 19 hygiene: the "Copied" flash is set in the click handler and cleared
// from a setTimeout in a ref — never from an effect body.

type RecapShareButtonProps = {
  planId: string;
  // WhatsApp-first one-liner (from lib/recapView buildRecapShareText).
  shareText: string;
  // Absolute or relative URL of the APPROVED public recap. Absent until the
  // crew has published a Night Story — which is what gates the share.
  shareUrl?: string;
};

function toAbsoluteUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

// wa.me href — text first, absolute url appended. Mirrors lib/shareArtifacts.ts
// whatsappShareHref (#314, unmerged on main). REBASE-BY-INTENT: when #314 lands,
// import that helper here and delete this local copy.
function whatsappHref(text: string, absolute: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${absolute}`)}`;
}

export default function RecapShareButton({ planId, shareText, shareUrl }: RecapShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canNativeShare] = useState(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  );

  const flashCopied = useCallback(() => {
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setCopied(false);
      resetTimer.current = null;
    }, 2000);
  }, []);

  const handleNativeShare = useCallback(async () => {
    if (!shareUrl) return;
    const absolute = toAbsoluteUrl(shareUrl);
    try {
      await navigator.share({ text: shareText, url: absolute });
      trackEvent("recap_shared", { channel: "native", planId });
    } catch {
      // Sheet cancelled — sharing is a soft action, no error state.
    }
  }, [shareUrl, shareText, planId]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    const absolute = toAbsoluteUrl(shareUrl);
    try {
      await navigator.clipboard.writeText(absolute);
    } catch {
      // Clipboard denied — the link is still in the address bar.
    }
    trackEvent("recap_shared", { channel: "copy", planId });
    flashCopied();
  }, [shareUrl, planId, flashCopied]);

  // ── Pre-approval: the gateway into the consent flow, never a public link. ───
  if (!shareUrl) {
    return (
      <div className="recapShare recapShare--gated">
        <Link
          className="recapShare__cta"
          href="/u/you#night-memories"
          onClick={() => trackEvent("recap_share_gate_opened", { planId })}
        >
          Turn this into a shareable night
        </Link>
        <p className="recapShare__note type-meta">
          Private to your crew for now. Everyone approves their own photos before a recap can be shared.
        </p>
      </div>
    );
  }

  // ── Post-approval: the WhatsApp-native share of the approved public recap. ──
  return (
    <div className="recapShare" role="group" aria-label="Share this recap">
      <a
        className="recapShare__cta"
        href={whatsappHref(shareText, shareUrl)}
        onClick={(event) => {
          event.preventDefault();
          trackEvent("recap_shared", { channel: "whatsapp", planId });
          window.open(whatsappHref(shareText, toAbsoluteUrl(shareUrl)), "_blank", "noopener,noreferrer");
        }}
        target="_blank"
        rel="noreferrer"
      >
        Send on WhatsApp
      </a>
      {canNativeShare ? (
        <button type="button" className="recapShare__btn" onClick={handleNativeShare}>
          Share&hellip;
        </button>
      ) : null}
      <button type="button" className="recapShare__btn" onClick={handleCopy} aria-label={copied ? "Link copied" : "Copy link"}>
        {copied ? "Copied" : "Copy link"}
      </button>
      <span className="recapShare__confirm" role="status" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
}
