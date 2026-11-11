"use client";

import { useEffect, useState } from "react";

import DutyCensusCard from "@/components/census/DutyCensusCard";
import { dutyCensusView, type DutyCensusView } from "@/lib/dutyCensus";

// The census card under a priced log's receipt. It waits for the figure (or
// for the read to fail) and then lands whole, so nothing moves after it does.

const COUNT_WAIT_MS = 2500;

async function readCensusCount(signal: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch("/api/pint-drops/census", { signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const count = (body as { count?: unknown } | null)?.count;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

export default function DutyCensusAfterLog() {
  const [view, setView] = useState<DutyCensusView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), COUNT_WAIT_MS);
    let live = true;
    void readCensusCount(controller.signal).then((count) => {
      window.clearTimeout(timer);
      if (live) setView(dutyCensusView(Date.now(), count));
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return view ? <DutyCensusCard view={view} className="dutyCensus--afterLog" /> : null;
}
