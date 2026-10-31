"use client";

// Mates' prices on the venue sheet (launch review F8): what the reader's
// mutual friends last paid at this pub, read live from /api/mates-prices.
//
// Up to three dated facts, one per mate, each saying who paid what for which
// drink and on which day. Never an average and never "your lot pays" (ADR
// 0017). It renders nothing for a reader who is signed out or not yet known,
// nothing when no mate has logged here, and nothing on any failed read: an
// absence is never worded, so there is no "Unknown" and no empty frame.

import { useEffect, useState, useSyncExternalStore } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { readProviderAccountRevision, readProviderAccountSignal, subscribeProviderIdentityRevision } from "@/lib/authProviderRevision";
import { authedFetch } from "@/lib/authedFetch";
import { cleanDrinkMeasure } from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";
import {
  MATES_PRICES_LIMIT,
  matesPriceDay,
  matesPriceDrink,
  type MatesPrice,
} from "@/lib/matesPrices";
import { discardBody } from "@/lib/responseBody";

import "./matesPricesLine.css";

type Props = { venueId: string };

function readPrices(body: unknown): MatesPrice[] {
  const prices = (body as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(prices)) return [];
  return prices
    .flatMap((raw): MatesPrice[] => {
      const row = raw as Partial<MatesPrice> | null;
      if (
        !row ||
        typeof row.handle !== "string" ||
        !row.handle ||
        typeof row.priceGbp !== "number" ||
        !Number.isFinite(row.priceGbp) ||
        typeof row.loggedAt !== "string"
      ) {
        return [];
      }
      return [
        {
          handle: row.handle,
          priceGbp: row.priceGbp,
          drink: typeof row.drink === "string" ? row.drink : "",
          measure: cleanDrinkMeasure(row.measure),
          ...(typeof row.measureLabel === "string" ? { measureLabel: row.measureLabel } : {}),
          loggedAt: row.loggedAt,
        },
      ];
    })
    .slice(0, MATES_PRICES_LIMIT);
}

export default function MatesPricesLine({ venueId }: Props) {
  const { signedIn } = useViewerSession();
  const accountRevision = useSyncExternalStore(subscribeProviderIdentityRevision, readProviderAccountRevision, () => 0);
  const [answer, setAnswer] = useState<{ venueId: string; accountRevision: number; prices: MatesPrice[] } | null>(null);

  useEffect(() => {
    if (!signedIn || !venueId || readProviderAccountRevision() !== accountRevision) return;
    const controller = new AbortController();
    const accountSignal = readProviderAccountSignal();
    const abort = () => controller.abort();
    accountSignal.addEventListener("abort", abort, { once: true });
    const live = () => !controller.signal.aborted && !accountSignal.aborted && readProviderAccountRevision() === accountRevision;
    void authedFetch(
      `/api/mates-prices?venueId=${encodeURIComponent(venueId)}`,
      { credentials: "same-origin", cache: "no-store", signal: controller.signal },
      { requiresIdentity: true },
    )
      .then(async (response) => {
        if (!live() || !response.ok) {
          discardBody(response);
          return;
        }
        const prices = readPrices(await response.json());
        if (live()) setAnswer({ venueId, accountRevision, prices });
      })
      .catch(() => {
        // Fail-soft: no line is the honest answer to a read that did not land.
      });
    return () => {
      accountSignal.removeEventListener("abort", abort);
      controller.abort();
    };
  }, [venueId, signedIn, accountRevision]);

  if (!signedIn || !answer || answer.venueId !== venueId || answer.accountRevision !== accountRevision) return null;
  const now = new Date();
  const facts = answer.prices.flatMap((price) => {
    const day = matesPriceDay(price.loggedAt, now);
    return day ? [{ price, day }] : [];
  });
  if (facts.length === 0) return null;

  const titleId = `matesPricesTitle-${venueId}`;
  return (
    <section className="matesPrices" aria-labelledby={titleId}>
      <h4 className="matesPricesTitle" id={titleId}>
        Your mates paid
      </h4>
      <ul className="matesPricesList">
        {facts.map(({ price, day }) => (
          <li className="matesPricesFact" key={price.handle}>
            <strong>@{price.handle}</strong> paid <strong>{formatGbp(price.priceGbp)}</strong> for{" "}
            {matesPriceDrink(price)} here {day}
          </li>
        ))}
      </ul>
    </section>
  );
}
