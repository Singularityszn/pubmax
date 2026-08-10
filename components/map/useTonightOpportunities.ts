"use client";

// London-only: fetch CityMCP tonight opportunities for the map overlay.
// Fail-soft + React 19 deferred setState (same pattern as TonightNearbyLane).

import { useEffect, useState } from "react";

import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { discardBody } from "@/lib/responseBody";

type ApiResponse = {
  opportunities?: ThingsToDoOpportunity[];
  error?: string;
};

export function useTonightOpportunities(enabled: boolean): {
  opportunities: ThingsToDoOpportunity[];
  status: "idle" | "ready" | "hidden";
} {
  const [opportunities, setOpportunities] = useState<ThingsToDoOpportunity[]>([]);
  const [status, setStatus] = useState<"idle" | "ready" | "hidden">("idle");

  useEffect(() => {
    if (!enabled) {
      Promise.resolve().then(() => {
        setOpportunities([]);
        setStatus("hidden");
      });
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/citymcp/things-to-do?window=tonight&limit=8", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          discardBody(res);
          throw new Error(`HTTP ${res.status}`);
        }
        const body = (await res.json()) as ApiResponse;
        if (controller.signal.aborted) return;
        const ops = Array.isArray(body.opportunities) ? body.opportunities : [];
        Promise.resolve().then(() => {
          if (ops.length === 0) {
            setOpportunities([]);
            setStatus("hidden");
          } else {
            setOpportunities(ops);
            setStatus("ready");
          }
        });
      } catch {
        if (controller.signal.aborted) return;
        Promise.resolve().then(() => {
          setOpportunities([]);
          setStatus("hidden");
        });
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return { opportunities, status };
}
