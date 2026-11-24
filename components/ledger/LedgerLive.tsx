"use client";

import Link from "next/link";
import type { BarTab } from "@/lib/feed";
import { priceDateWord } from "@/lib/priceDateWord";
import { priceSourceOf } from "@/lib/priceSourceLink";
import PriceSourceName from "@/components/venue/PriceSourceName";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import ReadLedgerButton from "@/components/ledger/ReadLedgerButton";
import VisitReportPanel from "@/components/visits/VisitReportPanel";
import VenuePhotoWall from "@/components/venue/VenuePhotoWall";
import PriceBadge, { PintPriceBadge } from "@/components/PriceBadge";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import VenuePriceThen from "@/components/map/VenuePriceThen";
import { displayDrinkName } from "@/components/listing/displayCase";
import { formatGbp } from "@/lib/formatGbp";
import { formatLedgerDate, type LedgerPintPrice } from "@/lib/ledger";
import { dropAuthorLabel } from "@/lib/handleDisplay";
import { PINT_TRUST_LINE } from "@/lib/pintTrust";
import { pintPriceSplitLine } from "@/lib/pintDropAgreement";
import { uncheckedPriceLine, venuePriceLane, venuePriceLaneIsDrinkerLog, venuePriceLaneObservedGbp, type VenueBundlePrices, type VenuePriceLane } from "@/lib/venuePriceLane";
import type { VenueListedPint } from "@/lib/venueListedPint";
import type { LedgerPublishedPrice } from "@/lib/ledgerPublishedPrice";
import type { PricedVenue } from "@/lib/priceUpdates";
import { HOW_WE_ESTIMATE_HREF, HOW_WE_ESTIMATE_LABEL, priceStandingFor, priceStandingFigure, priceStandingNote } from "@/lib/priceTier";
import ShareWithFamilyButton from "@/components/ledger/ShareWithFamilyButton";
import type { VenueClaim } from "@/lib/curation";
import type { FamilyTableEntry, LedgerEntry, RedactedFamilyEntry } from "@/lib/ledger";

// Contributions load separately from the venue document so each read can
// apply current visibility and the viewer's bearer token. The cache contract
// is owned by docs/rules/app-proxy-csp-caching-and-file-tracing.md.

type LedgerLog = {
  barTab?: BarTab;
  pintPrice?: LedgerPintPrice | null;
  publicPricePresence?: import("@/lib/publicPricePresence").PublicPricePresence;
  claims: VenueClaim[];
  entries: LedgerEntry[];
  familyEntries: Array<FamilyTableEntry | RedactedFamilyEntry>;
};

type LedgerLiveState =
  | { status: "loading" }
  | { status: "ready"; log: LedgerLog }
  | { status: "unavailable" };

/** An answer, and the session token it was read for. */
type LedgerRead =
  | { status: "loading" }
  | { status: "ready"; log: LedgerLog; token: string | null; venueId: string }
  | { status: "unavailable"; token: string | null; venueId: string };

type LedgerLiveValue = { state: LedgerLiveState; reload: () => void };

const LedgerLiveContext = createContext<LedgerLiveValue>({
  state: { status: "loading" },
  reload: () => {},
});

/** The dev/test ?viewer= fallback, forwarded so local QA keeps working. The
 *  route ignores it in production (lib/pintDropViewer.ts). */
function viewerQuery(): string {
  if (typeof window === "undefined") return "";
  const viewer = new URLSearchParams(window.location.search).get("viewer");
  return viewer ? `?viewer=${encodeURIComponent(viewer)}` : "";
}

export function LedgerLiveProvider({
  venueId,
  children,
}: {
  venueId: string;
  children: ReactNode;
}) {
  const { session, loading } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [read, setRead] = useState<LedgerRead>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Wait for the first session read, so a signed-in reader asks once, with
    // their token, rather than once anonymously and again after.
    if (loading) return;
    let cancelled = false;
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    fetch(`/api/ledger/${encodeURIComponent(venueId)}${viewerQuery()}`, { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`ledger read ${res.status}`);
        return (await res.json()) as LedgerLog;
      })
      .then((log) => {
        if (!cancelled) setRead({ status: "ready", log, token: accessToken, venueId });
      })
      .catch(() => {
        if (!cancelled) setRead({ status: "unavailable", token: accessToken, venueId });
      });
    return () => {
      cancelled = true;
    };
  }, [venueId, accessToken, loading, attempt]);

  const reload = useCallback(() => {
    setRead({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  // An answer read for another session is never drawn. A ready answer holds
  // its reader's OWN unredacted Family Table rows, so when the session changes
  // on this page (sign-out, account switch) they leave the screen in the same
  // render, not when the next read lands; a slow or hung read would otherwise
  // show them to whoever now holds the device.
  const state: LedgerLiveState =
    read.status === "loading" || read.token !== accessToken || read.venueId !== venueId
      ? { status: "loading" }
      : read.status === "ready"
        ? { status: "ready", log: read.log }
        : { status: "unavailable" };

  return (
    <LedgerLiveContext.Provider value={{ state, reload }}>{children}</LedgerLiveContext.Provider>
  );
}

export function useLedgerLive(): LedgerLiveValue {
  return useContext(LedgerLiveContext);
}

/** "Read this page": the pub's own lines, then the newest few logbook entries
 *  once they have arrived, kept short for a screen reader / TTS pass. */
export function LedgerReadAloud({ intro }: { intro: string[] }) {
  const { state } = useLedgerLive();
  const entries = state.status === "ready" ? state.log.entries : [];
  const text = [
    ...intro,
    ...entries
      .slice(0, 5)
      .map((entry) => (entry.dateLabel ? `${entry.dateLabel}: ${entry.note}` : entry.note)),
  ]
    .filter(Boolean)
    .join(" ");
  return <ReadLedgerButton text={text} />;
}

type LedgerPriceVenue = Pick<PricedVenue,
  "id" | "cheapestPrice" | "cheapestPint" | "prices" | "sourcedPrice"
>;

function LedgerPublishedPriceRecord({ publishedLane, listedPint, venueId }: {
  publishedLane: VenuePriceLane | null;
  listedPint: VenueListedPint | null;
  venueId: string;
}) {
  const publication = publishedLane?.lane === "sourced"
    ? { priceGbp: publishedLane.cheapestPrice, sourceUrl: publishedLane.sourcedPrice.sourceUrl,
        sourceLabel: publishedLane.sourcedPrice.sourceLabel, observedAt: publishedLane.sourcedPrice.observedAt }
    : publishedLane?.lane === "listed"
      ? { ...publishedLane.listed, sourceLabel: publishedLane.listed.publisher }
      : null;
  const sourceLabel = typeof publication?.sourceLabel === "string" ? publication.sourceLabel.trim() : "";
  return publication ? <>
    <p>Published price</p>
    <p>
      {publication.priceGbp !== null ? <PintPriceBadge priceGbp={publication.priceGbp} venueId={venueId} /> : null}{" "}
      Cheapest listed pint
    </p>
    <p>
      {sourceLabel ? "Listed by " : null}<PriceSourceName className="ledgerSourceLink" label={sourceLabel} url={publication.sourceUrl} />
      {priceSourceOf(sourceLabel, publication.sourceUrl).kind === "refused" ? ` ${priceDateWord("read", true)}` : `, ${priceDateWord("read")}`}{" "}
      <time dateTime={publication.observedAt}>{formatLedgerDate(publication.observedAt)}</time>.
    </p>
  </> : publishedLane?.lane === "baseline" ? <>
    <p>
      <PintPriceBadge priceGbp={publishedLane.cheapestPrice} venueId={venueId} />{" "}
      {listedPint?.pintName ? displayDrinkName(listedPint.pintName) : "Cheapest listed pint"}
    </p>
    <ListedPriceSource evidence={listedPint ?? publishedLane} />
  </> : publishedLane?.lane === "estimate" ? <>
    <p>Estimated pint price</p>
    <p>{priceStandingFigure(priceStandingFor({ estimate: publishedLane.estimate }))}</p>
    <p>{priceStandingNote("estimate")}</p>
    <p>
      Modelled from {publishedLane.estimate.sampleSize} published {publishedLane.estimate.sampleSize === 1 ? "price" : "prices"} ({publishedLane.estimate.basis.replaceAll("_", " ")}), calculated on{" "}
      <time dateTime={publishedLane.estimate.computedAt}>{formatLedgerDate(publishedLane.estimate.computedAt)}</time>.{" "}
      <Link className="ledgerMapLink" href={HOW_WE_ESTIMATE_HREF}>{HOW_WE_ESTIMATE_LABEL}</Link>
    </p>
  </> : null;
}

/**
 * What the record's public report hands `venuePriceLane`, one lane per trust
 * state. An unchecked price uses the same lone-report slot as a receipt-backed
 * price, carrying the name it was logged under, so the lane prints it "not
 * checked" and unbanded (captain decision 9, lib/venuePriceLane.ts).
 */
function ledgerReportLanes(publicPint: LedgerPintPrice | null | undefined) {
  if (!publicPint) return { contributor: null, provisional: null, aged: null, disputed: null };
  const report = publicPint.priceGbp != null
    ? {
        priceGbp: publicPint.priceGbp,
        observedAt: publicPint.createdAt,
        ...(publicPint.unchecked ? { uncheckedBy: publicPint.handle } : {}),
      }
    : null;
  const authority = publicPint.state === "confirmed" || publicPint.state === "corroborated";
  const lone = publicPint.state === "logged-once" || publicPint.state === "unchecked";
  return {
    contributor: authority ? publicPint.priceGbp : null,
    provisional: lone ? report : null,
    aged: publicPint.state === "aged-out" ? report : null,
    disputed: publicPint.split ? { split: publicPint.split, observedAt: publicPint.createdAt } : null,
  };
}

/** Who logged the report, in the words its standing allows (decision 9). */
function ledgerReportAuthor(publicPint: LedgerPintPrice): string {
  if (publicPint.unchecked) return `${uncheckedPriceLine(publicPint.handle)},`;
  return `Logged by ${dropAuthorLabel(publicPint.handle)}`;
}

/** Public reports arrive with the logbook, never in the shared cached document. */
export function LedgerPriceRecord({ venue, bundle, publishedPrice }: {
  venue: LedgerPriceVenue;
  bundle: VenueBundlePrices;
  publishedPrice: LedgerPublishedPrice;
}) {
  const venueId = venue.id;
  const { listedPint, pintVenue } = publishedPrice;
  const { state, reload } = useLedgerLive();
  const publicPint = state.status === "ready" ? state.log.pintPrice : null;
  // A cached document cannot establish complete public-price absence.
  const readableBundle = state.status === "ready" && state.log.publicPricePresence === "absent" ? bundle : { ...bundle, estimate: null };
  const reportLanes = ledgerReportLanes(publicPint);
  const priceLane = venuePriceLane(
    pintVenue,
    reportLanes.contributor,
    venue.sourcedPrice,
    readableBundle,
    reportLanes.provisional,
    reportLanes.aged,
    reportLanes.disputed,
  );
  const publishedLane = publishedPrice.publishedLane?.lane === "estimate" && !readableBundle.estimate
    ? null : publishedPrice.publishedLane;
  const currentPriceGbp = priceLane ? venuePriceLaneObservedGbp(priceLane) : undefined;
  const publishedRecord = publicPint && publishedLane?.lane === "estimate" ? null
    : <LedgerPublishedPriceRecord publishedLane={publishedLane} listedPint={listedPint} venueId={venueId} />;
  const reportRecord = publicPint ? <>
    <p>Public pint report</p>
    {publicPint.split ? <p>{pintPriceSplitLine(publicPint.split)}</p> : publicPint.priceGbp !== null ? (
      <p><PriceBadge>{formatGbp(publicPint.priceGbp)}</PriceBadge>{" "}{displayDrinkName(publicPint.drink) || "Beer"} · Pint</p>
    ) : null}
    <p>
      {ledgerReportAuthor(publicPint)} on{" "}
      <time dateTime={publicPint.createdAt}>{formatLedgerDate(publicPint.createdAt)}</time>.{" "}
      <Link className="ledgerMapLink" href={`/p/${encodeURIComponent(publicPint.dropId)}`}>View Pint Drop</Link>
    </p>
    {PINT_TRUST_LINE[publicPint.state] ? <p>{PINT_TRUST_LINE[publicPint.state]}</p> : null}
  </> : null;

  return (
    <section className="ledgerSection" aria-labelledby="ledgerPriceHeading">
      <h2 className="ledgerSectionTitle" id="ledgerPriceHeading">Price record</h2>
      {priceLane && venuePriceLaneIsDrinkerLog(priceLane) ? <>{reportRecord}{publishedRecord}</> : <>{publishedRecord}{reportRecord}</>}
      {!priceLane && state.status === "ready" && state.log.publicPricePresence === "absent" ? <p>No pint price is on record yet.</p>
        : !priceLane && state.status === "ready" && state.log.publicPricePresence === "present" ? <p>A public price is on record.</p>
        : !priceLane && (state.status === "unavailable" || state.status === "ready") ? <p role="status">
          The price record did not answer just now.{" "}
          <button type="button" className="ledgerMapLink" onClick={reload}>Try again</button>
        </p> : !priceLane ? <p role="status">Checking the price record.</p> : null}
      <VenuePriceThen venueId={venueId} currentPriceGbp={currentPriceGbp} />
    </section>
  );
}

export function LedgerCommunity({ venueId, venueName, ledgerUrl, curatedClaims }: {
  venueId: string;
  venueName: string;
  ledgerUrl: string;
  curatedClaims: VenueClaim[];
}) {
  const { state } = useLedgerLive();
  const [visitsEmpty, setVisitsEmpty] = useState(false);
  const [photosEmpty, setPhotosEmpty] = useState(false);
  const claims = state.status === "ready" ? state.log.claims : curatedClaims;
  const logEmpty = state.status === "ready"
    && state.log.entries.length === 0 && state.log.familyEntries.length === 0;
  const allEmpty = logEmpty && visitsEmpty && photosEmpty;

  return (
    <>
      <ClaimList claims={claims} />
      <details className="ledgerCommunity" open={!allEmpty}>
        <summary hidden={!allEmpty}>Be the first to log here</summary>
        <div>
          <VisitReportPanel venueId={venueId} venueName={venueName} onEmptyChange={setVisitsEmpty} />
          <VenuePhotoWall venueId={venueId} venueName={venueName} onEmptyChange={setPhotosEmpty} />
          <p className="ledgerLaneNote">Public notes go in the logbook. Legacy notes stay at the Family Table below.</p>
          <LedgerLogSections venueName={venueName} ledgerUrl={ledgerUrl} />
        </div>
      </details>
    </>
  );
}

function isFullFamilyEntry(
  entry: FamilyTableEntry | RedactedFamilyEntry,
): entry is FamilyTableEntry {
  return "note" in entry;
}

function ClaimList({ claims }: { claims: VenueClaim[] }) {
  if (claims.length === 0) return null;
  return (
    <section className="ledgerSection" aria-labelledby="ledgerClaimsHeading">
      <h2 id="ledgerClaimsHeading" className="ledgerSectionTitle">
        The pub&rsquo;s story
      </h2>
      <ul className="ledgerClaimList">
        {claims.map((claim, index) => (
          <li className="ledgerClaim" key={`${claim.kind}-${index}`}>
            <span className={`ledgerProvenance ledgerProvenance--${claim.kind}`}>
              {claim.label}
            </span>
            <p className="ledgerClaimBody">
              {claim.content}
              {claim.era ? <span className="ledgerClaimEra"> · {claim.era}</span> : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LiveStatus({ state, reload }: LedgerLiveValue) {
  if (state.status === "unavailable") {
    return (
      <p className="ledgerEmptyEntries" role="status">
        The logbook did not answer just now.{" "}
        <button type="button" className="ledgerMapLink" onClick={reload}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <p className="ledgerEmptyEntries" role="status">
      Opening the logbook.
    </p>
  );
}

function LedgerLogSections({
  venueName,
  ledgerUrl,
}: {
  venueName: string;
  ledgerUrl: string;
}) {
  const live = useLedgerLive();
  const { state } = live;

  return (
    <>
      <section className="ledgerSection" aria-labelledby="ledgerEntriesHeading">
        <h2 id="ledgerEntriesHeading" className="ledgerSectionTitle">
          Logbook
        </h2>
        {state.status !== "ready" ? (
          <LiveStatus {...live} />
        ) : state.log.entries.length === 0 ? (
          <p className="ledgerEmptyEntries">
            No entries logged yet. The first Pint Drop here will open the logbook.
          </p>
        ) : (
          <ol className="ledgerEntries" aria-label={`Logbook entries for ${venueName}`}>
            {state.log.entries.map((entry) => (
              <li className="ledgerEntry" key={entry.id}>
                <article aria-label={`Logbook entry, ${entry.dateLabel || "undated"}`}>
                  <div className="ledgerEntryMeta">
                    {entry.dateLabel ? (
                      <time className="ledgerEntryDate" dateTime={entry.createdAt}>
                        {entry.dateLabel}
                      </time>
                    ) : (
                      <span className="ledgerEntryDate">Undated</span>
                    )}
                    <span className={`ledgerProvenance ledgerProvenance--${entry.provenance}`}>
                      {entry.provenance === "demo" ? "Demo" : entry.handle}
                    </span>
                  </div>
                  <p className="ledgerEntryNote">{entry.note}</p>
                  {entry.priceLabel ? (
                    <p className="ledgerEntryPrice">
                      <span className="ledgerEntryPriceLabel">Paid</span>{" "}
                      <PriceBadge className="ledgerEntryPriceValue">{entry.priceLabel}</PriceBadge>
                    </p>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="ledgerSection ledgerFamilySection" aria-labelledby="ledgerFamilyHeading">
        <div className="ledgerFamilyHead">
          <h2 id="ledgerFamilyHeading" className="ledgerSectionTitle">
            The Family Table
          </h2>
          <ShareWithFamilyButton venueName={venueName} url={ledgerUrl} />
        </div>
        <p className="ledgerFamilyIntro">
          Some stories aren&rsquo;t for the feed. Kept here for whoever in the family reads them next.
        </p>
        {state.status !== "ready" ? null : state.log.familyEntries.length === 0 ? (
          <p className="ledgerFamilyEmpty">
            Some stories are kept for the family table. Log a pint and choose Legacy to leave one.
          </p>
        ) : (
          <ol className="ledgerFamilyEntries" aria-label={`Family table entries for ${venueName}`}>
            {state.log.familyEntries.map((entry) => (
              <li className="ledgerFamilyEntry" key={entry.id}>
                <article aria-label={`Family table entry, ${entry.dateLabel || "undated"}`}>
                  <div className="ledgerFamilyEntryMeta">
                    {entry.dateLabel ? (
                      <time className="ledgerFamilyEntryDate" dateTime={entry.createdAt}>
                        {entry.dateLabel}
                      </time>
                    ) : (
                      <span className="ledgerFamilyEntryDate">Undated</span>
                    )}
                    <span className="ledgerFamilyEntryHandle">
                      {entry.handle}
                      {entry.era ? <span className="ledgerClaimEra"> · {entry.era}</span> : null}
                    </span>
                  </div>
                  {isFullFamilyEntry(entry) ? (
                    <>
                      <p className="ledgerFamilyEntryNote">{entry.note}</p>
                      {entry.priceLabel ? (
                        <p className="ledgerEntryPrice">
                          <span className="ledgerEntryPriceLabel">Paid</span>{" "}
                          <PriceBadge className="ledgerEntryPriceValue">{entry.priceLabel}</PriceBadge>
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="ledgerFamilyEntryNote">A story kept for the family table.</p>
                  )}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
