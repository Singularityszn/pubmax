"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  validateCommunityPrice,
  type CommunityPrice,
  type CommunityPriceMapCandidate,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";
import type { PriceSubmitFailureReason } from "@/lib/analyticsEvents";

// Client-side owner of /api/price-submit: the freshest community price per
// (venue, drink category), the optimistic restamp, and the submit call.
//
// The restamp is the whole point of the loop - the map change YOU caused,
// visible immediately. So a submission lands in local state BEFORE the network
// round-trip, and PubMap folds this map into the venueSignals it already hands
// to the pins, the venue list, and the sheet. One merge, every surface
// restamps; the map canvas needs no change at all.
//
// Honest optimism: an optimistic entry is stamped with the device clock and
// replaced by the server's authoritative record when the POST lands. A REJECTED
// submission is rolled back to whatever was showing before, so a bounced price
// never lingers on the map as if it were real.
//
// The restamp is the SHEET's, not necessarily the map's. Since the trust wave a
// price only recolours pins once a second independent submitter agrees, and
// only the server can count that, so an optimistic entry claims the cautious
// `corroborations: 1` and the POST response supplies the real number. Claiming
// more locally would flash a pin colour the server is about to take back.

export type CommunityPriceSubmitResult =
  | { ok: true }
  // `reason` is the coarse funnel bucket for the failure - the analytics enum,
  // not a second copy of the sentence. `error` stays the human sentence and is
  // never sent anywhere.
  | { ok: false; error: string; reason: PriceSubmitFailureReason };

export type CommunityPricesState = {
  /** Freshest community price per drink category, by venue id. Ungated on
   *  purpose - this is what the venue sheet renders, so every submission shows
   *  there, dated, whether or not it has earned the map. */
  byVenueId: Map<string, CommunityPrice[]>;
  /** The freshest BEER price at a venue - the pin's CANDIDATE, not its verdict.
   *  Pins and the list are pint-priced surfaces, so other categories never
   *  reach them; they render on the sheet's own dated rows instead. Whether a
   *  candidate actually restamps is decided by the trust gate in
   *  mergeCommunityPriceSignals, the single seam onto the map. */
  freshestByVenueId: Map<string, CommunityPrice>;
  /** Fetch the community prices on record for one venue (fail-soft, once per id). */
  loadVenue: (venueId: string) => void;
  /** Log tonight's price. Restamps optimistically, rolls back on rejection. */
  submit: (input: {
    venueId: string;
    drinkCategory: DrinkCategory;
    priceGbp: string | number;
  }) => Promise<CommunityPriceSubmitResult>;
  /** True while a submission is in flight (one at a time by construction). */
  submitting: boolean;
  /**
   * Flag one observation for a human to look at. Unlike the Pint Drop report,
   * this does NOT remove the row locally: a community price is not hidden until
   * a moderator hides it (a client-side vanish would promise a takedown that
   * has not happened). The row is marked reported instead, so the reader can
   * see their tap landed.
   */
  reportPrice: (id: string) => void;
  /** Observation ids this device has already flagged this session. */
  reportedIds: ReadonlySet<string>;
};

/** Freshest-wins merge of one observation into a venue's per-category list. */
export function upsertPrice(rows: CommunityPrice[], next: CommunityPrice): CommunityPrice[] {
  const current = rows.find((row) => row.drinkCategory === next.drinkCategory);
  const freshest =
    current && current.submittedAt > next.submittedAt ? current : next;
  const others = rows.filter((row) => row.drinkCategory !== next.drinkCategory);
  return [freshest, ...others].sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * Unconditional replace of one category's row — for adopting the server's
 * authoritative POST response. upsertPrice's keep-newer rule guards the GET
 * merge against stale reads, but it would also let a device clock that ran
 * ahead of the server keep the optimistic stamp forever; the server record
 * for a category always wins here.
 */
export function replacePrice(rows: CommunityPrice[], next: CommunityPrice): CommunityPrice[] {
  const others = rows.filter((row) => row.drinkCategory !== next.drinkCategory);
  return [next, ...others].sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * Narrow an untrusted candidate object to one the map may consult. The same
 * caution as `corroborations` below: a malformed candidate reads as absent,
 * and an absent candidate falls back to the row itself, which cannot claim
 * more trust than the row carries.
 */
function readMapCandidate(value: unknown): CommunityPriceMapCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<CommunityPriceMapCandidate>;
  if (typeof candidate.priceGbp !== "number" || !Number.isFinite(candidate.priceGbp)) {
    return undefined;
  }
  if (typeof candidate.submittedAt !== "number" || !Number.isFinite(candidate.submittedAt)) {
    return undefined;
  }
  return {
    priceGbp: candidate.priceGbp,
    submittedAt: candidate.submittedAt,
    corroborations:
      typeof candidate.corroborations === "number" && Number.isFinite(candidate.corroborations)
        ? Math.max(1, Math.floor(candidate.corroborations))
        : 1,
  };
}

/** Narrow an untrusted API payload to the prices we can honestly render. */
function readPrices(value: unknown): CommunityPrice[] | null {
  if (!value || typeof value !== "object") return null;
  const rows = (value as { prices?: unknown }).prices;
  if (!Array.isArray(rows)) return null;
  const out: CommunityPrice[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const price = row as Partial<CommunityPrice>;
    if (typeof price.priceGbp !== "number" || !Number.isFinite(price.priceGbp)) continue;
    if (typeof price.submittedAt !== "number" || !Number.isFinite(price.submittedAt)) continue;
    if (typeof price.drinkCategory !== "string" || typeof price.venueId !== "string") continue;
    out.push({
      // Present from the server, absent on an older payload - and an absent id
      // simply means the row carries no report affordance, never that a
      // fabricated one is invented for it.
      ...(typeof price.id === "string" && price.id !== "" ? { id: price.id } : {}),
      venueId: price.venueId,
      drinkCategory: price.drinkCategory as DrinkCategory,
      priceGbp: price.priceGbp,
      submittedAt: price.submittedAt,
      source: "community",
      // The trust count is the server's to state. A missing or nonsensical
      // value reads as the cautious 1, never as "corroborated" - a payload we
      // can't trust must not be able to talk its way onto the map.
      corroborations:
        typeof price.corroborations === "number" && Number.isFinite(price.corroborations)
          ? Math.max(1, Math.floor(price.corroborations))
          : 1,
      mapCandidate: readMapCandidate(price.mapCandidate),
    });
  }
  return rows.length > 0 && out.length === 0 ? null : out;
}

export type VenuePriceLoad =
  | { status: "ready"; prices: CommunityPrice[] }
  | { status: "degraded"; prices: CommunityPrice[] }
  | { status: "invalid"; prices: [] };

export function readVenuePriceLoad(value: unknown): VenuePriceLoad {
  const prices = readPrices(value);
  if (!prices) return { status: "invalid", prices: [] };
  if ((value as { degraded?: unknown }).degraded === true) {
    return { status: "degraded", prices };
  }
  return { status: "ready", prices };
}

function sameObservation(left: CommunityPrice, right: CommunityPrice): boolean {
  return (
    left.venueId === right.venueId &&
    left.drinkCategory === right.drinkCategory &&
    left.priceGbp === right.priceGbp &&
    left.submittedAt === right.submittedAt &&
    left.source === right.source
  );
}

export function rollbackOptimisticPrice(
  current: CommunityPrice[] | undefined,
  optimistic: CommunityPrice,
  loaded: CommunityPrice[] | undefined,
  loadedIsKnown: boolean,
): CommunityPrice[] | undefined {
  const withoutOptimistic = (current ?? []).filter(
    (row) => !sameObservation(row, optimistic),
  );
  const restored = (loaded ?? []).reduce(upsertPrice, withoutOptimistic);
  if (restored.length > 0) return restored;
  return loadedIsKnown ? [] : undefined;
}

/** The freshest observation in a venue's per-category list, any drink. */
export function freshestCommunityPrice(
  rows: readonly CommunityPrice[] | undefined,
): CommunityPrice | null {
  if (!rows) return null;
  return rows.reduce<CommunityPrice | null>(
    (best, row) => (best === null || row.submittedAt > best.submittedAt ? row : best),
    null,
  );
}

/**
 * The freshest BEER observation - the only category allowed to restamp a pin.
 * Pin colours (priceBucket) and the hover price line are pint-oriented, so a
 * £18 cocktail must never recolour a pin or read as the pub's pint price.
 */
export function freshestPintPrice(
  rows: readonly CommunityPrice[] | undefined,
): CommunityPrice | null {
  return freshestCommunityPrice(rows?.filter((row) => row.drinkCategory === "beer"));
}

export function useCommunityPrices(): CommunityPricesState {
  const [byVenueId, setByVenueId] = useState<Map<string, CommunityPrice[]>>(() => new Map());
  const [submitting, setSubmitting] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(() => new Set());
  // Venues already fetched this session - the sheet re-mounts on every
  // selection and must not re-hit the API for a venue it already read.
  const loaded = useRef<Set<string>>(new Set());
  const loadedRows = useRef<Map<string, CommunityPrice[]>>(new Map());

  const loadVenue = useCallback((venueId: string) => {
    if (!venueId || loaded.current.has(venueId)) return;
    loaded.current.add(venueId);
    void (async () => {
      try {
        const res = await fetch(`/api/price-submit?venueId=${encodeURIComponent(venueId)}`);
        if (!res.ok) {
          loaded.current.delete(venueId);
          return;
        }
        const result = readVenuePriceLoad(await res.json());
        if (result.status === "invalid") {
          loaded.current.delete(venueId);
          return;
        }
        const { prices } = result;
        if (result.status === "degraded") loaded.current.delete(venueId);
        if (result.status === "degraded" && prices.length === 0) return;
        loadedRows.current.set(
          venueId,
          prices.reduce(upsertPrice, loadedRows.current.get(venueId) ?? []),
        );
        setByVenueId((current) => {
          if (prices.length === 0 && current.has(venueId)) return current;
          const next = new Map(current);
          // Server rows are the record; a locally-optimistic entry for a
          // category the server hasn't seen yet is kept rather than dropped.
          const merged = prices.reduce(upsertPrice, next.get(venueId) ?? []);
          next.set(venueId, merged);
          return next;
        });
      } catch {
        // Fail-soft: no community prices, the sourced baseline still renders.
        // Allow a later selection to retry this venue.
        loaded.current.delete(venueId);
      }
    })();
  }, []);

  const submit = useCallback<CommunityPricesState["submit"]>(
    async (input) => {
      // Run the SAME validator the route runs, so an out-of-bounds price is
      // refused in-place with the identical sentence and never leaves the phone.
      const parsed = validateCommunityPrice(input);
      if (!parsed.ok) return { ok: false, error: parsed.error, reason: "invalid" };
      const { venueId, drinkCategory, priceGbp } = parsed.value;

      const submittedAt = Date.now();
      const optimistic: CommunityPrice = {
        venueId,
        drinkCategory,
        priceGbp,
        submittedAt,
        source: "community",
        corroborations: 1,
      };
      setByVenueId((current) => {
        const previous = current.get(venueId);
        const category = previous?.find(
          (row) => row.drinkCategory === drinkCategory,
        );
        const next = new Map(current);
        next.set(
          venueId,
          upsertPrice(previous ?? [], {
            ...optimistic,
            mapCandidate: category?.mapCandidate,
          }),
        );
        return next;
      });

      const rollback = () => {
        setByVenueId((current) => {
          const next = new Map(current);
          const restored = rollbackOptimisticPrice(
            current.get(venueId),
            optimistic,
            loadedRows.current.get(venueId),
            loadedRows.current.has(venueId),
          );
          if (restored === undefined) next.delete(venueId);
          else next.set(venueId, restored);
          return next;
        });
      };

      setSubmitting(true);
      try {
        const res = await fetch("/api/price-submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ venueId, drinkCategory, priceGbp }),
        });
        const data = (await res.json().catch(() => null)) as
          | { price?: CommunityPrice; error?: string }
          | null;
        if (!res.ok) {
          rollback();
          return {
            ok: false,
            error: data?.error ?? "Could not log that price right now.",
            reason: "rejected",
          };
        }
        // Adopt the server's authoritative record: its timestamp, so the dated
        // badge is the record's day rather than the device's guess at it, and
        // its corroboration count, which is the only thing that can promote
        // this price from the sheet onto the map. Narrowed by the same reader
        // the GET uses, so there is one trust boundary for both. A forced
        // replace, not the keep-newer merge: a device clock ahead of the
        // server would otherwise out-rank the record and keep the optimistic
        // stamp forever.
        const [stored] = readPrices({ prices: [data?.price] }) ?? [];
        if (stored) {
          loadedRows.current.set(
            venueId,
            replacePrice(loadedRows.current.get(venueId) ?? [], stored),
          );
          setByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, replacePrice(next.get(venueId) ?? [], stored));
            return next;
          });
        }
        return { ok: true };
      } catch {
        rollback();
        return {
          ok: false,
          error: "No signal for that one. Try again in a moment.",
          reason: "offline",
        };
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const reportPrice = useCallback((id: string) => {
    if (!id || reportedIds.has(id)) return;
    // Optimistic ACKNOWLEDGEMENT, not an optimistic removal: the figure stays
    // on the sheet, dated, until a moderator hides it. Marking it locally is
    // what stops the same reader flagging it twice and tells them it landed.
    setReportedIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    void (async () => {
      try {
        await fetch("/api/price-submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "report", id }),
        });
      } catch {
        // Swallow: the report is best-effort and the durable ledger de-dupes,
        // so a retry on the next load is harmless.
      }
    })();
  }, [reportedIds]);

  // The freshest beer observation per venue - what a pin can carry. Derived,
  // never stored, so it can't drift from the per-category lists.
  const freshestByVenueId = useMemo(() => {
    const freshest = new Map<string, CommunityPrice>();
    for (const [venueId, rows] of byVenueId) {
      const top = freshestPintPrice(rows);
      if (top) freshest.set(venueId, top);
    }
    return freshest;
  }, [byVenueId]);

  return {
    byVenueId,
    freshestByVenueId,
    loadVenue,
    submit,
    submitting,
    reportPrice,
    reportedIds,
  };
}
