"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { fairPence } from "@/lib/fairPintPricing";
import type FairPintMap from "./FairPintMap";
import { waitForFairPintRelease } from "./FairPintBridge";

export default function FairPintMapLoader({ loading, ...props }: Omit<ComponentProps<typeof FairPintMap>, "priceReader"> & { loading: ReactNode }) {
  const [Map, setMap] = useState<typeof FairPintMap | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        await waitForFairPintRelease();
        if (cancelled) return;
        const module = await import("./FairPintMap");
        if (!cancelled) setMap(() => module.default);
      })()
        .catch(() => { if (!cancelled) setFailed(true); });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [attempt]);
  if (Map) return <Map {...props} priceReader={fairPence} />;
  return <>{loading}{failed ? (
    <aside className="fairPintCard" role="alert">
      <p>Could not load the map. Your fair pint is still here.</p>
      <button type="button" onClick={() => { setFailed(false); setAttempt((held) => held + 1); }}>Retry loading map</button>
      <button type="button" onClick={() => {
        document.querySelector<HTMLElement>('[data-fair-prelude] [aria-label="Close"]')?.click();
        setFailed(false);
        setAttempt((held) => held + 1);
      }}>Close</button>
    </aside>
  ) : null}</>;
}
