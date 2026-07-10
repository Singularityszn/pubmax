import { firstHttp } from "@/lib/httpUrl";
import type { Venue } from "@/lib/venues";

/**
 * External venue CTAs (Book / Menu / Order) — Greene King–style actions without
 * inventing commerce. Only surfaces real http(s) URLs already on the venue.
 *
 * Food ordering stays link-out only until we have a curated `orderUrl` layer.
 */

export type VenueExternalActionKind = "book" | "menu" | "website" | "order";

export type VenueExternalAction = {
  kind: VenueExternalActionKind;
  label: string;
  href: string;
};

/**
 * Resolve Book / Look at the menu / Pub website / Order food CTAs for a venue.
 * Order: book → menu/website → order. Never invents URLs.
 */
export function venueExternalActions(venue: Venue): VenueExternalAction[] {
  const actions: VenueExternalAction[] = [];

  const booking = firstHttp(venue.bookingLink);
  if (booking) {
    actions.push({ kind: "book", label: "Book a table", href: booking });
  }

  // Curated menuUrl always wins as "Look at the menu". Otherwise, when the
  // pub serves food, the homepage is an honest menu/site link-out; without
  // food, label it "Pub website".
  const curatedMenu = firstHttp(venue.menuUrl);
  if (curatedMenu) {
    actions.push({
      kind: "menu",
      label: "Look at the menu",
      href: curatedMenu,
    });
  } else if (venue.amenities.food) {
    const menuHref = firstHttp(venue.website);
    if (menuHref) {
      actions.push({
        kind: "menu",
        label: "Look at the menu",
        href: menuHref,
      });
    }
  } else {
    const website = firstHttp(venue.website);
    if (website) {
      actions.push({
        kind: "website",
        label: "Pub website",
        href: website,
      });
    }
  }

  const order = firstHttp(venue.orderUrl);
  if (order) {
    actions.push({ kind: "order", label: "Order food", href: order });
  }

  return actions;
}
