"use client";

// The plan somebody shared, as a card that opens it.
//
// WHAT IT MAY SAY is the whole point. The card is built from the plan's
// ANONYMOUS PREVIEW (`buildPlanPrivacyPreview`, resolved on the read path in
// `lib/messageAttachmentCards.server.ts`), because a message is NOT a
// capability: sharing a plan id tells the reader a night exists, whose it is,
// roughly where and when, and how many stops it holds. It never names a stop,
// a venue, the route or the crew.
//
// So the card carries one line saying the route belongs to the crew, and one
// door. Whether the reader gets more than this is their OWN capability's
// answer at /plan/<id>, decided by `resolvePlanProjection` exactly as it is for
// anybody arriving at that address any other way.

import Link from "next/link";

import {
  MESSAGE_EVENT_CARD_PRIVACY_LINE,
  MESSAGE_EVENT_CARD_UNRESOLVED_LINE,
  messageEventCardLabel,
  messageEventStopLine,
  type MessageEventCard as EventCard,
} from "@/lib/messageAttachments";

export default function MessageEventCard({
  card,
}: {
  card: EventCard | null;
}): React.JSX.Element {
  if (!card) {
    return <p className="messageVenueCardUnresolved">{MESSAGE_EVENT_CARD_UNRESOLVED_LINE}</p>;
  }
  const stops = card.routeReady ? messageEventStopLine(card.stopCount) : null;
  return (
    <Link
      href={card.planUrl}
      className="messageEventCard"
      aria-label={messageEventCardLabel(card)}
    >
      <span className="messageEventCardName">{card.hostDisplayName}&rsquo;s plan</span>
      <span className="messageEventCardWhen">
        {card.areaName ? `${card.areaName} · ${card.startLabel}` : card.startLabel}
      </span>
      {stops ? <span className="messageEventCardStops">{stops}</span> : null}
      <span className="messageEventCardPrivacy">{MESSAGE_EVENT_CARD_PRIVACY_LINE}</span>
    </Link>
  );
}
