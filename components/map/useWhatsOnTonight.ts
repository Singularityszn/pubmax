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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { coarsenViewerPoint } from "@/lib/geo";
import {
  loadSurfaceJson,
  SURFACE_JUST_READ_MS,
} from "@/lib/surfaceDataCache";
import {
  EMPTY_KIND_OBSERVED_AT,
  isValidWhatsOnRow,
  londonServiceDayBounds,
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
  servedAt?: unknown;
  asOf?: string | null;
  sourceObservedAt?: string | null;
  sourceFreshnessKind?: unknown;
  kindObservedAt?: unknown;
  error?: string;
};

function parseFreshnessKind(value: unknown): TonightFreshnessKind {
  return value === "provider-observed" || value === "dataset-generated" ? value : "unknown";
}

type WhatsOnTonightStatus = "idle" | "ready" | "empty" | "error";

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
const FETCH_TIMEOUT_MS = 8_000;

/**
 * How long a tonight answer may seed a return to the surface that read it.
 *
 * The rows carry their own source-observed time and every reader prints it, so
 * a snapshot cannot misdate itself; the ceiling is about the LIST, not the
 * label — a listing that has since closed should not paint one more time an
 * hour later. Ten minutes is well inside tonight's window and well outside a
 * tab switch.
 */
const TONIGHT_SNAPSHOT_MAX_AGE_MS = 10 * 60_000;
/** Public lists may reuse an answer for one minute. Location reads revalidate sooner. */
const PUBLIC_TONIGHT_FRESH_MS = 60_000;

/** The request this hook makes. Shared so the snapshot is keyed by the answer's own URL. */
function whatsOnTonightRequestUrl(
  near: { lat: number; lng: number } | null | undefined,
  pubOnly = false,
): string {
  const validNear =
    near && Number.isFinite(near.lat) && Number.isFinite(near.lng)
      ? coarsenViewerPoint(near)
      : null;
  const suffix = validNear ? `&near=${validNear.lat},${validNear.lng}` : "";
  return `/api/whats-on?window=tonight&limit=60${suffix}${pubOnly ? "&pubOnly=1" : ""}`;
}

function tonightRollover(): number {
  const now = Date.now();
  const { start } = londonServiceDayBounds(now);
  // The current window starts at 16:00. An instant one day before that start
  // is inside the previous service date, even on a clock-change day. Resolve
  // that date's 04:00 end independently rather than assuming a 24-hour day.
  const previousWindow = londonServiceDayBounds(Date.parse(start) - 24 * 60 * 60_000);
  return Date.parse(previousWindow.end);
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
  maxAgeMs?: number;
  pubOnly?: boolean;
  /** Explicit retry bypasses both the snapshot and an older pending request. */
  fresh?: boolean;
  onResult?: (result: LoadTonightResult, source: "snapshot" | "network") => void;
};

function fetchWithTimeout(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const outerSignal = init?.signal;
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
    };
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if (!response.ok) {
        cleanup();
        return response;
      }
      // Fetch resolves at headers. Keep abort and timeout active until JSON finishes.
      const readJson = response.json.bind(response);
      response.json = async () => {
        try {
          return await readJson();
        } finally {
          cleanup();
        }
      };
      return response;
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}

/**
 * Fetch + validate tonight's whats-on rows. Injectable so the error and
 * timeout paths are unit-testable without React. Never throws: failures
 * (non-OK, network throw, timeout) return status "error"; an OK response with
 * zero valid rows returns "empty".
 */
export async function loadWhatsOnTonight(
  opts: LoadTonightOpts = {},
): Promise<LoadTonightResult> {
  let result: LoadTonightResult = {
    rows: [],
    asOf: null,
    sourceObservedAt: null,
    sourceFreshnessKind: "unknown",
    kindObservedAt: EMPTY_KIND_OBSERVED_AT,
    status: "error",
  };
  const fetchImpl = fetchWithTimeout(
    opts.fetchImpl ?? fetch,
    opts.timeoutMs ?? FETCH_TIMEOUT_MS,
  );
  await loadSurfaceJson<ApiResponse>(
    whatsOnTonightRequestUrl(opts.near, opts.pubOnly === true),
    {
      signal: opts.signal,
      maxAgeMs: opts.fresh ? -1 : opts.maxAgeMs,
      requestNotBefore: tonightRollover(),
      fresh: opts.fresh,
      freshForMs: opts.near ? SURFACE_JUST_READ_MS : PUBLIC_TONIGHT_FRESH_MS,
      init: { headers: { accept: "application/json" } },
      fetchImpl,
      validate: (body) => {
        if (!body || typeof body !== "object" || !Array.isArray(body.rows)) return false;
        if (typeof body.error === "string" && body.error.trim().length > 0) return true;
        const servedAt = typeof body.servedAt === "string" ? Date.parse(body.servedAt) : NaN;
        return Number.isFinite(servedAt) &&
          londonServiceDayBounds(servedAt).start === londonServiceDayBounds().start;
      },
    },
    (body, source) => {
      if (typeof body.error === "string" && body.error.trim().length > 0) {
        // Preserve any echoed asOf (the error state shows an outage, not a freshness
        // line, so this never surfaces as a check) but keep it out of last-good memory.
        const echoed = body.sourceObservedAt ?? body.asOf ?? null;
        result = {
          rows: [],
          asOf: echoed,
          sourceObservedAt: echoed,
          sourceFreshnessKind: "unknown",
          kindObservedAt: EMPTY_KIND_OBSERVED_AT,
          status: "error",
        };
        opts.onResult?.(result, source);
        return false;
      }
      const rows = (Array.isArray(body.rows) ? body.rows : [])
        .filter((r): r is WhatsOnRow => isValidWhatsOnRow(r));
      const sourceObservedAt = body.sourceObservedAt ?? body.asOf ?? null;
      result = {
        rows,
        asOf: sourceObservedAt,
        sourceObservedAt,
        sourceFreshnessKind: parseFreshnessKind(body.sourceFreshnessKind),
        kindObservedAt: parseKindObservedAt(body.kindObservedAt),
        status: rows.length === 0 ? "empty" : "ready",
      };
      opts.onResult?.(result, source);
    },
  );
  return result;
}

const EMPTY_SUMMARY = new Map<string, VenueWhatsOnSummary>();

export function useWhatsOnTonight(
  enabled: boolean,
  near: { lat: number; lng: number } | null = null,
  options: { pubOnly?: boolean } = {},
): WhatsOnTonight {
  const [rows, setRows] = useState<WhatsOnRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [sourceFreshnessKind, setSourceFreshnessKind] = useState<TonightFreshnessKind>("unknown");
  const [kindObservedAt, setKindObservedAt] = useState<WhatsOnKindObservedAt>(EMPTY_KIND_OBSERVED_AT);
  const [status, setStatus] = useState<WhatsOnTonightStatus>("idle");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const lastRetryAttempt = useRef(0);
  const retry = useCallback(() => {
    setStatus("idle");
    setRetryAttempt((attempt) => attempt + 1);
  }, []);

  // Depend on the coordinate VALUES, not the object identity, so a caller
  // passing a fresh literal each render doesn't refetch in a loop.
  const nearLat = near?.lat ?? null;
  const nearLng = near?.lng ?? null;
  const pubOnly = options.pubOnly === true;

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
    const load: LoadTonightOpts = {
      signal: controller.signal,
      maxAgeMs: TONIGHT_SNAPSHOT_MAX_AGE_MS,
      pubOnly,
      fresh: retryAttempt !== lastRetryAttempt.current,
    };
    lastRetryAttempt.current = retryAttempt;
    if (near) load.near = near;
    let painted = false;
    load.onResult = (result, source) => {
      if (controller.signal.aborted) return;
      if (result.status === "error" && painted && source === "network") return;
      painted = true;
      setRows(result.rows);
      setAsOf(result.asOf);
      setSourceFreshnessKind(result.sourceFreshnessKind);
      setKindObservedAt(result.kindObservedAt ?? EMPTY_KIND_OBSERVED_AT);
      setStatus(result.status);
    };

    void loadWhatsOnTonight(load).then((result) => {
      if (controller.signal.aborted || painted) return;
      setRows(result.rows);
      setAsOf(result.asOf);
      setSourceFreshnessKind(result.sourceFreshnessKind);
      setKindObservedAt(result.kindObservedAt ?? EMPTY_KIND_OBSERVED_AT);
      setStatus(result.status);
    });
    return () => controller.abort();
  }, [enabled, retryAttempt, nearLat, nearLng, pubOnly]);

  const summary = useMemo(
    () => (rows.length === 0 ? EMPTY_SUMMARY : summariseWhatsOnByVenue(rows)),
    [rows],
  );

  return { rows, summary, asOf, sourceObservedAt: asOf, sourceFreshnessKind, kindObservedAt, status, retry };
}
