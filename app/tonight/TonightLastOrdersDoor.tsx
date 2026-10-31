"use client";

// The door to Last orders on /tonight. It is in the prerendered document at
// every hour, so nothing moves the page when the browser wakes up. From 21:30
// London time the door is marked as the night's lead; one tap opens the panel,
// and `?mode=last-orders` opens it at any hour. The panel and its two packs
// load only once it opens, so the page pays nothing for it up front.

import dynamic from "next/dynamic";
import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { isLastOrdersHour } from "@/lib/lastOrdersList";
import type { TonightNear } from "@/lib/tonight";

import { useLiveClock } from "@/lib/useLiveClock";

const TonightLastOrdersPanel = dynamic(() => import("./TonightLastOrdersPanel"), { ssr: false });

const LAST_ORDERS_MODE_PARAM = "last-orders";
const DOOR_TICK_MS = 30_000;

export default function TonightLastOrdersDoor({
  origin,
  near,
  onShareLocation,
  locating,
}: {
  /** The shared position, or null. Only a shared position asks for a train. */
  origin: { lat: number; lng: number } | null;
  /** The point the rest of Tonight orders from (position, then remembered area). */
  near: TonightNear | null;
  /** Tonight's own location request, so there is one ask and one disclosure. */
  onShareLocation: () => void;
  locating: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Focus follows the reader's own taps: opening by tap moves it to the
  // panel's heading, and closing hands it back to this button, so it never
  // falls to <body> with the control it was on.
  const [focusPanel, setFocusPanel] = useState(false);
  const doorRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // `?mode=last-orders` asked for this panel by name, so it is brought into
  // view once it mounts. It sits under the lede, below the first screen.
  const [arrivedByAddress, setArrivedByAddress] = useState(false);
  // A live clock, never one read: a Tonight tab left open from 21:00 must
  // promote the door at 21:30 and quieten it at 04:00, and a tab woken from
  // the background reads the clock again (useLiveClock). Null until after
  // load, because the document is prerendered and its clock is the build's.
  const now = useLiveClock(DOOR_TICK_MS);
  const late = now ? isLastOrdersHour(now) : false;

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (new URLSearchParams(window.location.search).get("mode") === LAST_ORDERS_MODE_PARAM) {
        setOpen(true);
        setArrivedByAddress(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open || !arrivedByAddress) return;
    let frame = 0;
    let tries = 0;
    // The panel is a lazy chunk, so wait for it to exist. "auto" is an
    // instant jump, which reduced motion needs and nobody else minds.
    const seek = () => {
      const panel = document.getElementById("last-orders");
      if (panel) {
        panel.scrollIntoView({ block: "start", behavior: "auto" });
        setArrivedByAddress(false);
      } else if (tries < 120) {
        tries += 1;
        frame = window.requestAnimationFrame(seek);
      }
    };
    frame = window.requestAnimationFrame(seek);
    return () => window.cancelAnimationFrame(frame);
  }, [open, arrivedByAddress]);

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    doorRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div className="lastOrdersDoor">
        <Button
          type="button"
          variant="ghost"
          className="lastOrdersDoorButton uiButton--start"
          ref={doorRef}
          // No aria-controls: the panel it opens is not in the page while
          // closed, and a reference to nothing is worse than none.
          aria-expanded={false}
          onClick={() => {
            setFocusPanel(true);
            setOpen(true);
          }}
          data-late={late ? "true" : undefined}
          data-testid="last-orders-door"
        >
          <Clock size={16} aria-hidden="true" />
          Last orders: who is still open near you
        </Button>
      </div>
    );
  }
  return (
    <TonightLastOrdersPanel
      origin={origin}
      near={near}
      onShareLocation={onShareLocation}
      locating={locating}
      focusOnOpen={focusPanel}
      onClose={() => {
        returnFocus.current = true;
        setFocusPanel(false);
        setOpen(false);
      }}
    />
  );
}
