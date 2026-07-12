import { CalendarDays, ExternalLink, UtensilsCrossed } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import {
  venueExternalActions,
  type VenueExternalAction,
} from "@/lib/venueExternalActions";
import type { Venue } from "@/lib/venues";

import "./venueActionStrip.css";

function ActionIcon({ kind }: { kind: VenueExternalAction["kind"] }) {
  if (kind === "book") return <CalendarDays size={15} aria-hidden="true" />;
  if (kind === "menu" || kind === "order") {
    return <UtensilsCrossed size={15} aria-hidden="true" />;
  }
  return <ExternalLink size={15} aria-hidden="true" />;
}

type VenueActionStripProps = {
  venue: Venue;
  className?: string;
};

/**
 * Book / Menu / website CTAs for a selected pub. Renders nothing when no
 * external URLs exist — never a dead button.
 */
export default function VenueActionStrip({ venue, className }: VenueActionStripProps) {
  const actions = venueExternalActions(venue);
  if (actions.length === 0) return null;

  return (
    <div
      className={`venueActionStrip${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={actions.map((a) => a.label).join(", ")}
    >
      {actions.map((action) => (
        <a
          key={action.kind}
          className={`venueActionStrip__btn venueActionStrip__btn--${action.kind}`}
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          data-tier={action.tier}
          onClick={
            action.kind === "book"
              ? () =>
                  trackEvent("booking_click", {
                    venueId: venue.id,
                    tier: action.tier ?? "search",
                  })
              : undefined
          }
        >
          <ActionIcon kind={action.kind} />
          <span>{action.label}</span>
          <ExternalLink size={12} className="venueActionStrip__ext" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}
