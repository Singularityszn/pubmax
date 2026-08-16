"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import SiteNav from "@/components/nav/SiteNav";
import { OutCard } from "@/components/out/OutCard";
import { trackEvent } from "@/lib/analytics";
import { outCardSource } from "@/lib/out/attribution";
import {
  OUT_DAY_WINDOWS,
  OUT_OPEN_PLANS_PLACEHOLDER_LINE,
  OUT_OPEN_PLANS_WAY_LABEL,
  type OutDayWindow,
} from "@/lib/outListings";
import { outStatusLines } from "@/lib/out/outStatus";
import type { OutDay, OutResponse } from "@/lib/out/types";
import { discardBody } from "@/lib/responseBody";
import { handleSegmentLinkKeyDown } from "@/lib/segmentLinkKeys";
import type { WhatsOnRow } from "@/lib/whatsOn";

import "./out.css";

const DAY_LABEL: Record<OutDayWindow, string> = {
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  weekend: "Weekend",
};

function outWindowToApiDay(window: OutDayWindow): OutDay {
  return window === "tonight" ? "today" : window;
}

export default function OutClient({ day }: { day: OutDayWindow }) {
  const apiDay = outWindowToApiDay(day);
  // An answer is held WITH the day it is about. The chip moves the instant it
  // is pressed, so a body that belongs to another day is not this day's answer
  // and must not render under it - last night's listings reading as this
  // weekend's, with nothing on screen saying otherwise.
  const [answer, setAnswer] = useState<{ day: OutDay; body: OutResponse | null; failed: boolean }>({
    day: apiDay,
    body: null,
    failed: false,
  });
  const body = answer.day === apiDay ? answer.body : null;
  const failed = answer.day === apiDay && answer.failed;

  useEffect(() => {
    trackEvent("out_screen_view");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/out?city=london&day=${apiDay}`);
        if (cancelled) {
          discardBody(res);
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setAnswer({ day: apiDay, body: null, failed: true });
          return;
        }
        const json = (await res.json()) as OutResponse;
        if (cancelled) return;
        setAnswer({ day: apiDay, body: json, failed: false });
      } catch {
        // Offline, DNS, abort: the reader is owed the same honest line as a
        // refused read, never day chips over an empty page with no status.
        if (cancelled) return;
        setAnswer({ day: apiDay, body: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiDay]);

  const onOpen = useCallback((row: WhatsOnRow) => {
    trackEvent("out_card_opened", { source: outCardSource(row.source.label) });
  }, []);

  return (
    <main id="main" className="outPage" data-testid="out-screen">
      <SiteNav active="out" />

      <header className="outHead">
        <h1 className="outTitle">Out</h1>
        <nav className="outDayChips" aria-label="When">
          {OUT_DAY_WINDOWS.map((windowKey) => {
            const selected = windowKey === day;
            const href = windowKey === "tonight" ? "/out" : `/out?day=${windowKey}`;
            return (
              <Link
                key={windowKey}
                href={href}
                className="outDayChip"
                aria-current={selected ? "page" : undefined}
                onKeyDown={handleSegmentLinkKeyDown}
                onClick={() => trackEvent("out_filter_select", { kind: windowKey })}
              >
                {DAY_LABEL[windowKey]}
              </Link>
            );
          })}
        </nav>
      </header>

      <section className="outPlans" aria-labelledby="out-plans-heading">
        <h2 id="out-plans-heading" className="outSectionTitle">
          Open plans
        </h2>
        <p className="outEmpty">
          {OUT_OPEN_PLANS_PLACEHOLDER_LINE}{" "}
          <Link href="/plan" className="outEmptyLink">
            {OUT_OPEN_PLANS_WAY_LABEL}
          </Link>
        </p>
      </section>

      <section className="outListings" aria-labelledby="out-listings-heading">
        <h2 id="out-listings-heading" className="outSectionTitle">
          {DAY_LABEL[day]}
        </h2>
        {outStatusLines({ body, failed }).map((line) => (
          <p className="outStatus" key={line}>
            {line}
          </p>
        ))}
        <ul className="outList">
          {(body?.events ?? []).map((row) => (
            <OutCard key={row.id} row={row} onOpen={() => onOpen(row)} />
          ))}
        </ul>
      </section>
    </main>
  );
}
