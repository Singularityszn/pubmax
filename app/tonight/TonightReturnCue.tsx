"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { getSaved } from "@/lib/savedPubs";
import {
  TONIGHT_RETURN_CUE_SOURCE_LINE,
  TONIGHT_RETURN_CUE_TITLE,
  tonightReturnCue,
  tonightReturnCueLabel,
  type TonightReturnCue as Cue,
} from "@/lib/tonightReturnCue";

import "./tonightReturnCue.css";

/**
 * A quiet way back to a pub this browser saved, after tonight's answer.
 *
 * The saves are browser-only, so the first paint renders nothing and matches
 * the server; the read lands in a deferred pass. Absent, corrupt or blocked
 * storage and an empty list all stay silent, because getSaved answers [] for
 * each of them.
 */
export default function TonightReturnCue({
  selectableVenueIds,
}: {
  /** Ids the map can open via `?sel=`; null or undefined keeps the cue quiet. */
  selectableVenueIds: ReadonlySet<string> | null | undefined;
}) {
  const [cue, setCue] = useState<Cue | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setCue(tonightReturnCue(getSaved(), selectableVenueIds));
    });
    return () => {
      cancelled = true;
    };
  }, [selectableVenueIds]);

  if (!cue) return null;
  return (
    <section
      className="tonightReturnCue"
      aria-labelledby="tonight-return-cue-title"
      data-testid="tonight-return-cue"
    >
      <h2 className="tonightReturnCueTitle" id="tonight-return-cue-title">
        {TONIGHT_RETURN_CUE_TITLE}
      </h2>
      <Link prefetch={false} href={cue.href} className="tonightReturnCueLink pressable">
        {tonightReturnCueLabel(cue.pubCount)}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
      <p className="tonightReturnCueSource">{TONIGHT_RETURN_CUE_SOURCE_LINE}</p>
    </section>
  );
}
