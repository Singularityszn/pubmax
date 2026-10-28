"use client";

import type { Route } from "next";
import { useId, useState } from "react";
import Link from "next/link";
import { Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import type { PalYearFacts } from "@/lib/palYear";
import { buildYearInPintsShareText } from "@/lib/shareArtifacts";
import { shareNightObject } from "@/lib/shareSheet";
import { siteOrigin } from "@/lib/siteUrl";
import {
  DEFAULT_YEAR_SHARE_PARTS,
  yearShareFrom,
  yearShareHeading,
  yearShareLine,
  yearShareOffer,
  yearSharePath,
  type YearSharePart,
} from "@/lib/yearInPints";

// "Share my year" under the Pal's year (PalYear.tsx). The person ticks which
// lines go on the card, and each tick reads exactly as the card will. The
// counts start ticked and a line naming a pub or a day starts unticked. The
// link carries the ticked lines and nothing else (lib/yearInPints.ts), so the
// rest of the year never leaves this device. It is free forever: no tier,
// price or referral count stands in front of it.

type Sent = "idle" | "sent" | "whatsapp" | "failed";

export default function PalYearShare({
  facts,
  names,
  today,
}: {
  facts: PalYearFacts;
  names: Readonly<Record<string, string>>;
  /** The London day the year was read on. */
  today: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<YearSharePart>>(() => new Set(DEFAULT_YEAR_SHARE_PARTS));
  const [sent, setSent] = useState<Sent>("idle");

  const offered = yearShareOffer(facts, names);
  const everything = yearShareFrom(facts, new Set(offered), today, names);
  if (!everything) return null;
  const chosen = yearShareFrom(facts, picked, today, names);

  const toggle = (part: YearSharePart, on: boolean) => {
    setSent("idle");
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(part);
      else next.delete(part);
      return next;
    });
  };

  const share = async () => {
    if (!chosen) return;
    const origin = siteOrigin(window.location.href) ?? window.location.origin;
    const heading = yearShareHeading(chosen);
    const outcome = await shareNightObject({
      title: heading,
      text: buildYearInPintsShareText({
        heading,
        nights: chosen.nights,
        stops: chosen.stops,
        prices: chosen.prices?.count,
      }),
      url: new URL(yearSharePath(chosen), origin).toString(),
    });
    if (outcome === "shared" || outcome === "whatsapp") {
      trackEvent("content_shared", { channel: outcome === "shared" ? "native" : "whatsapp", surface: "year" });
    }
    // A WhatsApp fallback only opens a draft, so it is ready to send, not sent.
    setSent(outcome === "cancelled" ? "idle" : outcome === "shared" ? "sent" : outcome);
  };

  return (
    <div className="palYearShare">
      <Button
        type="button"
        variant="ghost"
        className="palYearShareOpen"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <Share2 size={16} aria-hidden="true" />
        Share my year
      </Button>
      {open ? (
        <div id={panelId} className="palYearSharePanel">
          <fieldset className="palYearSharePick">
            <legend>What goes on the card</legend>
            {offered.map((part) => {
              const line = yearShareLine(everything, part, names);
              if (!line) return null;
              return (
                <label key={part} className="palYearShareRow">
                  <input
                    type="checkbox"
                    checked={picked.has(part)}
                    onChange={(event) => toggle(part, event.target.checked)}
                  />
                  <span>{line}</span>
                </label>
              );
            })}
          </fieldset>
          <p className="palYearNote">Only the lines you tick go in the link. Nothing else leaves this device.</p>
          <div className="palYearShareActions">
            <Button type="button" variant="secondary" disabled={!chosen} onClick={() => void share()}>
              Share the card
            </Button>
            {chosen ? (
              <Link prefetch={false} href={yearSharePath(chosen) as Route} target="_blank" rel="noopener">
                See the card
              </Link>
            ) : null}
          </div>
          {!chosen ? <p className="palYearNote" role="status">Tick a line to share the card.</p> : null}
          {sent === "sent" ? <p className="palYearNote" role="status">Sent. Only the lines you ticked went with it.</p> : null}
          {sent === "whatsapp" ? <p className="palYearNote" role="status">Ready in WhatsApp. Send it from there.</p> : null}
          {sent === "failed" ? <p className="palYearNote" role="status">That didn&apos;t send. Try again.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
