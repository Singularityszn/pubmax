import { X } from "lucide-react";

import { ProseDisclosure } from "@/components/Disclosure";
import type { Venue } from "@/lib/venues";
import styles from "./MapHeroCard.module.css";

export default function MapHeroCard({
  venue,
  onDismiss,
  onVisit,
}: {
  venue: Venue;
  onDismiss: () => void;
  onVisit: (venueId: string) => void;
}) {
  const heritageNote = venue.curation.heritageNote;
  if (!heritageNote) return null;

  return (
    <aside className={styles.mapHeroCard} aria-label="Featured story pub">
      <div className={styles.mapHeroCardHead}>
        <span>
          {venue.curation.heritageEra ?? "Story pub"}
          {venue.curation.sourceLabel
            ? ` · ${venue.curation.sourceLabel}`
            : ""}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss featured story pub"
        >
          <X size={13} />
        </button>
      </div>
      <strong>{venue.name}</strong>
      <div className={styles.mapHeroCopy}>
        <ProseDisclosure text={heritageNote} />
      </div>
      <button
        type="button"
        className={styles.mapHeroVisit}
        onClick={() => onVisit(venue.id)}
      >
        Visit
      </button>
    </aside>
  );
}
