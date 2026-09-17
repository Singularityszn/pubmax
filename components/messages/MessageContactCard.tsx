"use client";

// The person somebody handed you, as a card that opens their profile.
//
// It prints what the READ path resolved (`lib/messageAttachmentCards.server.ts`)
// and nothing else: the handle, the display name they published, and their
// approved avatar. There is no email here, no city and no full name, because
// passing a handle on in a message may not be a way around the
// owner-authenticated profile read.
//
// A card whose lookup could not answer says so in words. An account that has
// been retired resolves to null exactly as an unknown handle does, so a message
// from last year never prints a name somebody took back.

import Link from "next/link";

import MessageAvatar from "@/components/messages/MessageAvatar";
import {
  MESSAGE_CONTACT_CARD_UNRESOLVED_LINE,
  messageContactCardLabel,
  type MessageContactCard as ContactCard,
} from "@/lib/messageAttachments";

export default function MessageContactCard({
  card,
}: {
  card: ContactCard | null;
}): React.JSX.Element {
  if (!card) {
    return <p className="messageVenueCardUnresolved">{MESSAGE_CONTACT_CARD_UNRESOLVED_LINE}</p>;
  }
  return (
    <Link
      href={card.profileUrl}
      className="messageContactCard"
      aria-label={messageContactCardLabel(card)}
    >
      <MessageAvatar handle={card.handle} avatarUrl={card.avatarUrl ?? undefined} size={32} />
      <span className="messageContactCardText">
        {card.displayName ? (
          <span className="messageContactCardName">{card.displayName}</span>
        ) : null}
        <span className="messageContactCardHandle">@{card.handle}</span>
      </span>
    </Link>
  );
}
