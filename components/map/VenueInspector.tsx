"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Flag, MapPin, PlusCircle, Quote, Waves } from "lucide-react";
import { useMemo, useState } from "react";

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

  // "I'm here tonight" presence (PRD §1.5 / §5.1 — the tonight loop). Opt-in: it
  // only ever fires from a deliberate tap of this button — NO auto-tracking, NO
  // GPS. Identity is the viewer's self-asserted handle (localStorage
  // `pubmax_handle`, the same one the composer uses); with none set we point them
  // to claim one rather than posting anonymously. Local, per-venue state only —
  // setState fires from the click handler (never an effect), plus the
  // React-recommended "reset on prop change during render" below (no effect).
  const [presenceState, setPresenceState] = useState<"idle" | "sending" | "here" | "no-handle">(
    "idle",
  );
  // The panel isn't remounted when the selected pub changes (PubMap keeps one
  // VenueInspector), so a stale "You're here" would linger on the next venue.
  // React's adjust-state-during-render pattern resets it when the venue id
  // changes — no effect, so react-hooks/set-state-in-effect stays satisfied.
  const [presenceVenueId, setPresenceVenueId] = useState(venue.id);
  if (presenceVenueId !== venue.id) {
    setPresenceVenueId(venue.id);
    setPresenceState("idle");
  }

  async function markPresenceHere() {
    if (presenceState === "sending" || presenceState === "here") return;
    const handle =
      typeof window === "undefined" ? "" : (window.localStorage.getItem("pubmax_handle") ?? "").trim();
    if (!handle) {
      setPresenceState("no-handle");
      return;
    }
    setPresenceState("sending");
    try {
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, venueId: venue.id }),
      });
      // Presence is best-effort: a non-ok response still lands the viewer back on
      // an actionable state rather than a spinner. A 200 confirms "you're here".
      setPresenceState(res.ok ? "here" : "idle");
    } catch {
      setPresenceState("idle");
    }
  }
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
      <div className="presenceHere">
        {presenceState === "here" ? (
          <p
            className="presenceHereConfirm"
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              margin: "12px 0 0",
              minHeight: "42px",
              fontWeight: 700,
              color: "var(--brass)",
            }}
          >
            <MapPin size={15} aria-hidden="true" /> You&rsquo;re here 🍺
          </p>
        ) : (
          <button
            type="button"
            className="addStopBtn"
            onClick={markPresenceHere}
            disabled={presenceState === "sending"}
            aria-label={`Mark that you're at ${venue.name} tonight`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <MapPin size={15} aria-hidden="true" />
            {presenceState === "sending" ? "Checking in…" : "I'm here"}
          </button>
        )}
        {presenceState === "no-handle" ? (
          <p
            className="description muted"
            style={{ marginTop: "8px", fontSize: "0.82rem" }}
          >
            Claim a handle to check in — <Link href="/u/you">set yours</Link>.
          </p>
        ) : null}
      </div>
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
            {drops.map((drop) => {
              const hasPhotos = Boolean(drop.pintPhotoUrl || drop.venuePhotoUrl);
              return (
                <article
                  key={drop.id}
                  className={hasPhotos ? "dropCard instaPint" : "dropCard"}
                >
                  <div className="dropHead">
                    <span className="dropHandle">{drop.handle}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      {drop.priceGbp !== null ? (
                        <span className="dropPrice">{formatPrice(drop.priceGbp)}</span>
                      ) : null}
                      <ProvenanceChip provenance={drop.provenance} />
                    </span>
                  </div>
                  {/* InstaPint: the pint + the cheeky bar selfie shown as a
                      framed image pair (Instagram-ish), the note/tags below as a
                      caption. A single photo fills the frame; a drop with no
                      photo still reads fine as a text card (the block is skipped). */}
                  {hasPhotos ? (
                    <div className="instaFrame">
                      {drop.pintPhotoUrl ? (
                        <figure className="instaShot">
                          <Image
                            className="dropPhoto"
                            src={drop.pintPhotoUrl}
                            alt={`Pint at ${venue.name} shared by ${drop.handle}`}
                            width={480}
                            height={480}
                            loading="lazy"
                            unoptimized
                          />
                          <figcaption>the pint</figcaption>
                        </figure>
                      ) : null}
                      {drop.venuePhotoUrl ? (
                        <figure className="instaShot">
                          <Image
                            className="dropPhoto"
                            src={drop.venuePhotoUrl}
                            alt={`${drop.handle} at the bar at ${venue.name}`}
                            width={480}
                            height={480}
                            loading="lazy"
                            unoptimized
                          />
                          <figcaption>at the bar</figcaption>
                        </figure>
                      ) : null}
                    </div>
                  ) : null}
                  {drop.passedDownNote ? <p className="dropCaption">{drop.passedDownNote}</p> : null}
                  {drop.vibeTags && drop.vibeTags.length > 0 ? (
                    <div className="dropVibeTags">
                      {drop.vibeTags.map((tag) => (
                        <span key={tag} className="vibeChip small">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
              );
            })}
          </div>
        )}

        {composerOpen ? (
          <PintDropComposer venueId={venue.id} state={pintDrops} />
        ) : (
          <div className="logDropBar">
            <button
              className="logDropBtn"
              onClick={() => setComposerOpen(true)}
              aria-label={`Log a Pint Drop at ${venue.name}`}
            >
              <PlusCircle size={17} /> Log a Pint Drop
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
          </div>
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
