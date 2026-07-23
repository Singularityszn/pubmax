"use client";

// Safe Night strip for Night Mode (U21a). A small, calm safety section that sits
// with the get-home flow. It is not a lecture and not a warning wall: three
// quiet, useful lines a Londoner already half-knows, kept one tap away and
// dismissible for the night. It follows the NightCalm register (see
// app/api/night-calm/route.ts and NightCalmLine): reassuring, plain, never
// fear-mongering, never colours-of-alarm.
//
// Persisted "hide for tonight" lives in sessionStorage (gone next session, kept
// while you browse), keyed per plan id so hiding tonight never suppresses a
// different night. Fully keyboard reachable, 44px targets, 12px+ type,
// reduced-motion safe (the CSS gates its own transition).

import { useEffect, useRef, useState } from "react";
import { LifeBuoy, ChevronDown, Share2, Phone } from "lucide-react";

import { isPlanId } from "@/lib/plan";

const DISMISS_PREFIX = "pubmax:safe-night-dismissed:v1:";

function dismissKey(planId: string): string {
  return `${DISMISS_PREFIX}${planId}`;
}

function hasSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.sessionStorage;
  } catch {
    return false;
  }
}

function readDismissed(planId: string): boolean {
  if (!hasSession() || !isPlanId(planId)) return false;
  try {
    return window.sessionStorage.getItem(dismissKey(planId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(planId: string): void {
  if (!hasSession() || !isPlanId(planId)) return;
  try {
    window.sessionStorage.setItem(dismissKey(planId), "1");
  } catch {
    // ignore
  }
}

export function SafeNightStrip({ planId }: { planId: string }) {
  // This strip only ever mounts inside NightModeCard, which is loaded with
  // next/dynamic ssr:false, so a lazy initializer safely reads the client-only
  // sessionStorage on first render (no SSR pass, no hydration flicker).
  const [dismissed, setDismissed] = useState(() => readDismissed(planId));
  const [open, setOpen] = useState(true);
  const [shareNote, setShareNote] = useState("");

  const shareNoteTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (shareNoteTimer.current) window.clearTimeout(shareNoteTimer.current);
  }, []);

  const flashShareNote = (message: string) => {
    setShareNote(message);
    if (shareNoteTimer.current) window.clearTimeout(shareNoteTimer.current);
    shareNoteTimer.current = window.setTimeout(() => setShareNote(""), 4000);
  };

  const sharePlan = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/plan/${planId}`;
    const shareData = { title: "My night out", text: "Here's where I am tonight.", url };
    const nav = window.navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    try {
      if (typeof nav.share === "function") {
        await nav.share(shareData);
        return;
      }
    } catch {
      // User cancelled the share sheet, or it failed — fall through to copy.
    }
    try {
      await window.navigator.clipboard?.writeText(url);
      flashShareNote("Plan link copied. Send it to someone at home.");
    } catch {
      flashShareNote("Copy the plan link from your browser bar and send it on.");
    }
  };

  if (dismissed) return null;

  return (
    <section className="nightSafe" aria-label="Look after each other">
      <button
        type="button"
        className="nightSafe__head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="nightSafeBody"
      >
        <span className="nightSafe__title">
          <LifeBuoy size={15} aria-hidden="true" />
          Look after each other
        </span>
        <ChevronDown className="nightSafe__chevron" size={16} aria-hidden="true" data-open={open ? "" : undefined} />
      </button>

      {open ? (
        <div className="nightSafe__body" id="nightSafeBody">
          <p className="nightSafe__line">
            Keep an eye on your drink. If you feel suddenly off, tell your mates and the bar staff.
          </p>
          <p className="nightSafe__line">
            <a className="nightSafe__tel" href="tel:999">
              <Phone size={13} aria-hidden="true" /> 999
            </a>{" "}
            for emergencies.{" "}
            <a className="nightSafe__tel" href="tel:116123">
              <Phone size={13} aria-hidden="true" /> 116 123
            </a>{" "}
            for Samaritans, any time.
          </p>
          <p className="nightSafe__line">
            Share your live plan link with someone who is not out tonight.
          </p>

          <div className="nightSafe__actions">
            <button type="button" className="nightSafe__share" onClick={() => void sharePlan()}>
              <Share2 size={15} aria-hidden="true" />
              Share plan link
            </button>
            <button
              type="button"
              className="nightSafe__hide"
              onClick={() => {
                writeDismissed(planId);
                setDismissed(true);
              }}
            >
              Hide for tonight
            </button>
          </div>
          {shareNote ? (
            <p className="nightSafe__note" role="status">{shareNote}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default SafeNightStrip;
