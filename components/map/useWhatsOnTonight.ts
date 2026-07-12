"use client";

// W1: the map/lane consumer of the PRIMARY What's-On spine (/api/whats-on —
// venueId-joined quiz/sport/deal/music rows on tonight). One fetch, shared by
// the pin-badge join (summariseWhatsOnByVenue) and the Tonight lane. Fail-soft
// + React 19 deferred setState, mirroring useTonightOpportunities.
//
// This is the spine reconciliation in code: whats-on is primary here; the
// CityMCP things-to-do layer (useTonightOpportunities) stays a secondary
// city-events overlay.

import { useEffect, useMemo, useState } from "react";

import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";
import {
  summariseWhatsOnByVenue,
  type VenueWhatsOnSummary,
} from "@/lib/whatsOnBadges";

type ApiResponse = { rows?: unknown; asOf?: string | null; error?: string };

export type WhatsOnTonight = {
  rows: WhatsOnRow[];
  summary: Map<string, VenueWhatsOnSummary>;
  asOf: string | null;
  status: "idle" | "ready" | "empty";
};

const EMPTY_SUMMARY = new Map<string, VenueWhatsOnSummary>();

export function useWhatsOnTonight(enabled: boolean): WhatsOnTonight {
  const [rows, setRows] = useState<WhatsOnRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ready" | "empty">("idle");

  useEffect(() => {
    if (!enabled) {
      void Promise.resolve().then(() => {
        setRows([]);
        setAsOf(null);
        setStatus("empty");
      });
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/whats-on?window=tonight&limit=60", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as ApiResponse;
        if (controller.signal.aborted) return;
        const list = Array.isArray(body.rows)
          ? body.rows.filter((r): r is WhatsOnRow => isValidWhatsOnRow(r))
          : [];
        void Promise.resolve().then(() => {
          if (controller.signal.aborted) return;
          setRows(list);
          setAsOf(body.asOf ?? null);
          setStatus(list.length === 0 ? "empty" : "ready");
        });
      } catch {
        if (controller.signal.aborted) return;
        void Promise.resolve().then(() => {
          setRows([]);
          setAsOf(null);
          setStatus("empty");
        });
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  const summary = useMemo(
    () => (rows.length === 0 ? EMPTY_SUMMARY : summariseWhatsOnByVenue(rows)),
    [rows],
  );

  return { rows, summary, asOf, status };
}
