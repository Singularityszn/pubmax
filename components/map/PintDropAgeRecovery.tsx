"use client";

import { useAdultTap } from "@/components/identity/ContributionGateDialog";
import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/adultGate";
import { readProviderAccountRevision } from "@/lib/authProviderRevision";
import type { DropMsg } from "./usePintDrops";

export function PintDropAgeRecovery({ recovery, onAsserted }: {
  recovery: DropMsg["ageRecovery"];
  onAsserted: () => void;
}) {
  const tap = useAdultTap(onAsserted);
  if (!recovery || recovery.accountRevision !== readProviderAccountRevision()) return null;
  return (
    <span className="composerMsgLinks">
      <button type="button" className="composerMsgLink" onClick={tap.assert} disabled={tap.busy}>
        {ADULT_SELF_ASSERTION_ACTION}
      </button>
      {tap.error ? <span role="alert">{tap.error}</span> : null}
    </span>
  );
}
