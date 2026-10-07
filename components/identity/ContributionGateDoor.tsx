"use client";

// The contribution gate as a DOOR, asked where the list would have been.
//
// `ContributionGateDialog` is the answer to an ACTION that was refused: a
// person pressed save and was told no. A list is different. Opening your own
// profile reads Wanted, Diary and the nudge settings, and an account that has
// not tapped "I'm 18 or over" has nothing to hold yet. Those reads answer the
// gate as data (`lib/contributionIdentity.server.ts`,
// `contributionReadRefusalResponse`), and the surface puts this door in the
// list's place: one sentence, and the one tap when a tap is the way through.
//
// It records the tap through the same hook and the same route as the dialog,
// and it never offers a tap the server would not honour: an account whose date
// of birth says under 18 is told the answer on file, with nothing to press.

import Link from "next/link";
import { useEffect } from "react";

import { useAdultTap } from "@/components/identity/ContributionGateDialog";
import EmptyState from "@/components/ui/empty-state";
import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/adultGate";
import { HANDLE_CLAIM_NEXT } from "@/lib/authRedirect";
import {
  ADULT_ASSERTED_EVENT,
  CONTRIBUTION_UNDER_18_REFUSAL,
  type ContributionDoorStatus,
} from "@/lib/contributionGateStatus";

type ContributionGateDoorProps = {
  status: ContributionDoorStatus;
  /** What the person is being asked to do, as a verb phrase: "keep a Wanted list". */
  subject: string;
  /** The tap is recorded, here or at another door on the page: read the list again. */
  onAsserted: () => void;
};

export default function ContributionGateDoor({
  status,
  subject,
  onAsserted,
}: ContributionGateDoorProps): React.JSX.Element {
  // This door's own tap and another door's tap arrive the same way, as the page
  // event, so one tap dissolves every door and each list is read exactly once.
  const tap = useAdultTap();
  useEffect(() => {
    window.addEventListener(ADULT_ASSERTED_EVENT, onAsserted);
    return () => window.removeEventListener(ADULT_ASSERTED_EVENT, onAsserted);
  }, [onAsserted]);

  if (status === "adult_check_failed") {
    return (
      <div className="contributionGateDoor" role="status">
        <EmptyState title={CONTRIBUTION_UNDER_18_REFUSAL} />
      </div>
    );
  }

  if (status === "onboarding_required") {
    return (
      <div className="contributionGateDoor" role="status">
        <EmptyState
          title={`Choose a handle to ${subject}.`}
          action={<Link href={HANDLE_CLAIM_NEXT}>Choose a handle</Link>}
        />
      </div>
    );
  }

  return (
    <div className="contributionGateDoor" role="status">
      <EmptyState
        title={`Confirm you are 18 or over to ${subject}.`}
        action={
          <button type="button" onClick={tap.assert} disabled={tap.busy}>
            {ADULT_SELF_ASSERTION_ACTION}
          </button>
        }
      >
        {tap.error ?? "One tap records it, and we ask once."}
      </EmptyState>
    </div>
  );
}
