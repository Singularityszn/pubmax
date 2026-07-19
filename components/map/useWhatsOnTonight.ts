"use client";

// W1: the map/lane consumer of the PRIMARY What's-On spine (/api/whats-on —
// venueId-joined quiz/sport/deal/music rows on tonight). One fetch, shared by
// the pin-badge join (summariseWhatsOnByVenue) and the Tonight lane. React 19
// deferred setState, mirroring useTonightOpportunities.
//
// Honest failure (round-2 review): as the PRIMARY spine, an outage must not
// masquerade as a quiet night. A non-OK response, a thrown fetch, or a hung
// request (aborted after FETCH_TIMEOUT_MS) all land status "error" — distinct
// from "empty" — so the lane can say "listings unavailable" while pin badges
// simply stay absent.
//
// This is the spine reconciliation in code: whats-on is primary here; the
// CityMCP things-to-do layer (useTonightOpportunities) stays a secondary
// city-events overlay.

import { useCallback, useEffect, useMemo, useState } from "react";

import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";
import {
  summariseWhatsOnByVenue,
  type VenueWhatsOnSummary,
} from "@/lib/whatsOnBadges";

type ApiResponse = { rows?: unknown; asOf?: string | null; error?: string };

export type WhatsOnTonightStatus = "idle" | "ready" | "empty" | "error";

export type WhatsOnTonight = {
  rows: WhatsOnRow[];
  summary: Map<string, VenueWhatsOnSummary>;
  asOf: string | null;
  status: WhatsOnTonightStatus;
  retry: () => void;
};

/** Abort a hung /api/whats-on request after this long — then report "error". */
export const FETCH_TIMEOUT_MS = 8_000;

export type LoadTonightResult = {
  rows: WhatsOnRow[];
  asOf: string | null;
  status: "ready" | "empty" | "error";
};

export type LoadTonightOpts = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** External abort (unmount). Timeout aborts are internal and map to "error". */
  signal?: AbortSignal;
  /** Order rows by nearness to this point (the store sorts server-side).
   *  Omitted = the store's own order, exactly as before. */
  near?: { lat: number; lng: number } | null;
};

/**
 * Fetch + validate tonight's whats-on rows. Injectable so the error and
 * timeout paths are unit-testable without React. Never throws: failures
 * (non-OK, network throw, timeout) return status "error"; an OK response with
 * zero valid rows returns "empty".
 */
export async function loadWhatsOnTonight(
  opts: LoadTonightOpts = {},
): Promise<LoadTonightResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const near =
      opts.near && Number.isFinite(opts.near.lat) && Number.isFinite(opts.near.lng)
        ? `&near=${opts.near.lat},${opts.near.lng}`
        : "";
    const res = await fetchImpl(`/api/whats-on?window=tonight&limit=60${near}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { rows: [], asOf: null, status: "error" };
    const body = (await res.json()) as ApiResponse;
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return { rows: [], asOf: body.asOf ?? null, status: "error" };
    }
    const rows = Array.isArray(body.rows)
      ? body.rows.filter((r): r is WhatsOnRow => isValidWhatsOnRow(r))
      : [];
    return {
      rows,
      asOf: body.asOf ?? null,
      status: rows.length === 0 ? "empty" : "ready",
    };
  } catch {
    // Network failure or timeout abort — an outage, not a quiet night.
    return { rows: [], asOf: null, status: "error" };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

const EMPTY_SUMMARY = new Map<string, VenueWhatsOnSummary>();

export function useWhatsOnTonight(
  enabled: boolean,
  near: { lat: number; lng: number } | null = null,
): WhatsOnTonight {
  const [rows, setRows] = useState<WhatsOnRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [status, setStatus] = useState<WhatsOnTonightStatus>("idle");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retry = useCallback(() => {
    setStatus("idle");
    setRetryAttempt((attempt) => attempt + 1);
  }, []);

  // Depend on the coordinate VALUES, not the object identity, so a caller
  // passing a fresh literal each render doesn't refetch in a loop.
  const nearLat = near?.lat ?? null;
  const nearLng = near?.lng ?? null;

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
    const load: LoadTonightOpts = { signal: controller.signal };
    if (nearLat != null && nearLng != null) load.near = { lat: nearLat, lng: nearLng };
    void loadWhatsOnTonight(load).then((result) => {
      if (controller.signal.aborted) return;
      void Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        setRows(result.rows);
        setAsOf(result.asOf);
        setStatus(result.status);
      });
    });
    return () => controller.abort();
  }, [enabled, retryAttempt, nearLat, nearLng]);

  const summary = useMemo(
    () => (rows.length === 0 ? EMPTY_SUMMARY : summariseWhatsOnByVenue(rows)),
    [rows],
  );

  return { rows, summary, asOf, status, retry };
}
