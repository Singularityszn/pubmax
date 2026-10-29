"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";

import PalCardPrice from "@/components/pal/PalCardPrice";
import { trackEvent } from "@/lib/analytics";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { formatPalWhen, type PalCard } from "@/lib/palChat";
import type { PalLocality } from "@/lib/palLocality";
import { resolvePalVenueOpenTarget } from "@/lib/palOpenVenue";
import { writePlanningIntent } from "@/lib/planningIntent";
import { venueAcceptUrl } from "@/lib/venueMapUrl";

function VenueLink({
  card,
  onOpen,
  knownVenueIds,
  children,
}: {
  card: PalCard;
  onOpen: (venueId: string) => void;
  knownVenueIds: ReadonlySet<string> | null;
  children: ReactNode;
}) {
  // A card is only tappable when it deep-links to a real venue on the map. The
  // static variant still renders every fact and its provenance.
  if (!card.venueId) {
    return <div className="palChatCardMain">{children}</div>;
  }
  const target = resolvePalVenueOpenTarget(card.venueId, knownVenueIds);
  const href = target.href;
  return (
    <Link
      prefetch={false}
      className="palChatCardMain palChatCardBody--link"
      href={href}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onOpen(card.venueId);
      }}
    >
      {children}
    </Link>
  );
}

function ProvChip({ card }: { card: PalCard }) {
  // Provenance is non-negotiable and kept on every card. A What's-On row carries
  // an attributable link; a first-party directory row reads "On record".
  const { provenance } = card;
  const label = provenance.label;
  if (provenance.url) {
    return (
      <a
        className="palChatProv palChatProv--link"
        href={provenance.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => event.stopPropagation()}
      >
        {label}
      </a>
    );
  }
  return <span className="palChatProv">{label}</span>;
}

// Explicit Pub Pal acceptance (§4.8: Pal owns its own "Use this pub", distinct
// from browsing). Writes a source-"pal" PlanningIntent then hands off to the Map
// acceptance URL. Storage failure is swallowed by writePlanningIntent; the href
// still carries accept=1&src=pal so the handoff never depends on client storage.
function acceptPalVenue(card: PalCard, locality: PalLocality | null): void {
  writePlanningIntent({
    source: "pal",
    cityId: DEFAULT_CITY_ID,
    acceptedVenueId: card.venueId,
    acceptedArea: locality?.area ?? null,
    startsAt: null,
    displayEvidence: {
      kind: card.provenance.kind === "whats-on" ? "whats-on" : "directory",
      observedAt: card.when ?? null,
    },
  });
  trackEvent("venue_accepted", { source: "pal" });
}

export function AnswerCard({
  card,
  onOpen,
  knownVenueIds = null,
  locality,
}: {
  card: PalCard;
  onOpen: (venueId: string) => void;
  knownVenueIds?: ReadonlySet<string> | null;
  locality: PalLocality | null;
}) {
  const when = card.when ? formatPalWhen(card.when) : "";
  return (
    <li className="palChatCard">
      <div className="palChatCardBody">
        <VenueLink card={card} onOpen={onOpen} knownVenueIds={knownVenueIds}>
          <div className="palChatCardTop">
            <p className="palChatCardTitle">{card.title}</p>
            <PalCardPrice card={card} className="palChatCardPrice" />
          </div>
          {card.place ? (
            <p className="palChatCardPlace">
              <MapPin size={14} aria-hidden="true" />
              <span>{card.place}</span>
            </p>
          ) : null}
          {when ? <p className="palChatCardWhen">{when}</p> : null}
          {card.note ? <p className="palChatCardNote">{card.note}</p> : null}
          {card.venueId ? (
            <span className="palChatCardCta" aria-hidden="true">
              Show on map
            </span>
          ) : null}
        </VenueLink>
        <div className="palChatCardMeta">
          <ProvChip card={card} />
          {[card.menuEvidence?.caloriesProvenance, card.menuEvidence?.dietaryProvenance].map((field, index) => field && field.sourceUrl !== card.provenance.url ? (
            <a key={index} className="palChatProv palChatProv--link" href={field.sourceUrl} target="_blank" rel="noreferrer noopener">
              {index === 0 ? "Calorie source" : "Dietary source"}: {field.source}
            </a>
          ) : null)}
          {card.confidence ? (
            <span className="palChatConfidence">{card.confidence}</span>
          ) : null}
        </div>
      </div>
      {card.venueId ? (
        <Link
          prefetch={false}
          className="palChatCardAccept pressable"
          href={venueAcceptUrl(card.venueId, "pal")}
          onClick={() => acceptPalVenue(card, locality)}
        >
          Use this pub
        </Link>
      ) : null}
    </li>
  );
}

