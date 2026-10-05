"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Camera, Tag } from "lucide-react";

import {
  communityReachNote,
  formatPriceDay,
  marksMapProvisionally,
  paintsMap,
  COMMUNITY_PRICE_MAX_GBP,
  DEFAULT_SUBMIT_CATEGORY,
  submitCategoryLabel,
  validateCommunityPrice,
  type CommunityPrice,
  type CommunityPriceAttribution,
  type CommunityPriceMapReach,
} from "@/lib/communityPrice";
import { drinkLaneNoun, submitCategoriesForLane } from "@/lib/drinkLanes";
import { confirmationOutcomeLine } from "@/lib/pintDropSecondDrinker";
import {
  PHOTO_ACCEPT,
  PINT_PHOTO_ACTION,
  PINT_PHOTO_FUN_LINE,
  RECEIPT_PHOTO_ACTION,
  RECEIPT_REQUIRED_LINE,
  photoRefusal,
} from "@/lib/pintDropReceipt";
import {
  DEFAULT_DRINK_MEASURE,
  drinkMeasureName,
  measureIsPint,
  NON_PINT_PRICE_REACH_LINE,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";
import { formatPriceGbp, QUICK_ADD_PRICES_GBP } from "@/lib/spill";
import { mergePriceChips } from "@/lib/spillPreview";
import type { DrinkCategory } from "@/lib/drinks";
import { formatPrice } from "@/lib/venues";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { useContributionGate } from "@/components/identity/ContributionGateDialog";
import { trackEvent } from "@/lib/analytics";
import { haptic } from "@/lib/nativeHaptics";
import { pickNativePhoto } from "@/lib/nativeCamera";
import { isNativeApp } from "@/lib/nativePlatform";
import { recordPlanHighIntentAction } from "@/lib/nativePushPrompt";
import { recordKeptAction } from "@/lib/nativeReviewPrompt";
import MeasureChips from "@/components/map/composer/MeasureChips";
import PriceContributionImpact from "@/components/map/PriceContributionImpact";
import type { MissionSurface } from "@/lib/analyticsEvents";
import {
  effectiveSubmitCategory,
  holdSubmitCategory,
  missionAnalyticsProps,
  missionNamedCategory,
  missionReceiptFromReadback,
  type MissionReceipt,
  type PriceEvidenceMissionReason,
} from "@/lib/priceEvidenceMissions";
import { scrollMotionBehavior } from "@/lib/scrollMotion";

export type VenuePriceSubmitMission = {
  reason: PriceEvidenceMissionReason;
  drinkCategory?: DrinkCategory;
  surface: MissionSurface;
};

// The word-of-mouth moment: you're standing in the pub, you tap what you're
// drinking, you type what it cost, and the map restamps under your thumb.
//
// Deliberately NOT the Pint Drop composer. That is the full social object - a
// handle, photos, a note, a visibility lane, a destination. This is the
// twenty-second version for the person at the bar: category, price, done. The
// Price-entry surfaces check account state before mounting it, so nobody
// types a price and only then learns they need to sign in.
//
// Provenance is first-class, not decoration: the confirmation shows the price
// with its own dated "today · community" badge, and the scraped/sourced
// baseline keeps rendering underneath it untouched. Nothing here overwrites a
// dataset price - the submission is an additional dated observation.
//
// And the receipt tells the truth about REACH, not just about landing. Since
// the trust wave a lone report is on the pub's page but not on the map, so both
// the receipt and the pre-submit note say so rather than promising a restamp
// this tap has not earned yet (lib/communityPrice.ts owns the policy).

type VenuePriceSubmitProps = {
  venueId: string;
  venueName: string;
  /** Community prices layer - owns the restamp and the POST. */
  communityPrices: CommunityPricesState;
  /** The venue's price on record, used to lead the quick-tap chips. */
  baselinePriceGbp?: number | null;
  /**
   * Epoch ms of the venue's latest Pint Drop, from the SAME unmerged drop
   * signal mergeCommunityPriceSignals consults - a drop newer than the map
   * candidate outranks it in the merge, so the receipt must not claim the map
   * in that case either. Null/undefined reads as "no drop we can date".
   */
  latestPintDropAt?: number | null;
  /**
   * How far this pub's pin can carry a community price. Curated venues paint
   * (mark now, colour once corroborated). A UK base pin passes "mark": the dot
   * really does draw, and no corroboration ever gives it a colour, so the
   * receipt must claim the first and never the second.
   */
  mapReach?: CommunityPriceMapReach;
  /** Increment to bring this existing form under the drinker's thumb. */
  focusRequest?: number;
  /**
   * The drink the map is under, so the composer opens on what the reader came
   * to log. It also joins the chip row when the shortcut list omits it (gin,
   * rum, vodka), because a lane you cannot see is a lane you cannot log.
   */
  laneCategory?: DrinkCategory;
  /**
   * A ranked evidence mission. Locks the known category, leaves the price
   * blank, and hides one-tap agreement chips. Receipts come from the
   * authoritative write-back, never from this client reason.
   */
  mission?: VenuePriceSubmitMission | null;
  /**
   * The sheet mounts this form before its mission read answers. Hold Log it
   * until that read lands or times out, or a typed price is submitted under
   * a drink that arrived after typing began.
  */
  missionPending?: boolean;
  /** Refresh this venue's Pint Drops after a successful Log it. */
  onLogged?: (venueId: string) => void;
};

/**
 * Which lane asks the measure, and what travels with a submission from it.
 *
 * The beer lane alone, because the pint lane is the only lane a serving changes
 * the meaning of: a £12 cocktail is not a half of anything. Every other
 * category submits exactly as it did before F-2.
 */
function submittedMeasureFor(
  category: DrinkCategory,
  measure: DrinkMeasure,
): { asksMeasure: boolean; submittedMeasure: DrinkMeasure } {
  const asksMeasure = category === "beer";
  return {
    asksMeasure,
    submittedMeasure: asksMeasure ? measure : DEFAULT_DRINK_MEASURE,
  };
}

/**
 * THE REACH SENTENCE FOLLOWS THE MEASURE.
 *
 * `communityReachNote` says a second drinker moves the map, and for a half that
 * is not true at any count: nothing but a pint sets a pint price. Promising the
 * map here would be the D04 defect worded rather than stored.
 */
function submittedReachNote(
  category: DrinkCategory,
  mapReach: CommunityPriceMapReach,
  measure: DrinkMeasure,
): string {
  return measureIsPint(measure)
    ? communityReachNote(category, mapReach)
    : NON_PINT_PRICE_REACH_LINE;
}

/**
 * What a NON-PINT log reads back (review finding F-2).
 *
 * A half writes the dated Pint Drop and no community price, so there is no
 * stamped record to read back. The receipt names the figure, the serving it was
 * about, and the one place it reaches: this pub's own page. Claiming the map
 * for it would be the D04 defect worded rather than stored.
 */
function NonPintReceipt({
  priceGbp,
  measureName,
}: {
  priceGbp: number;
  measureName: string;
}) {
  return (
    <>
      <strong className="vpsubStampPrice">{formatPrice(priceGbp)}</strong>
      <span className="vpsubStampMeta">
        {measureName} · On this pub&rsquo;s page
      </span>
    </>
  );
}

/**
 * The freshest community price for the chosen category, or null. Read from the
 * shared layer so the confirmation and the pin can never disagree.
 */
function priceForCategory(
  rows: CommunityPrice[] | undefined,
  category: DrinkCategory,
): CommunityPrice | null {
  return rows?.find((row) => row.drinkCategory === category) ?? null;
}

export default function VenuePriceSubmit({
  venueId,
  venueName,
  communityPrices,
  baselinePriceGbp = null,
  latestPintDropAt = null,
  mapReach = "paint",
  focusRequest = 0,
  laneCategory = DEFAULT_SUBMIT_CATEGORY,
  mission = null,
  missionPending = false,
  onLogged,
}: VenuePriceSubmitProps) {
  const titleId = `vpsubTitle-${venueId}`;
  const priceInputRef = useRef<HTMLInputElement>(null);
  // A mission's own drink outranks anything held here. The sheet mounts this
  // form before its mission read answers, so a locked drink read off state set
  // at mount would name the lane while the heading named the mission.
  const missionCategory = mission ? missionNamedCategory(mission) : null;
  const missionLocksCategory = missionCategory !== null;
  // The lane is the opening choice, not a lock: the reader can still tap any
  // other drink. Keyed per venue by the parent, so switching pubs re-opens on
  // the lane rather than on whatever the last pub was left showing.
  const [chosenCategory, setCategory] = useState<DrinkCategory>(
    missionCategory ?? laneCategory,
  );
  // The drink the figure on screen was entered under. A mission arriving after
  // typing began may rename the heading, never this.
  const [heldCategory, setHeldCategory] = useState<DrinkCategory | null>(null);
  const category = effectiveSubmitCategory({
    held: heldCategory,
    mission: missionCategory,
    chosen: chosenCategory,
  });
  const missionAsksAnother =
    missionCategory !== null && missionCategory !== category;
  const categories = useMemo(
    () => submitCategoriesForLane(laneCategory),
    [laneCategory],
  );
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pintPhoto, setPintPhoto] = useState<File | null>(null);
  const pintPhotoInputRef = useRef<HTMLInputElement>(null);
  // THE BILL (captain 7 Sept 2026). A new price does not leave this composer
  // without one, and the same rule refuses it again at the route
  // (lib/pintDropReceipt.ts), because a browser is not a gate.
  const [receiptPhoto, setReceiptPhoto] = useState<File | null>(null);
  const receiptPhotoInputRef = useRef<HTMLInputElement>(null);
  // WHAT SERVING THE FIGURE IS ABOUT (review finding F-2, battle test D04).
  // Asked on the beer lane alone, because the pint lane is the only lane a
  // measure changes the meaning of: a £12 cocktail is not a half of anything.
  // Every other category writes its community price exactly as before.
  const [measure, setMeasure] = useState<DrinkMeasure>(DEFAULT_DRINK_MEASURE);
  const [measureLabel, setMeasureLabel] = useState("");
  // A measure only travels with the lane that asked it. Leaving beer with a
  // half still selected would send a serving nobody was asked about.
  const { asksMeasure, submittedMeasure } = submittedMeasureFor(category, measure);
  const reachNote = submittedReachNote(category, mapReach, submittedMeasure);
  // Claimed synchronously before the first await, so two taps in one tick
  // cannot both run the write (battle test D10).
  const logInFlight = useRef(false);

  function enterPrice(next: string) {
    setPrice(next);
    setHeldCategory((held) =>
      holdSubmitCategory({ held, nextPrice: next, visible: category }),
    );
    setError(null);
  }

  // Which drink this viewer just logged, so the receipt celebrates THEIR tap.
  // The dated community price itself is shown in the price block above by
  // VenueOverviewTab for every reader, submitter or not.
  const [logged, setLogged] = useState<{
    category: DrinkCategory;
    attribution: CommunityPriceAttribution;
    missionReceipt?: MissionReceipt;
    /**
     * What the server's second-reporter pass made of this write, already worded
     * (lib/pintDropSecondDrinker.ts). Null where the receipt above already says
     * everything. The composer PRINTS it and decides nothing: a drinker who
     * answered "Which did you pay?" with a third price is owed the pub's own
     * figures rather than a line asking for a drinker who has already been.
     */
    outcomeLine?: string | null;
    /**
     * A non-pint log has no community price to read back (the route writes the
     * dated Pint Drop alone), so the receipt carries the figure and the serving
     * this tap sent. Absent on every pint log, which reads the stamped record.
     */
    nonPint?: { priceGbp: number; measureName: string };
  } | null>(null);
  const { requestContribution, contributionGateDialog } =
    useContributionGate();

  const { byVenueId, submit, submitting } = communityPrices;

  // Changing the map's drink while this sheet is open is an explicit act, so
  // the composer follows it. A tap on a chip in between is not overwritten:
  // only a CHANGE of lane moves the choice.
  const laneSeenRef = useRef<DrinkCategory>(laneCategory);
  useEffect(() => {
    if (missionLocksCategory) return;
    if (laneSeenRef.current === laneCategory) return;
    laneSeenRef.current = laneCategory;
    setCategory(laneCategory);
    setHeldCategory((held) => (held === null ? null : laneCategory));
    setError(null);
  }, [laneCategory, missionLocksCategory]);

  useEffect(() => {
    if (focusRequest <= 0) return;
    let focusFrame = 0;
    const focusTimer = window.setTimeout(() => {
      focusFrame = window.requestAnimationFrame(() => {
        priceInputRef.current?.scrollIntoView({
          block: "center",
          behavior: scrollMotionBehavior(),
        });
        priceInputRef.current?.focus();
      });
    }, 120);
    return () => {
      window.clearTimeout(focusTimer);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [focusRequest]);

  // The receipt: the freshest community price for the chosen drink. The
  // optimistic submit writes into this same layer, so it appears the instant
  // the button is tapped - the restamp is not a second, local copy of the fact.
  const stamped = priceForCategory(byVenueId.get(venueId), category);

  // The venue's price on record leads the chips - one tap on the likeliest
  // answer beats typing, and a correction is usually a few pence away from it.
  // Three fit one row at 390px; a fourth wraps and the block stops reading as
  // a single row of shortcuts.
  const quickPrices = useMemo(
    () => mergePriceChips(QUICK_ADD_PRICES_GBP, baselinePriceGbp).slice(0, 3),
    [baselinePriceGbp],
  );
  // Left to the React Compiler rather than a manual useMemo: `category` is
  // derived per render by `effectiveSubmitCategory`, which the compiler cannot
  // accept as a hand-written dependency.
  const priceValidation = validateCommunityPrice({
    venueId,
    drinkCategory: category,
    priceGbp: price,
  });
  const validationError =
    price.trim() !== "" && !priceValidation.ok ? priceValidation.error : null;
  const visibleError = error ?? validationError;

  function clearPintPhoto() {
    setPintPhoto(null);
    if (pintPhotoInputRef.current) pintPhotoInputRef.current.value = "";
  }

  function clearReceiptPhoto() {
    setReceiptPhoto(null);
    if (receiptPhotoInputRef.current) receiptPhotoInputRef.current.value = "";
  }

  // Inside the Capacitor shell the button opens the native sheet (camera or
  // library, the person's choice) through lib/nativeCamera.ts rather than the
  // file input, because WKWebView's own chooser is the thin-wrapper tell, and
  // the Android chooser drops its camera entry outright. The chosen file lands
  // in the SAME validator the input feeds, so the size and type rules cannot
  // drift between the two doors.
  //
  // The seam's answer is three-way, and this surface has somewhere to put the
  // third: a person whose camera the OS is holding shut is told so, where a
  // person who simply changed their mind is shown nothing.
  async function choosePintPhoto() {
    if (isNativeApp()) {
      const pick = await pickNativePhoto("pint");
      if (pick.outcome === "chosen") onPintPhotoChosen(pick.file);
      else if (pick.outcome === "blocked") setError(pick.message);
      return;
    }
    pintPhotoInputRef.current?.click();
  }

  function onPintPhotoChosen(file: File | undefined) {
    if (!file) return;
    const refusal = photoRefusal(file);
    if (refusal) {
      setError(refusal);
      clearPintPhoto();
      return;
    }
    setError(null);
    setPintPhoto(file);
  }

  // The bill takes the SAME two doors as the pint photo: the native sheet
  // inside the shell (camera or library, the person's choice) and the file
  // input on the web. One validator behind both, so a rule cannot drift
  // between the two ways in.
  async function chooseReceiptPhoto() {
    if (isNativeApp()) {
      const pick = await pickNativePhoto("pint");
      if (pick.outcome === "chosen") onReceiptPhotoChosen(pick.file);
      else if (pick.outcome === "blocked") setError(pick.message);
      return;
    }
    receiptPhotoInputRef.current?.click();
  }

  function onReceiptPhotoChosen(file: File | undefined) {
    if (!file) return;
    const refusal = photoRefusal(file);
    if (refusal) {
      setError(refusal);
      clearReceiptPhoto();
      return;
    }
    setError(null);
    setReceiptPhoto(file);
  }

  // What this tap actually did to the map, asked of the same predicates the map
  // itself obeys - `paintsMap` for the price, `marksMapProvisionally` for the
  // badge - so the receipt can never claim a reach the pin does not have.
  const markedProvisionally =
    mapReach !== "page" && stamped ? marksMapProvisionally(stamped) : false;
  const stampStanding = !stamped
    ? ""
    : mapReach === "paint" && paintsMap(stamped, latestPintDropAt)
      ? "On the map"
      : markedProvisionally
        ? "Marked on the map"
        : "On this pub’s page";

  async function logPrice() {
    // The Enter key reaches here even while the button is disabled; one
    // submission at a time keeps the optimistic rollback snapshots coherent.
    if (missionPending || !priceValidation.ok) return;
    // Said here as well as at the route, because a disabled button that never
    // says why is a dead end (docs/VOICE.md). The Enter key reaches this line.
    if (!receiptPhoto) {
      setError(RECEIPT_REQUIRED_LINE);
      return;
    }
    // THE LATCH IS A REF, CLAIMED BEFORE THE FIRST AWAIT (battle test D10).
    // `submitting` is React state, committed in a microtask after the event, so
    // three taps in one tick all read it false and all three ran: the report
    // saw three POSTs and three `pint_drops` rows 21 ms apart. A ref is written
    // synchronously, so the second tap of the same tick sees the first one's
    // claim. Same idiom as PlanSummary's save.
    if (logInFlight.current) return;
    logInFlight.current = true;
    setError(null);
    try {
      await requestContribution(async (auth) => {
        const result = await submit({
          venueId,
          drinkCategory: category,
          priceGbp: price,
          measure: submittedMeasure,
          measureLabel: submittedMeasure === "other" ? measureLabel : "",
          pintPhoto,
          receiptPhoto,
        }, auth);
        if (!result.ok) {
          trackEvent("price_submit_failed", { category, reason: result.reason });
          if (result.status) {
            return {
              status: result.status,
              error: result.error,
            };
          }
          haptic("action-refused");
          setError(result.error);
          return;
        }
        trackEvent("price_submitted", { category });
        // A Pint Drop is the action this whole product is built around, so it
        // gets the one two-beat tap in the vocabulary. Fire-and-forget: the
        // receipt below never waits on a vibrator (lib/nativeHaptics.ts).
        haptic("contribution-kept");
        // A price the drinker kept is the first kept action for most people, and
        // until now only a plan could offer notifications. The explainer still
        // decides whether to show (lib/nativePushPrompt.ts); this only says an
        // action worth being offered one happened.
        recordPlanHighIntentAction();
        // A logged price is a kept action, so it also counts towards the once-ever
        // store review ask. lib/nativeReviewPrompt.ts owns whether this is the
        // moment; nothing is awaited and the receipt below never waits on it.
        void recordKeptAction("price-logged");
        // Read back what this tap turned out to be worth. It is derived for
        // EVERY confirmed submission, not only inside a mission: the corroboration
        // rate is submissions that reached the map over submissions made, and
        // mission_submitted can only ever give it a denominator of missions.
        const readback = missionReceiptFromReadback({
          price: result.price,
          pintTrust: result.pintTrust,
        });
        trackEvent("price_submit_outcome", { category, outcome: readback.outcome });
        const missionReceipt = mission ? readback : undefined;
        if (mission && missionReceipt) {
          const analytics = missionAnalyticsProps(mission.surface, {
            reason: mission.reason,
            drinkCategory: category,
          }, { outcome: missionReceipt.outcome });
          trackEvent("mission_submitted", analytics);
          if (missionReceipt.outcome === "trusted") {
            trackEvent("mission_newly_trusted", analytics);
          }
        }
        setLogged({
          category,
          attribution: result.attribution,
          missionReceipt,
          outcomeLine: confirmationOutcomeLine(
            result.confirmationOutcome,
            Number(price.replace(",", ".")),
          ),
          ...(measureIsPint(submittedMeasure)
            ? {}
            : {
                nonPint: {
                  priceGbp: Number(price.replace(",", ".")),
                  measureName: drinkMeasureName(submittedMeasure, measureLabel),
                },
              }),
        });
        setPrice("");
        setHeldCategory(null);
        // The next figure starts from the default rather than inheriting the
        // serving of the last one. A latched half is exactly the state this
        // control exists to make impossible.
        setMeasure(DEFAULT_DRINK_MEASURE);
        setMeasureLabel("");
        clearPintPhoto();
        clearReceiptPhoto();
        onLogged?.(venueId);
      });
    } finally {
      // Released whatever the outcome: a refused or failed write must leave
      // the drinker able to try again.
      logInFlight.current = false;
    }
  }

  // THE RECEIPT, as its own function. Same figure and day label the venue card
  // carries - one vocabulary, one moment. What it must NOT do is overclaim: a
  // lone report does not set the pin's price, and saying "on the map" for it
  // would be the exact dishonesty the trust gate exists to fix.
  //
  // Four honest standings, in descending reach:
  //   painting  - this figure IS the pin's price ("On the map");
  //   marked    - the pin now wears the provisional dot, price unchanged;
  //   page only - an aged-out figure or a non-pint drink: no map at all.
  // A mission receipt is the write-back standing, never the client reason.
  //
  // Nested rather than extracted, on the AGENTS.md rule for decomposing a
  // component in place: ESLint scores complexity per function, and a nested
  // call leaves the element tree identical where a component would add a fibre.
  function stampBlock() {
    if (!logged || logged.category !== category) return null;
    if (!logged.missionReceipt && !logged.nonPint && !stamped && !logged.outcomeLine) return null;
    return (
      <div className="vpsubStampBlock">
        <p className="vpsubStamp" role="status">
          <Check size={14} aria-hidden="true" className="vpsubStampTick" />
          {logged.missionReceipt ? (
            <strong className="vpsubStampPrice">{logged.missionReceipt.line}</strong>
          ) : logged.nonPint ? (
            <NonPintReceipt {...logged.nonPint} />
          ) : stamped ? (
            <>
              <strong className="vpsubStampPrice">{formatPrice(stamped.priceGbp)}</strong>
              <span className="vpsubStampMeta">
                {stampStanding} · {formatPriceDay(stamped.submittedAt)}
              </span>
            </>
          ) : null}
        </p>
        {logged.outcomeLine ? (
          <p className="vpsubStampHint">{logged.outcomeLine}</p>
        ) : null}
        <PriceContributionImpact attribution={logged.attribution} />
        {/* Close the loop in-session: the mark the map just gained, named and
            coloured exactly as the map draws it, so the submitter can look up
            and find their own dot rather than take our word for it. */}
        {logged.nonPint ? (
          <p className="vpsubStampHint">{NON_PINT_PRICE_REACH_LINE}</p>
        ) : null}
        {!logged.missionReceipt && !logged.nonPint && markedProvisionally ? (
          <p className="vpsubStampHint">
            <i className="vpsubStampDot" aria-hidden="true" />
            Its pin now carries this dot.{" "}
            {mapReach === "paint"
              ? "A second independent drinker reporting a similar price can set the pin’s colour."
              : "A second independent drinker reporting a similar price can confirm the figure here."}
          </p>
        ) : null}
      </div>
    );
  }

  // The drink chooser, nested rather than extracted: ESLint scores complexity
  // per function, and a nested call leaves the React element tree identical
  // where a component would add a fibre (AGENTS.md, the god-component rule).
  function renderDrinkChooser() {
    return (
        missionLocksCategory ? (
          <>
            <p className="vpsubLockedDrink">{submitCategoryLabel(category)}</p>
            {missionAsksAnother ? (
              <p className="vpsubHeldDrink">
                {`Clear the price to log ${drinkLaneNoun(missionCategory)} instead.`}
              </p>
            ) : null}
          </>
        ) : (
          <div
            className="vpsubCats"
            role="radiogroup"
            aria-label={`What are you drinking at ${venueName}?`}
          >
            {categories.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={category === option}
                className={category === option ? "vpsubCat vpsubCatOn" : "vpsubCat"}
                onClick={() => {
                  // The receipt belongs to the drink it was logged for, so
                  // switching categories shows that category's own record.
                  setCategory(option);
                  setHeldCategory((held) => (held === null ? null : option));
                  // The measure belongs to the drink it was picked under, so a
                  // half of lager cannot follow the reader onto wine.
                  setMeasure(DEFAULT_DRINK_MEASURE);
                  setMeasureLabel("");
                  setError(null);
                }}
              >
                {submitCategoryLabel(option)}
              </button>
            ))}
          </div>
        )
    );
  }

  return (
    <section
      id={`venue-price-submit-${venueId}`}
      className="venuePriceSubmit"
      aria-labelledby={titleId}
    >
      <div className="vpsubHead">
        <Tag size={15} aria-hidden="true" />
        <h3 id={titleId} className="vpsubTitle">
          What&rsquo;s it tonight?
        </h3>
      </div>

      {renderDrinkChooser()}

      {asksMeasure ? (
        // ABOVE the price field, in the composer's own order: the closed
        // question before the figure, so the answer is never inferred from
        // what somebody typed afterwards. Same control as the Pint Drop
        // composer (components/map/composer/MeasureChips.tsx), so the two
        // price doors cannot ask one question two ways.
        <MeasureChips
          measure={measure}
          measureLabel={measureLabel}
          onChange={(next) => {
            setMeasure(next.measure);
            setMeasureLabel(next.measureLabel);
            setError(null);
          }}
          disabled={submitting || missionPending}
        />
      ) : null}

      <div className="vpsubEntry">
        <div className="vpsubField">
          <span className="vpsubCurrency" aria-hidden="true">
            £
          </span>
          {/* The field's accessible name takes the SENTENCE noun, not the chip
              label: the chips are menu-section names, so lowercasing one read
              out as "price of a cocktails". The lane table owns the singular. */}
          <input
            ref={priceInputRef}
            className="vpsubInput"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="4.20"
            value={price}
            maxLength={6}
            aria-label={`Price of a ${drinkLaneNoun(category)} at ${venueName}, in pounds`}
            aria-invalid={visibleError !== null}
            aria-describedby={visibleError ? "vpsubError" : undefined}
            onChange={(event) => {
              // Keep the field to what a price can be as you type - digits and
              // one separator - so the keypad can't produce an unparseable value.
              enterPrice(event.target.value.replace(/[^\d.,]/g, ""));
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
          disabled={submitting || missionPending || !priceValidation.ok || !receiptPhoto}
        >
          {missionPending ? "Checking..." : submitting ? "Logging…" : "Log it"}
        </button>
      </div>

      {missionLocksCategory ? null : (
        <div className="vpsubQuick" aria-label="Common prices">
          {quickPrices.map((value) => (
            <button
              key={value}
              type="button"
              className="vpsubQuickChip"
              onClick={() => {
                enterPrice(formatPriceGbp(value));
              }}
            >
              {formatPrice(value)}
            </button>
          ))}
        </div>
      )}

      {/* THE BILL, THEN THE PINT. The bill is the condition of logging a price
          and says why in one line; the pint photo is offered right after it,
          for fun, and is never a condition of anything (captain 7 Sept 2026). */}
      <div className="vpsubPhotoRow">
        <input
          ref={receiptPhotoInputRef}
          className="vpsubPhotoInput"
          type="file"
          accept={PHOTO_ACCEPT}
          aria-label={`Photo of the bill at ${venueName}`}
          onChange={(event) => {
            onReceiptPhotoChosen(event.target.files?.[0]);
          }}
        />
        <button
          type="button"
          className="vpsubPhotoBtn"
          data-testid="receipt-photo-btn"
          onClick={() => void chooseReceiptPhoto()}
          disabled={submitting || missionPending}
        >
          <Camera size={15} aria-hidden="true" />
          {receiptPhoto ? "Change the bill" : RECEIPT_PHOTO_ACTION}
        </button>
        {receiptPhoto ? (
          <button
            type="button"
            className="vpsubPhotoClear"
            onClick={clearReceiptPhoto}
            disabled={submitting || missionPending}
          >
            Remove
          </button>
        ) : null}
      </div>
      {receiptPhoto ? null : (
        <p className="vpsubPhotoWhy">{RECEIPT_REQUIRED_LINE}</p>
      )}

      {receiptPhoto ? (
        <>
          <p className="vpsubPhotoWhy">{PINT_PHOTO_FUN_LINE}</p>
          <div className="vpsubPhotoRow">
            <input
              ref={pintPhotoInputRef}
              className="vpsubPhotoInput"
              type="file"
              accept={PHOTO_ACCEPT}
              aria-label={`Optional pint photo for ${venueName}`}
              onChange={(event) => {
                onPintPhotoChosen(event.target.files?.[0]);
              }}
            />
            <button
              type="button"
              className="vpsubPhotoBtn"
              data-testid="pint-photo-btn"
              onClick={() => void choosePintPhoto()}
              disabled={submitting || missionPending}
            >
              <Camera size={15} aria-hidden="true" />
              {pintPhoto ? "Change the pint" : PINT_PHOTO_ACTION}
            </button>
            {pintPhoto ? (
              <button
                type="button"
                className="vpsubPhotoClear"
                onClick={clearPintPhoto}
                disabled={submitting || missionPending}
              >
                Remove
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {visibleError ? (
        <p id="vpsubError" className="vpsubError" role="alert">
          {visibleError}
        </p>
      ) : null}

      {stampBlock() ?? (
        <p className="vpsubNote">
          Your price shows on this pub&rsquo;s page straight away, dated and
          badged as community. It never replaces the price on record.{" "}
          {reachNote}{" "}
          Up to £{COMMUNITY_PRICE_MAX_GBP} a drink. It counts under your public
          handle on the contributor record.
        </p>
      )}
      {contributionGateDialog}
    </section>
  );
}
