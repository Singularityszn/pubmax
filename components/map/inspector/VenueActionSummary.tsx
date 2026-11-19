import type { ReactNode } from "react";

import type { VenueActionCardWalk } from "@/lib/venueActionCard";

/**
 * The action card's first row: the price, the walk and the ONE coral door
 * (lib/venueActionCard.ts). It was the phone peek's row at the top of the
 * sheet body and it keeps that row's class names, so the price and the door
 * read the same at every width. It left the body when it joined the card:
 * nothing on it appears twice on the sheet.
 *
 * The price cell is handed in, already read by the sheet's one precedence
 * (lib/venuePriceLane.ts through components/map/VenuePeekPintPrice.tsx, or
 * the drink lens's own figure), so this row reads no price of its own.
 */
export default function VenueActionSummary({
  label,
  price,
  walkMinutes,
  planDoor,
}: {
  /** The row's accessible name, the sheet labels' own summary line. */
  label: string;
  price: ReactNode;
  /** Whole minutes on foot; "far" or "rough" for a shown position that gives no figure; null with no location. */
  walkMinutes: VenueActionCardWalk;
  planDoor: ReactNode;
}) {
  return (
    <div className="mobileVenuePeekFrame">
      <div className="mobileVenuePeekSummary" aria-label={label}>
        {price}
        <span>
          <strong
            className={
              typeof walkMinutes === "number" ? "mobileVenuePeekNearMe" : "mobileVenuePeekNearMe isPhrase"
            }
          >
            {typeof walkMinutes === "number" ? `${walkMinutes} min` : walkMinutes === "far" ? "Over an hour" : "Near me"}
          </strong>
          <small>{walkMinutes === "rough" ? "Location too rough for walk times" : walkMinutes !== null ? "walk" : "Turn on location for walk times"}</small>
        </span>
        {planDoor}
      </div>
    </div>
  );
}
