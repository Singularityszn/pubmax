"use client";

import { useEffect, useState } from "react";

import DutyCensusCard from "@/components/census/DutyCensusCard";
import { dutyCensusView, type DutyCensusView } from "@/lib/dutyCensus";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

// The census card under a priced log's receipt. It waits for the figure (or
// for the read to fail) and then lands whole, so nothing moves after it does.

const COUNT_WAIT_MS = 2500;
// The route's own CDN hold: a figure this young is still the figure.
const COUNT_FRESH_MS = 60_000;

type CensusBody = { count: number | null };

function isCensusBody(body: unknown): body is CensusBody {
  if (!body || typeof body !== "object") return false;
  const count = (body as { count?: unknown }).count;
  return count === null || typeof count === "number";
}

export default function DutyCensusAfterLog() {
  const [view, setView] = useState<DutyCensusView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), COUNT_WAIT_MS);
    let live = true;
    let landed = false;
    void loadSurfaceJson<CensusBody>(
      "/api/pint-drops/census",
      { signal: controller.signal, freshForMs: COUNT_FRESH_MS, validate: isCensusBody },
      (body) => {
        landed = true;
        setView(dutyCensusView(Date.now(), body.count));
      },
    ).then(() => {
      window.clearTimeout(timer);
      if (live && !landed) setView(dutyCensusView(Date.now(), null));
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return view ? <DutyCensusCard view={view} className="dutyCensus--afterLog" /> : null;
}
