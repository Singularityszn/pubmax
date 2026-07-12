import { X } from "lucide-react";

import { truncateBandCopy } from "@/lib/bandOnboardingChip";

// G3: Place story deep-link chip — corridor title + one-line copy when `?band=`
// resolves. Global CSS (bandOnboardingChip) is already imported by PubMap.
// Extracted verbatim from PubMap (F1); the showBandChip/activeBand guard stays
// in PubMap.
export function BandOnboardingChip({
  title,
  copy,
  onWalkStory,
  onDismiss,
}: {
  title: string;
  copy: string;
  onWalkStory: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="bandOnboardingChip" role="status" aria-live="polite">
      <div>
        <strong>{title}</strong>
        <span>{truncateBandCopy(copy)}</span>
      </div>
      <button type="button" onClick={onWalkStory}>
        Walk this story
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss Place story intro">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
