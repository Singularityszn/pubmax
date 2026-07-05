"use client";

import { ExternalLink, Flag, PlusCircle, Quote, Waves } from "lucide-react";
import { useMemo } from "react";

import { formatPrice, type Venue } from "@/lib/venues";
import { buildVenueClaims, type ClaimKind, type Provenance } from "@/lib/curation";
import LandlordPanel from "@/components/LandlordPanel";
import PintDropComposer from "@/components/map/PintDropComposer";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { PintDropsState } from "@/components/map/usePintDrops";

const PROVENANCE_LABEL: Record<Provenance, string> = {
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  demo: "Demo",
};

function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  return <span className={`provChip ${provenance}`}>{PROVENANCE_LABEL[provenance]}</span>;
}

const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  baseline: "Baseline",
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  "needs-source": "Needs Source",
};

// Reuses .provChip; needs-source/baseline get their own colour classes in CSS.
function ClaimBadge({ kind }: { kind: ClaimKind }) {
  return <span className={`provChip ${kind}`}>{CLAIM_KIND_LABEL[kind]}</span>;
}

function Amenity({ active, label }: { active: boolean; label: string }) {
  return <span className={active ? "amenity active" : "amenity"}>{label}</span>;
}

type VenueInspectorProps = {
  venue: Venue;
  mode: CrawlMode;
  inCrawl: boolean;
  latestContributorPrice: number | null | undefined;
  onToggleStop: (id: string) => void;
  pintDrops: PintDropsState;
};

export default function VenueInspector({
  venue,
  mode,
  inCrawl,
  latestContributorPrice,
  onToggleStop,
  pintDrops,
}: VenueInspectorProps) {
  const { dropsByVenueId, composerOpen, setComposerOpen, dropMsg, reportDrop } = pintDrops;
  const drops = useMemo(() => dropsByVenueId.get(venue.id) ?? [], [dropsByVenueId, venue.id]);
  const hasDemoDrops = drops.some((drop) => drop.provenance === "demo");
  // The distinct, provenance-stamped claim list for the inspected venue.
  // Editorial Sourced claims and contributor/anecdote drops stay separate.
  const claims = useMemo(() => buildVenueClaims(venue.curation, drops), [venue.curation, drops]);

  return (
    <section className="venueInspector">
      <div className="inspectorTitle">
        <Waves size={17} />
        <span>Venue Detail</span>
      </div>
      <h3>{venue.name}</h3>
      <p>{venue.address}</p>
      <div className="amenityRow">
        <Amenity active={Boolean(venue.curation.nearWater)} label="water" />
        <Amenity active={venue.hasStory} label="heritage" />
        <Amenity active={Boolean(venue.curation.writerPick)} label="writer" />
        <Amenity active={venue.amenities.beerGarden} label="garden" />
        <Amenity active={venue.amenities.liveSports} label="sports" />
        <Amenity active={venue.amenities.food} label="food" />
        <Amenity active={venue.amenities.cocktails} label="cocktails" />
        <Amenity active={venue.amenities.pubQuiz} label="quiz" />
      </div>
      {latestContributorPrice !== null && latestContributorPrice !== undefined ? (
        <div className="contributorPrice">
          <span>Latest Pint Drop price</span>
          <strong>{formatPrice(latestContributorPrice)}</strong>
        </div>
      ) : null}
      {mode === "build" ? (
        <button
          className="addStopBtn"
          aria-pressed={inCrawl}
          onClick={() => onToggleStop(venue.id)}
        >
          {inCrawl ? "Remove from crawl" : "Add to crawl"}
        </button>
      ) : null}
      {venue.description ? (
        <p className="description">{venue.description}</p>
      ) : (
        <p className="description muted">
          No heritage note for {venue.name} yet — log a Pint Drop below with a passed-down story to
          be the first to give this pub some character.
        </p>
      )}
      {claims.length > 0 ? (
        <div className="claimList">
          {claims.map((claim, index) => (
            <div key={`${claim.kind}-${index}`} className="claimCard">
              <div className="claimHead">
                <span className="claimEra">{claim.era ?? claim.label}</span>
                <ClaimBadge kind={claim.kind} />
              </div>
              <p>{claim.content}</p>
              {claim.sourceRef ? (
                <a href={claim.sourceRef} target="_blank" rel="noreferrer">
                  {claim.label}
                  <ExternalLink size={13} />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="priceList">
        {venue.prices.slice(0, 6).map((price) => (
          <div key={price.app_price_id}>
            <span>{price.pint_name}</span>
            <strong>{formatPrice(price.price_gbp)}</strong>
          </div>
        ))}
      </div>

      <section className="pintDrops">
        <div className="inspectorTitle">
          <Quote size={16} />
          <span>Pint Drops</span>
        </div>
        {hasDemoDrops ? (
          <div className="demoDataNote">
            <span>Demo data</span>
            Example Pint Drops are seeded for the walkthrough. Live contributions use the same flow.
          </div>
        ) : null}
        {drops.length === 0 ? (
          <p className="description muted">
            No Pint Drops yet at {venue.name}. Be the first — log tonight&rsquo;s price or pass down
            a story using the button below.
          </p>
        ) : (
          <div className="dropList">
            {drops.map((drop) => (
              <article key={drop.id} className="dropCard">
                <div className="dropHead">
                  <span className="dropHandle">{drop.handle}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                    {drop.priceGbp !== null ? (
                      <span className="dropPrice">{formatPrice(drop.priceGbp)}</span>
                    ) : null}
                    <ProvenanceChip provenance={drop.provenance} />
                  </span>
                </div>
                {drop.pintPhotoUrl || drop.venuePhotoUrl ? (
                  <div className="dropPhotos">
                    {drop.pintPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="dropPhoto"
                        src={drop.pintPhotoUrl}
                        alt={`Pint at ${venue.name} shared by ${drop.handle}`}
                        loading="lazy"
                      />
                    ) : null}
                    {drop.venuePhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="dropPhoto"
                        src={drop.venuePhotoUrl}
                        alt={`View of ${venue.name} shared by ${drop.handle}`}
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                ) : null}
                {drop.passedDownNote ? <p>{drop.passedDownNote}</p> : null}
                <div className="dropFoot">
                  <small>
                    {[drop.drink, drop.era].filter(Boolean).join(" · ") || "Visit report"}
                  </small>
                  {drop.provenance !== "demo" ? (
                    <button
                      type="button"
                      className="reportBtn"
                      onClick={() => reportDrop(venue.id, drop.id)}
                      aria-label={`Report Pint Drop by ${drop.handle}`}
                    >
                      <Flag size={12} /> Report
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}

        {composerOpen ? (
          <PintDropComposer venueId={venue.id} state={pintDrops} />
        ) : (
          <>
            <button className="composerToggle" onClick={() => setComposerOpen(true)}>
              <PlusCircle size={16} /> Log a Pint Drop
            </button>
            {dropMsg ? (
              <span
                role={dropMsg.ok ? "status" : "alert"}
                className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
                style={{ display: "block", marginTop: "8px" }}
              >
                {dropMsg.text}
              </span>
            ) : null}
          </>
        )}
      </section>

      <LandlordPanel
        venueId={venue.id}
        venueName={venue.name}
        context={{
          era: venue.curation.heritageEra,
          heritageNote: venue.curation.heritageNote,
          address: venue.address,
          borough: venue.primaryBorough,
        }}
      />
    </section>
  );
}
