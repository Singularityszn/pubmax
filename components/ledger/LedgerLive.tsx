"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import ReadLedgerButton from "@/components/ledger/ReadLedgerButton";
import PriceBadge, { PintPriceBadge } from "@/components/PriceBadge";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import VenuePriceThen from "@/components/map/VenuePriceThen";
import { displayDrinkName } from "@/components/listing/displayCase";
import { formatGbp } from "@/lib/formatGbp";
import { firstHttp } from "@/lib/httpUrl";
import { formatLedgerDate, type LedgerPintPrice } from "@/lib/ledger";
import { displayHandle } from "@/lib/handleDisplay";
import { PINT_TRUST_LINE } from "@/lib/pintTrust";
import { pintPriceSplitLine } from "@/lib/pintDropAgreement";
import { venuePriceLane, venuePriceLaneIsDrinkerLog, venuePriceLaneObservedGbp, type VenueBundlePrices, type VenuePriceLane } from "@/lib/venuePriceLane";
import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import { venueListedPint, type VenueListedPint } from "@/lib/venueListedPint";
import type { PricedVenue } from "@/lib/priceUpdates";
import { HOW_WE_ESTIMATE_HREF, HOW_WE_ESTIMATE_LABEL, priceStandingFor, priceStandingFigure, priceStandingNote } from "@/lib/priceTier";
import ShareWithFamilyButton from "@/components/ledger/ShareWithFamilyButton";
import type { VenueClaim } from "@/lib/curation";
import type { FamilyTableEntry, LedgerEntry, RedactedFamilyEntry } from "@/lib/ledger";

// THE LEDGER'S LIVE HALF, drawn after load (task vercel-f2-seo-cdn, option a).
// The /ledger/[id] document is prerendered and held by the CDN, so it carries
// the pub's bundled facts and the curated story line, and nothing a drinker
// wrote. This provider reads the rest from GET /api/ledger/[id], per request
// and never cached, sending the session's own bearer token so the viewer's OWN
// Family Table rows come back in full. A browser navigation never sent that
// header, so the document was always the redacted copy; this is the first time
// an author actually reads their own legacy note on the page.

type LedgerLog = {
  pintPrice?: LedgerPintPrice | null;
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

function useLedgerLive(): LedgerLiveValue {
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
  const sourceUrl = firstHttp(publication?.sourceUrl);
  return publication ? <>
    <p>Published price</p>
    <p>
      {publication.priceGbp !== null ? <PintPriceBadge priceGbp={publication.priceGbp} venueId={venueId} /> : null}{" "}
      Cheapest listed pint
    </p>
    <p>
      {sourceLabel ? <>Listed by {sourceUrl
        ? <a className="ledgerMapLink" href={sourceUrl} target="_blank" rel="noopener noreferrer">{sourceLabel}</a>
        : <>{sourceLabel}. Link unavailable.</>}</> : "Publisher not recorded"}, collected{" "}
      <time dateTime={publication.observedAt}>{formatLedgerDate(publication.observedAt)}</time>.
    </p>
  </> : publishedLane?.lane === "baseline" ? <>
    <p>Price on record</p>
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

/** Public reports arrive with the logbook, never in the shared cached document. */
export function LedgerPriceRecord({ venue, bundle }: {
  venue: LedgerPriceVenue;
  bundle: VenueBundlePrices;
}) {
  const venueId = venue.id;
  const listedPint = venueListedPint(venue);
  const pintVenue = {
    cheapestPrice: venue.sourcedPrice ? venue.cheapestPrice : listedPint?.priceGbp ?? null,
    prices: venue.prices,
  };
  const { state, reload } = useLedgerLive();
  const publicPint = state.status === "ready" ? state.log.pintPrice : null;
  // A cached document cannot know whether a public report exists.
  const readableBundle = state.status === "ready" ? bundle : { ...bundle, estimate: null };
  const reportPrice = publicPint?.priceGbp != null
    ? { priceGbp: publicPint.priceGbp, observedAt: publicPint.createdAt }
    : null;
  const priceLane = venuePriceLane(
    pintVenue,
    publicPint?.state === "confirmed" || publicPint?.state === "corroborated" ? publicPint.priceGbp : null,
    venue.sourcedPrice,
    readableBundle,
    publicPint?.state === "logged-once" ? reportPrice : null,
    publicPint?.state === "aged-out" ? reportPrice : null,
    publicPint?.split ? { split: publicPint.split, observedAt: publicPint.createdAt } : null,
  );
  const publishedLane = venuePriceLane(pintVenue, null, venue.sourcedPrice, readableBundle);
  const currentPriceGbp = priceLane ? venuePriceLaneObservedGbp(priceLane) : undefined;
  const publishedRecord = publicPint && publishedLane?.lane === "estimate" ? null
    : <LedgerPublishedPriceRecord publishedLane={publishedLane} listedPint={listedPint} venueId={venueId} />;
  const reportRecord = publicPint ? <>
    <p>Public pint report</p>
    {publicPint.split ? <p>{pintPriceSplitLine(publicPint.split)}</p> : publicPint.priceGbp !== null ? (
      <p><PriceBadge>{formatGbp(publicPint.priceGbp)}</PriceBadge>{" "}{displayDrinkName(publicPint.drink) || "Beer"} · Pint</p>
    ) : null}
    <p>
      Logged by {publicPint.handle === ANON_HANDLE_LABEL ? ANON_HANDLE_LABEL : displayHandle(publicPint.handle)} on{" "}
      <time dateTime={publicPint.createdAt}>{formatLedgerDate(publicPint.createdAt)}</time>.{" "}
      <Link className="ledgerMapLink" href={`/p/${encodeURIComponent(publicPint.dropId)}`}>View Pint Drop</Link>
    </p>
    {PINT_TRUST_LINE[publicPint.state] ? <p>{PINT_TRUST_LINE[publicPint.state]}</p> : null}
  </> : null;

  return (
    <section className="ledgerSection" aria-labelledby="ledgerPriceHeading">
      <h2 className="ledgerSectionTitle" id="ledgerPriceHeading">Price record</h2>
      {priceLane && venuePriceLaneIsDrinkerLog(priceLane) ? <>{reportRecord}{publishedRecord}</> : <>{publishedRecord}{reportRecord}</>}
      {!priceLane && state.status === "ready" ? <p>No pint price is on record yet.</p>
        : !priceLane && state.status === "unavailable" ? <p role="status">
          The price record did not answer just now.{" "}
          <button type="button" className="ledgerMapLink" onClick={reload}>Try again</button>
        </p> : !priceLane ? <p role="status">Checking the price record.</p> : null}
      <VenuePriceThen venueId={venueId} currentPriceGbp={currentPriceGbp} />
    </section>
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

/**
 * The story, the logbook and the Family Table. `curatedClaims` is the story the
 * bundled dataset tells (the document's own copy, so a crawler and a reader
 * with no script still get it); once the live read lands, its list (the same
 * curated line first, then every drop-derived line) takes its place.
 */
export function LedgerLogSections({
  venueName,
  ledgerUrl,
  curatedClaims,
}: {
  venueName: string;
  ledgerUrl: string;
  curatedClaims: VenueClaim[];
}) {
  const live = useLedgerLive();
  const { state } = live;
  const claims = state.status === "ready" ? state.log.claims : curatedClaims;

  return (
    <>
      <ClaimList claims={claims} />

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
