"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import type { NearPriceTrustResponse } from "@/lib/nearPriceTrust";

export type NearPriceTrustView = "loading" | NearPriceTrustResponse;

const MAX_TRUST_IDS = 5;

export function buildNearPriceTrustUrl(cards: readonly NearMeCard[]): string | null {
  const ids = [...new Set(cards.map((card) => card.id.trim()).filter(Boolean))]
    .slice(0, MAX_TRUST_IDS);
  if (ids.length === 0) return null;
  const params = new URLSearchParams();
  for (const id of ids) params.append("venueId", id);
  return `/api/near-price-trust?${params.toString()}`;
}

function isNearPriceTrustResponse(value: unknown): value is NearPriceTrustResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NearPriceTrustResponse>;
  return (
    (candidate.status === "ready" || candidate.status === "degraded") &&
    typeof candidate.collectedAt === "string" &&
    Array.isArray(candidate.results) &&
    candidate.results.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.venueId === "string" &&
        typeof item.price === "number" &&
        Number.isFinite(item.price) &&
        (item.publisher === null || typeof item.publisher === "string"),
    )
  );
}

function degradedResponse(): NearPriceTrustResponse {
  return {
    status: "degraded",
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString().slice(0, 10),
    results: [],
  };
}

/** `/near` evidence read. The generation guard and abort keep old area reads out. */
export function useNearPriceTrust(
  cards: readonly NearMeCard[],
  enabled: boolean,
): NearPriceTrustView | undefined {
  const requestUrl = useMemo(() => buildNearPriceTrustUrl(cards), [cards]);
  const [resolved, setResolved] = useState<{
    requestUrl: string;
    view: NearPriceTrustView;
  }>();
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!enabled || !requestUrl) return;
    const controller = new AbortController();
    // An external server read owns this transition. Prices stay rendered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolved({ requestUrl, view: "loading" });
    void fetch(requestUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("near price trust read failed");
        const body: unknown = await response.json();
        if (!isNearPriceTrustResponse(body)) throw new Error("near price trust response invalid");
        return body;
      })
      .then((body) => {
        if (generation === generationRef.current) {
          setResolved({ requestUrl, view: body });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (generation === generationRef.current) {
          setResolved({ requestUrl, view: degradedResponse() });
        }
        void error;
      });
    return () => controller.abort();
  }, [enabled, requestUrl]);

  if (!enabled || !requestUrl) return undefined;
  return resolved?.requestUrl === requestUrl ? resolved.view : "loading";
}
