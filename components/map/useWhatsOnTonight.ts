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

import { coarsenViewerPoint } from "@/lib/geo";
import {
  readSurfaceSnapshot,
  writeSurfaceSnapshot,
} from "@/lib/surfaceDataCache";
import {
  EMPTY_KIND_OBSERVED_AT,
  isValidWhatsOnRow,
  parseKindObservedAt,
  type WhatsOnKindObservedAt,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import {
  summariseWhatsOnByVenue,
  type VenueWhatsOnSummary,
} from "@/lib/whatsOnBadges";

// Honest source freshness (DAG L13 contract). The response separates the request
// instant (servedAt, deliberately NOT surfaced here) from when the SOURCE was
// observed. "unknown" means we have no real source time — the UI must say so,
// never present request time as freshness.
export type TonightFreshnessKind = "provider-observed" | "dataset-generated" | "unknown";

type ApiResponse = {
  rows?: unknown;
  asOf?: string | null;
  sourceObservedAt?: string | null;
  sourceFreshnessKind?: unknown;
  kindObservedAt?: unknown;
  error?: string;
};

function parseFreshnessKind(value: unknown): TonightFreshnessKind {
  return value === "provider-observed" || value === "dataset-generated" ? value : "unknown";
}

export type WhatsOnTonightStatus = "idle" | "ready" | "empty" | "error";

export type WhatsOnTonight = {
  rows: WhatsOnRow[];
  summary: Map<string, VenueWhatsOnSummary>;
  /** Source-observed time (null when unknown). Compatibility alias for asOf; it
   *  is source time, never the request instant. */
  asOf: string | null;
  sourceObservedAt: string | null;
  sourceFreshnessKind: TonightFreshnessKind;
  kindObservedAt: WhatsOnKindObservedAt;
  status: WhatsOnTonightStatus;
  retry: () => void;
};

/** Abort a hung /api/whats-on request after this long — then report "error". */
export const FETCH_TIMEOUT_MS = 8_000;

/**
 * How long a tonight answer may seed a return to the surface that read it.
 *
 * The rows carry their own source-observed time and every reader prints it, so
 * a snapshot cannot misdate itself; the ceiling is about the LIST, not the
 * label — a listing that has since closed should not paint one more time an
 * hour later. Ten minutes is well inside tonight's window and well outside a
 * tab switch.
 */
export const TONIGHT_SNAPSHOT_MAX_AGE_MS = 10 * 60_000;

/** The request this hook makes. Shared so the snapshot is keyed by the answer's own URL. */
export function whatsOnTonightRequestUrl(
  near: { lat: number; lng: number } | null | undefined,
): string {
  const validNear =
    near && Number.isFinite(near.lat) && Number.isFinite(near.lng)
      ? coarsenViewerPoint(near)
      : null;
  const suffix = validNear ? `&near=${validNear.lat},${validNear.lng}` : "";
  return `/api/whats-on?window=tonight&limit=60${suffix}`;
}

export type LoadTonightResult = {
  rows: WhatsOnRow[];
  asOf: string | null;
  sourceObservedAt: string | null;
  sourceFreshnessKind: TonightFreshnessKind;
  kindObservedAt: WhatsOnKindObservedAt;
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
    const res = await fetchImpl(whatsOnTonightRequestUrl(opts.near), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { rows: [], asOf: null, sourceObservedAt: null, sourceFreshnessKind: "unknown", kindObservedAt: EMPTY_KIND_OBSERVED_AT, status: "error" };
    }
    const body = (await res.json()) as ApiResponse;
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      // Preserve any echoed asOf (the error state shows an outage, not a freshness
      // line, so this never surfaces as a check) but the source kind stays unknown.
      const echoed = body.sourceObservedAt ?? body.asOf ?? null;
      return { rows: [], asOf: echoed, sourceObservedAt: echoed, sourceFreshnessKind: "unknown", kindObservedAt: EMPTY_KIND_OBSERVED_AT, status: "error" };
    }
    const rows = Array.isArray(body.rows)
      ? body.rows.filter((r): r is WhatsOnRow => isValidWhatsOnRow(r))
      : [];
    // Prefer the explicit source-observed time; asOf is its compatibility alias.
    const sourceObservedAt = body.sourceObservedAt ?? body.asOf ?? null;
    return {
      rows,
      asOf: sourceObservedAt,
      sourceObservedAt,
      sourceFreshnessKind: parseFreshnessKind(body.sourceFreshnessKind),
      kindObservedAt: parseKindObservedAt(body.kindObservedAt),
      status: rows.length === 0 ? "empty" : "ready",
    };
  } catch {
    // Network failure or timeout abort — an outage, not a quiet night.
    return { rows: [], asOf: null, sourceObservedAt: null, sourceFreshnessKind: "unknown", kindObservedAt: EMPTY_KIND_OBSERVED_AT, status: "error" };
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
  const [sourceFreshnessKind, setSourceFreshnessKind] = useState<TonightFreshnessKind>("unknown");
  const [kindObservedAt, setKindObservedAt] = useState<WhatsOnKindObservedAt>(EMPTY_KIND_OBSERVED_AT);
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
        setSourceFreshnessKind("unknown");
        setKindObservedAt(EMPTY_KIND_OBSERVED_AT);
        setStatus("empty");
      });
      return;
    }
    const controller = new AbortController();
    const near = nearLat != null && nearLng != null ? { lat: nearLat, lng: nearLng } : null;
    const load: LoadTonightOpts = { signal: controller.signal };
    if (near) load.near = near;
    const key = whatsOnTonightRequestUrl(near);

    const apply = (result: LoadTonightResult) => {
      if (controller.signal.aborted) return;
      setRows(result.rows);
      setAsOf(result.asOf);
      setSourceFreshnessKind(result.sourceFreshnessKind);
      setKindObservedAt(result.kindObservedAt ?? EMPTY_KIND_OBSERVED_AT);
      setStatus(result.status);
    };

    // The last answer this browser was given for exactly this request, so a
    // return to Tonight (or to the map lane, which asks the same question)
    // paints the listings it had instead of an empty spine. Deferred by a
    // microtask like the network path, so no setState fires in the effect body.
    let seeded = false;
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      const held = readSurfaceSnapshot<LoadTonightResult>(key, TONIGHT_SNAPSHOT_MAX_AGE_MS);
      if (!held) return;
      seeded = true;
      apply(held);
    });

    void loadWhatsOnTonight(load).then((result) => {
      if (controller.signal.aborted) return;
      void Promise.resolve().then(() => {
        // An outage must never masquerade as a quiet night — but it must not
        // blank real listings the reader is already looking at either. A failed
        // revalidate over a seeded surface leaves the seeded rows standing,
        // dated by their own source time; with nothing seeded it reports the
        // outage exactly as before.
        if (result.status === "error" && seeded) return;
        // Only a real answer is remembered. An error carries no rows, and
        // holding it would hand the next arrival an outage that has passed.
        if (result.status !== "error") writeSurfaceSnapshot(key, result);
        apply(result);
      });
    });
    return () => controller.abort();
  }, [enabled, retryAttempt, nearLat, nearLng]);

  const summary = useMemo(
    () => (rows.length === 0 ? EMPTY_SUMMARY : summariseWhatsOnByVenue(rows)),
    [rows],
  );

  return { rows, summary, asOf, sourceObservedAt: asOf, sourceFreshnessKind, kindObservedAt, status, retry };
}
