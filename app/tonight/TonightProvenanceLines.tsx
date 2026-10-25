"use client";

// The credit lines under the Tonight heading, lifted out of TonightClient whole.
//
// Each lane is credited and dated by its OWN read (see tonightProvenanceCredits),
// so this renders two independent pairs: the credit itself, and the plain
// sentence a lane gets when it could not be dated at all. Presentation only —
// every decision is already made by the credits it is handed.

import type { TonightProvenanceCredits } from "@/lib/tonightOutListings";

/** Said instead of a dated chain segment when a lane carries no date. */
const UNDATED_WHATS_ON_LINE = "The what’s-on source check date is not recorded.";
const UNDATED_OUT_LINE = "The live listings source check date is not recorded.";

export default function TonightProvenanceLines({
  provenance,
  nearestSuffix,
}: {
  provenance: TonightProvenanceCredits;
  /** " · nearest Soho first", or null when the page names no patch. */
  nearestSuffix: string | null;
}) {
  return (
    <>
      {provenance.whatsOn ? (
        <p
          className="tonightProvenance"
          data-tonight-provenance="whats-on"
          data-tonight-dated={provenance.whatsOnDated ? "yes" : "no"}
        >
          {provenance.whatsOn}
          {nearestSuffix}
          {provenance.whatsOnUndated ? <span data-tonight-provenance="undated-whats-on"> · {UNDATED_WHATS_ON_LINE}</span> : null}
        </p>
      ) : null}
      {provenance.whatsOnExclusions ? (
        <p className="tonightProvenance" data-tonight-provenance="excluded-whats-on">
          {provenance.whatsOnExclusions}
        </p>
      ) : null}
      {provenance.out ? (
        <p
          className="tonightProvenance"
          data-tonight-provenance="out"
          data-tonight-dated={provenance.outDated ? "yes" : "no"}
        >
          {provenance.out}
          {!provenance.outDated ? <span data-tonight-provenance="undated-out"> · {UNDATED_OUT_LINE}</span> : null}
        </p>
      ) : null}
    </>
  );
}
