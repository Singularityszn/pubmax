"use client";

import { useEffect, useRef } from "react";
import { useAdultTap } from "@/components/identity/ContributionGateDialog";
import { Button } from "@/components/ui/button";
import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/adultGate";
import { readProviderAccountRevision } from "@/lib/authProviderRevision";
import type { DropMsg } from "./usePintDrops";

export function PintDropAgeRecovery({ recovery, onAsserted }: {
  recovery: DropMsg["ageRecovery"];
  onAsserted: () => void;
}) {
  const tap = useAdultTap(onAsserted);
  const actionRef = useRef<HTMLButtonElement>(null);
  const current = recovery?.accountRevision === readProviderAccountRevision();
  useEffect(() => {
    if (current) actionRef.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [current, recovery?.accountRevision]);
  if (!current) return null;
  return (
    <span className="composerMsgLinks">
      <Button ref={actionRef} type="button" variant="secondary" style={{ scrollMarginBlock: "8px" }} onClick={tap.assert} disabled={tap.busy}>
        {ADULT_SELF_ASSERTION_ACTION}
      </Button>
      {tap.error ? <span role="alert">{tap.error}</span> : null}
    </span>
  );
}
