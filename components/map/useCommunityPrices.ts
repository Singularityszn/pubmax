"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  validateCommunityPrice,
  type CommunityPrice,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";

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

export type CommunityPriceSubmitResult = { ok: true } | { ok: false; error: string };

export type CommunityPricesState = {
  /** Freshest community price per drink category, by venue id. */
  byVenueId: Map<string, CommunityPrice[]>;
  /** The freshest BEER price at a venue - what the pin restamps to. Pins and
   *  the list are pint-priced surfaces, so other categories never reach them;
   *  they render on the sheet's own dated rows instead. */
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
};

/** Freshest-wins merge of one observation into a venue's per-category list. */
export function upsertPrice(rows: CommunityPrice[], next: CommunityPrice): CommunityPrice[] {
  const current = rows.find((row) => row.drinkCategory === next.drinkCategory);
  const freshest =
    current && current.submittedAt > next.submittedAt ? current : next;
  const others = rows.filter((row) => row.drinkCategory !== next.drinkCategory);
  return [freshest, ...others].sort((a, b) => b.submittedAt - a.submittedAt);
}

/** Narrow an untrusted API payload to the prices we can honestly render. */
function readPrices(value: unknown): CommunityPrice[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { prices?: unknown }).prices;
  if (!Array.isArray(rows)) return [];
  const out: CommunityPrice[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const price = row as Partial<CommunityPrice>;
    if (typeof price.priceGbp !== "number" || !Number.isFinite(price.priceGbp)) continue;
    if (typeof price.submittedAt !== "number" || !Number.isFinite(price.submittedAt)) continue;
    if (typeof price.drinkCategory !== "string" || typeof price.venueId !== "string") continue;
    out.push({
      venueId: price.venueId,
      drinkCategory: price.drinkCategory as DrinkCategory,
      priceGbp: price.priceGbp,
      submittedAt: price.submittedAt,
      source: "community",
    });
  }
  return out;
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
  // Venues already fetched this session - the sheet re-mounts on every
  // selection and must not re-hit the API for a venue it already read.
  const loaded = useRef<Set<string>>(new Set());

  const loadVenue = useCallback((venueId: string) => {
    if (!venueId || loaded.current.has(venueId)) return;
    loaded.current.add(venueId);
    void (async () => {
      try {
        const res = await fetch(`/api/price-submit?venueId=${encodeURIComponent(venueId)}`);
        if (!res.ok) return;
        const prices = readPrices(await res.json());
        if (prices.length === 0) return;
        setByVenueId((current) => {
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
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const { venueId, drinkCategory, priceGbp } = parsed.value;

      const optimistic: CommunityPrice = {
        venueId,
        drinkCategory,
        priceGbp,
        submittedAt: Date.now(),
        source: "community",
      };
      // Snapshot for rollback: exactly what was showing before this tap.
      let previous: CommunityPrice[] | undefined;
      setByVenueId((current) => {
        previous = current.get(venueId);
        const next = new Map(current);
        next.set(venueId, upsertPrice(previous ?? [], optimistic));
        return next;
      });

      const rollback = () => {
        setByVenueId((current) => {
          const next = new Map(current);
          if (previous === undefined) next.delete(venueId);
          else next.set(venueId, previous);
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
          };
        }
        // Adopt the server's authoritative timestamp so the dated badge is the
        // record's day, not the device's guess at it.
        const stored = data?.price;
        if (stored && typeof stored.submittedAt === "number") {
          setByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, upsertPrice(next.get(venueId) ?? [], { ...stored, source: "community" }));
            return next;
          });
        }
        return { ok: true };
      } catch {
        rollback();
        return { ok: false, error: "No signal for that one. Try again in a moment." };
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

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

  return { byVenueId, freshestByVenueId, loadVenue, submit, submitting };
}
