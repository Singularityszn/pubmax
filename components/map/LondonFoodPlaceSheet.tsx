"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, CupSoda, MapPin } from "lucide-react";

import DataCreditsLink from "@/components/legal/DataCreditsLink";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { trackEvent } from "@/lib/analytics";
import {
  formatPriceDay,
  validateCommunityPrice,
} from "@/lib/communityPrice";
import {
  FOOD_PLACE_PRICE_CATEGORY,
  FOOD_PLACE_PRICE_SUBTYPE_ID,
  foodPlacePriceStanding,
  type LondonFoodPlace,
} from "@/lib/londonFoodPlaces";
import {
  PHOTO_ACCEPT,
  RECEIPT_PHOTO_ACTION,
  RECEIPT_REQUIRED_LINE,
  photoRefusal,
} from "@/lib/pintDropReceipt";
import { formatPrice } from "@/lib/venues";

import "./londonRestaurantSheet.css";
import "./venuePriceSubmit.css";

// The sheet behind a London fast-food counter (lib/londonFoodPlaces.ts). The map
// knows its name, address and position from OpenStreetMap, and holds one price
// lane for it: what people paid for a Coke Zero or a Diet Coke there. McDonald's
// publishes no per-restaurant prices, so a figure here is somebody's bill and
// nothing else. The counter has no pin, so this sheet opens from a link (the
// soft drinks page's "Add a price").
//
// The composer is deliberately not VenuePriceSubmit: that one is worded for a
// pub, offers every drink and asks a pint measure. This one offers the one drink
// the write door admits here, and posts through the SAME hook, the same sign-in
// gate and the same bill rule, so nothing about trust is restated.

type LondonFoodPlaceSheetProps = {
  place: LondonFoodPlace;
  communityPrices: CommunityPricesState;
  /** True when the link asked to log (`log=1`): the price field takes focus. */
  logRequested?: boolean;
  /** Called once the log request has been acted on, so it is not repeated. */
  onLogRequestConsumed?: () => void;
};

export default function LondonFoodPlaceSheet({
  place,
  communityPrices,
  logRequested = false,
  onLogRequestConsumed,
}: LondonFoodPlaceSheetProps) {
  const { loadVenue, byVenueId, venuePriceStatus } = communityPrices;
  useEffect(() => {
    loadVenue(place.id);
  }, [loadVenue, place.id]);

  const readStatus = venuePriceStatus.get(place.id);
  const standing = foodPlacePriceStanding(byVenueId.get(place.id));

  return (
    <div className="londonRestaurant" data-london-food-place={place.id}>
      <div className="londonRestaurantHead">
        <span className="londonRestaurantTag">
          <CupSoda size={12} aria-hidden="true" />
          Fast food
        </span>
        <h2 className="londonRestaurantName">{place.name}</h2>
        {place.address ? (
          <p className="londonRestaurantAddress">
            <MapPin size={13} aria-hidden="true" />
            {place.address}
          </p>
        ) : null}
      </div>

      <p className="londonRestaurantLead" data-food-place-standing={standing.kind}>
        {standing.kind === "agreed"
          ? `Coke Zero or Diet Coke: ${formatPrice(standing.priceGbp)}. ${standing.corroborations} drinkers agree, latest ${formatPriceDay(standing.submittedAt)}.`
          : standing.kind === "logged-once"
            ? `Coke Zero or Diet Coke: ${formatPrice(standing.priceGbp)}, logged once ${formatPriceDay(standing.submittedAt)}. A second drinker can confirm it.`
            : readStatus === "degraded"
              ? "We could not check the prices logged here just now."
              : readStatus === "ready"
                ? "Nobody has logged a Coke Zero or Diet Coke price here yet."
                : "Checking the prices logged here."}
      </p>

      <FoodPlacePriceLog
        place={place}
        communityPrices={communityPrices}
        logRequested={logRequested}
        onLogRequestConsumed={onLogRequestConsumed}
      />

      <p className="londonRestaurantSource">
        Place from{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL. McDonald&rsquo;s publishes no prices for its restaurants, so every
        figure here is one somebody paid. <DataCreditsLink />
      </p>
    </div>
  );
}

function FoodPlacePriceLog({
  place,
  communityPrices,
  logRequested,
  onLogRequestConsumed,
}: {
  place: LondonFoodPlace;
  communityPrices: CommunityPricesState;
  logRequested: boolean;
  onLogRequestConsumed?: () => void;
}) {
  const { submit, submitting } = communityPrices;
  const { requestContribution, contributionGateDialog } = useContributionGate();
  const [price, setPrice] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggedPrice, setLoggedPrice] = useState<number | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  // Claimed before the first await, so two taps in one tick log once (D10).
  const logInFlight = useRef(false);

  useEffect(() => {
    if (!logRequested) return;
    const frame = window.requestAnimationFrame(() => {
      priceInputRef.current?.focus();
      onLogRequestConsumed?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [logRequested, onLogRequestConsumed]);

  const validation = validateCommunityPrice({
    venueId: place.id,
    drinkCategory: FOOD_PLACE_PRICE_CATEGORY,
    priceGbp: price,
  });
  const visibleError =
    error ?? (price.trim() !== "" && !validation.ok ? validation.error : null);
  const titleId = `foodPlaceLogTitle-${place.id}`;

  function chooseReceipt(file: File | undefined) {
    if (!file) return;
    const refusal = photoRefusal(file);
    if (refusal) {
      setError(refusal);
      setReceipt(null);
      if (receiptInputRef.current) receiptInputRef.current.value = "";
      return;
    }
    setError(null);
    setReceipt(file);
  }

  async function logPrice() {
    if (!validation.ok) return;
    if (!receipt) {
      setError(RECEIPT_REQUIRED_LINE);
      return;
    }
    if (logInFlight.current) return;
    logInFlight.current = true;
    setError(null);
    try {
      await requestContribution(async (auth) => {
        const result = await submit(
          {
            venueId: place.id,
            drinkCategory: FOOD_PLACE_PRICE_CATEGORY,
            drinkSubtype: FOOD_PLACE_PRICE_SUBTYPE_ID,
            priceGbp: price,
            receiptPhoto: receipt,
          },
          auth,
        );
        if (!result.ok) {
          trackEvent("price_submit_failed", {
            category: FOOD_PLACE_PRICE_CATEGORY,
            reason: result.reason,
          });
          if (result.status) return { status: result.status, error: result.error };
          setError(result.error);
          return;
        }
        trackEvent("price_submitted", { category: FOOD_PLACE_PRICE_CATEGORY });
        setLoggedPrice(validation.value.priceGbp);
        setPrice("");
      });
    } finally {
      logInFlight.current = false;
    }
  }

  return (
    <section className="venuePriceSubmit londonFoodPlaceLog" aria-labelledby={titleId}>
      <div className="vpsubHead">
        <CupSoda size={15} aria-hidden="true" />
        <h3 id={titleId} className="vpsubTitle">
          What did your Coke Zero or Diet Coke cost?
        </h3>
      </div>
      <div className="vpsubEntry">
        <div className="vpsubField">
          <span className="vpsubCurrency" aria-hidden="true">
            £
          </span>
          <input
            ref={priceInputRef}
            className="vpsubInput"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="1.99"
            value={price}
            maxLength={6}
            aria-label={`Price of a Coke Zero or Diet Coke at ${place.name}, in pounds`}
            aria-invalid={visibleError !== null}
            aria-describedby={visibleError ? `foodPlaceLogError-${place.id}` : undefined}
            onChange={(event) => {
              setPrice(event.target.value.replace(/[^\d.,]/g, ""));
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void logPrice();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="vpsubLog"
          onClick={() => void logPrice()}
          disabled={submitting || !validation.ok || !receipt}
        >
          {submitting ? "Logging…" : "Log it"}
        </button>
      </div>

      <div className="vpsubPhotoRow">
        <input
          ref={receiptInputRef}
          className="vpsubPhotoInput"
          type="file"
          accept={PHOTO_ACCEPT}
          aria-label={`Photo of the bill at ${place.name}`}
          onChange={(event) => chooseReceipt(event.target.files?.[0])}
        />
        <button
          type="button"
          className="vpsubPhotoBtn"
          onClick={() => receiptInputRef.current?.click()}
          disabled={submitting}
        >
          <Camera size={15} aria-hidden="true" />
          {receipt ? "Change the bill" : RECEIPT_PHOTO_ACTION}
        </button>
      </div>
      {receipt ? null : <p className="vpsubPhotoWhy">{RECEIPT_REQUIRED_LINE}</p>}

      {visibleError ? (
        <p id={`foodPlaceLogError-${place.id}`} className="vpsubError" role="alert">
          {visibleError}
        </p>
      ) : null}

      {loggedPrice !== null ? (
        <p className="vpsubStamp" role="status">
          <Check size={14} aria-hidden="true" className="vpsubStampTick" />
          <strong className="vpsubStampPrice">{formatPrice(loggedPrice)}</strong>
          <span className="vpsubStampMeta">Logged. A second drinker can confirm it.</span>
        </p>
      ) : (
        <p className="vpsubNote">
          Your price shows here straight away, dated and under your public handle,
          and on the Lucia 🐐 list as one report until a second drinker logs a
          similar price. It never reaches a pub&rsquo;s price, a pin or the Pint
          Index.
        </p>
      )}
      {contributionGateDialog}
    </section>
  );
}
