"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Flag, MapPin, PlusCircle, Quote, Waves } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { COMMUNITY_PRICE_NOTE, formatFreshness, formatPrice, type Venue } from "@/lib/venues";
import { buildVenueClaims, type ClaimKind, type Provenance } from "@/lib/curation";
import {
  accessibilityChipLabels,
  quietHoursLabel,
} from "@/lib/venueAccessibility";
import LandlordPanel from "@/components/LandlordPanel";
import LastTrainCard from "./LastTrainCard";
import PintDropComposer from "@/components/map/PintDropComposer";
import VenuePriceStory from "@/components/map/VenuePriceStory";
import SaveToListControl from "@/components/savedpubs/SaveToListControl";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { PintDropsState } from "@/components/map/usePintDrops";
import DrinkMenu from "@/components/drinks/DrinkMenu";
import { venueMenuForInspector } from "@/lib/venueMenu";

import "./venueSheet.css";
import "./accessibilityFilters.css";

// Mobile-first tabs regroup the panel's long vertical scroll into thumb-friendly
// sections (most PUBMAXXERs are on a phone while travelling). Pints is the
// primary tab. "getting-home" is a placeholder slot the orchestrator fills with
// a transport card built by another agent — we only render its mount point here.
type TabKey = "overview" | "pints" | "menu" | "story" | "ask" | "getting-home";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "pints", label: "Pints" },
  { key: "menu", label: "Menu" },
  { key: "story", label: "Story" },
  { key: "ask", label: "Ask" },
  { key: "getting-home", label: "Getting home" },
];

const DEFAULT_TAB: TabKey = "pints";

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
  // The mobile bottom-sheet drag gesture (GH #17) lives in PubMap.tsx (the
  // owner of the .mapDrawer seam); this component only exposes the grab
  // handle as a pointer-event surface so the drag can start from the visible
  // grabber, not just the header bar above it. All three are no-ops on
  // desktop (PubMap gates the gesture to ≤640px before anything fires).
  onGrabDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragMove?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragEnd?: (event: React.PointerEvent<HTMLElement>) => void;
};

export default function VenueInspector({
  venue,
  mode,
  inCrawl,
  latestContributorPrice,
  onToggleStop,
  pintDrops,
  onGrabDragStart,
  onGrabDragMove,
  onGrabDragEnd,
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

  // Active tab is local state (Pints is the primary content, so the default).
  // Like presence above, the panel isn't remounted between venues, so a stale
  // tab could linger — React's adjust-state-during-render pattern resets it when
  // the venue id changes (mirrors presenceVenueId). NEVER setState in an effect
  // here (react-hooks/set-state-in-effect is an error in this repo).
  const [tab, setTab] = useState<TabKey>(DEFAULT_TAB);
  const [tabVenueId, setTabVenueId] = useState(venue.id);
  if (tabVenueId !== venue.id) {
    setTabVenueId(venue.id);
    setTab(DEFAULT_TAB);
  }

  // Refs to the tab buttons so arrow keys can move focus as selection moves
  // (roving tabindex / APG tabs pattern).
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    overview: null,
    pints: null,
    menu: null,
    story: null,
    ask: null,
    "getting-home": null,
  });

  function selectTab(next: TabKey) {
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: TabKey) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.key === current);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + delta + TABS.length) % TABS.length;
    selectTab(TABS[nextIndex].key);
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

  // Known-true accessibility facts only (PRD issue #28). Unknown/known-false
  // facets render nothing — never a "No" — per the provenance-honesty rule.
  const accessChips = accessibilityChipLabels(venue);
  const quietHours = quietHoursLabel(venue);

  // The Menu tab's full drink list (beer from venue.prices + seeded non-beer
  // drinks) — see lib/venueMenu.ts for the composition seam.
  const menuDrinks = useMemo(() => venueMenuForInspector(venue), [venue]);

  return (
    <section className="venueInspector">
      {/* The grab handle is the primary drag surface on mobile — a generous
          hit area (not just the thin visual bar) so it's easy to grab with a
          thumb. Pointer handlers are optional props; when absent (e.g. any
          future non-map usage of this component) it's simply not draggable. */}
      <div
        className="venueSheetGrabZone"
        onPointerDown={onGrabDragStart}
        onPointerMove={onGrabDragMove}
        onPointerUp={onGrabDragEnd}
        onPointerCancel={onGrabDragEnd}
      >
        <span className="venueSheetGrab" aria-hidden="true" />
      </div>
      <div className="inspectorTitle">
        <Waves size={17} />
        <span>Venue Detail</span>
      </div>
      <h3>{venue.name}</h3>

      <div className="venueTabs" role="tablist" aria-label="Venue detail sections">
        {TABS.map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`venueTab-${key}`}
              aria-controls={`venuePanel-${key}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={active ? "venueTab active" : "venueTab"}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              onClick={() => selectTab(key)}
              onKeyDown={(event) => onTabKeyDown(event, key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Overview — identity, latest price, add-to-crawl, "I'm here tonight". */}
      <div
        role="tabpanel"
        id="venuePanel-overview"
        aria-labelledby="venueTab-overview"
        className="venueTabPanel"
        hidden={tab !== "overview"}
      >
        <p className="venueAddress">{venue.address}</p>
        <div className="amenityRow">
          <Amenity active={Boolean(venue.curation.nearWater)} label="water" />
          <Amenity active={venue.hasStory} label="heritage" />
          <Amenity active={Boolean(venue.curation.writerPick)} label="writer" />
          <Amenity active={venue.amenities.beerGarden} label="garden" />
          <Amenity active={venue.amenities.nonAlcoholic} label="0.0" />
          <Amenity active={venue.amenities.liveSports} label="sports" />
          <Amenity active={venue.amenities.food} label="food" />
          <Amenity active={venue.amenities.cocktails} label="cocktails" />
          <Amenity active={venue.amenities.pubQuiz} label="quiz" />
        </div>
        {/* Accessibility — only publicly-confirmed facts, shown as chips. A pub
            with no confirmed access facts shows nothing here (never a "No"). */}
        {accessChips.length > 0 ? (
          <div className="accessibilityChips" aria-label="Confirmed accessibility">
            {accessChips.map((label) => (
              <span key={label} className="accessibilityChip">
                {label}
              </span>
            ))}
          </div>
        ) : null}
        {quietHours ? (
          <p className="accessibilityQuietHours">
            <strong>Quiet hours:</strong> {quietHours}
          </p>
        ) : null}
        {latestContributorPrice !== null && latestContributorPrice !== undefined ? (
          <div className="contributorPrice">
            <span>Latest Pint Drop price</span>
            <strong>{formatPrice(latestContributorPrice)}</strong>
            {venue.latestContributorAt ? (
              <small>{formatFreshness(venue.latestContributorAt)}</small>
            ) : null}
            <small className="communityPriceNote">{COMMUNITY_PRICE_NOTE}</small>
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
        <SaveToListControl venueId={venue.id} venueName={venue.name} />
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
      </div>

      {/* Pints — the primary tab: demo note, drops list, composer / log bar. */}
      <div
        role="tabpanel"
        id="venuePanel-pints"
        aria-labelledby="venueTab-pints"
        className="venueTabPanel"
        hidden={tab !== "pints"}
      >
        {/* The Golden Thread — this pub's price story (baseline vs community
            price + inflation on a dated memory). Leads the Pints tab; falls back
            to an honest empty state when the venue has no price story yet. */}
        <VenuePriceStory venue={venue} drops={drops} />
        <section className="pintDrops">
          <div className="inspectorTitle">
            <Quote size={16} />
            <span>Pint Drops</span>
          </div>
          {hasDemoDrops ? (
            <div className="demoDataNote">
              <span>Demo data</span>
              Example Pint Drops are seeded for the walkthrough. Live contributions use the same
              flow.
            </div>
          ) : null}
          {drops.length === 0 ? (
            <p className="description muted">
              No Pint Drops yet at {venue.name}. Be the first — log tonight&rsquo;s price or pass
              down a story using the button below.
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
                    {drop.passedDownNote ? (
                      <p className="dropCaption">{drop.passedDownNote}</p>
                    ) : null}
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
            <PintDropComposer venueId={venue.id} state={pintDrops} venueName={venue.name} />
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
      </div>

      {/* Menu — the full drink list beyond pints (wine, whisky, gin, cocktails…). */}
      <div
        role="tabpanel"
        id="venuePanel-menu"
        aria-labelledby="venueTab-menu"
        className="venueTabPanel"
        hidden={tab !== "menu"}
      >
        <DrinkMenu drinks={menuDrinks} venueName={venue.name} />
      </div>

      {/* Story — description / heritage note + provenance-stamped claims. */}
      <div
        role="tabpanel"
        id="venuePanel-story"
        aria-labelledby="venueTab-story"
        className="venueTabPanel"
        hidden={tab !== "story"}
      >
        {venue.description ? (
          <p className="description">{venue.description}</p>
        ) : (
          <p className="description muted">
            No heritage note for {venue.name} yet — log a Pint Drop below with a passed-down story
            to be the first to give this pub some character.
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
      </div>

      {/* Ask — the grounded "Ask the PUBMAXXER" landlord guide. */}
      <div
        role="tabpanel"
        id="venuePanel-ask"
        aria-labelledby="venueTab-ask"
        className="venueTabPanel"
        hidden={tab !== "ask"}
      >
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
      </div>

      {/* Getting home — the nearest station + last trains tonight (TfL), so you
          know when to head off for the last drink. */}
      <div
        role="tabpanel"
        id="venuePanel-getting-home"
        aria-labelledby="venueTab-getting-home"
        className="venueTabPanel"
        hidden={tab !== "getting-home"}
      >
        <LastTrainCard lat={venue.latitude} lng={venue.longitude} venueName={venue.name} />
      </div>
    </section>
  );
}
