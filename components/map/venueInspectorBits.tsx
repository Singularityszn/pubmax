// F2 extract — small presentational chips shared by VenueInspector panels.
// Keeps claim/provenance amenity markup out of the 1k-line inspector body.

import type { ClaimKind, Provenance } from "@/lib/curation";
import type { AmenityStatus } from "@/lib/venueTruth";

const PROVENANCE_LABEL: Record<Provenance, string> = {
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  demo: "Demo",
};

const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  baseline: "Baseline",
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  "needs-source": "Needs a source",
};

export function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  return <span className={`provChip ${provenance}`}>{PROVENANCE_LABEL[provenance]}</span>;
}

/** Reuses .provChip; needs-source/baseline get their own colour classes in CSS. */
export function ClaimBadge({ kind }: { kind: ClaimKind }) {
  return <span className={`provChip ${kind}`}>{CLAIM_KIND_LABEL[kind]}</span>;
}

/**
 * ONE amenity, said as strongly as the source allows.
 *
 * An `unknown` renders NOTHING. A greyed chip beside a green one reads as a
 * stated absence, and the bundled dataset states no absences at all: every
 * amenity column carries yes-shaped values and blanks, so a grey "Beer garden"
 * was a negative the product invented (finding F03). This is the same rule the
 * accessibility chips under it already follow, which show a confirmed fact and
 * never a "No".
 */
export function Amenity({ status, label }: { status: AmenityStatus; label: string }) {
  if (status === "unknown") return null;
  if (status === "known-false") {
    return <span className="amenity amenity--absent">No {label.toLowerCase()}</span>;
  }
  return <span className="amenity">{label}</span>;
}
