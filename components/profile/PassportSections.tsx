"use client";

// The passport book's sections on /u/[handle], in V3's order: Been, then on
// the owner's own page "Your pubs, ranked" and "Your taste, in facts", and on
// a mate's page the explicit overlap. Each section asks its own read, and the
// server decides who may hold it (lib/profilePassport.server.ts); the owner
// flag here only spares a stranger a request that would be refused.
//
// No score, no percentage, no streak (ADR 0017). The ranked list shows the
// place and the name and nothing else. No analytics events.

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { authedFetch } from "@/lib/authedFetch";
import { buildCrawlMapHref } from "@/lib/crawlUrl";
import {
  PASSPORT_COPY,
  TASTE_COPY,
  passportDayLabel,
  type BeenVenue,
  type PassportVenue,
  type TasteFact,
} from "@/lib/profilePassport";
import { venueMapUrl } from "@/lib/venueMapUrl";

import {
  usePassportRead,
  type PassportBeenRead,
  type PassportOverlapRead,
  type PassportTasteRead,
} from "./PassportData";

import "./passportBook.css";

/** The crawl map takes at most seven stops, so the link carries the latest seven. */
const MAP_STOPS = 7;
const BEEN_SHOWN = 20;

function mapHrefFor(venues: readonly BeenVenue[]): Route | null {
  const ids = venues.slice(0, MAP_STOPS).map((venue) => venue.venueId);
  if (ids.length === 1) return venueMapUrl(ids[0]!);
  return buildCrawlMapHref(ids);
}

function PassportBeenList({
  been,
  isOwner,
}: {
  been: PassportBeenRead;
  isOwner: boolean;
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? been.venues : been.venues.slice(0, BEEN_SHOWN);
  const mapHref = mapHrefFor(been.venues);
  return (
    <section id="passport-been" className="passportSection" aria-labelledby="passport-been-title">
      <div className="passportSectionHead">
        <h2 id="passport-been-title" className="passportSectionTitle">
          {PASSPORT_COPY.beenTitle}
        </h2>
        {mapHref ? <Link prefetch={false} href={mapHref}>{PASSPORT_COPY.showOnMap}</Link> : null}
      </div>
      {been.venues.length === 0 ? (
        <EmptyState title={isOwner ? "No pubs yet." : PASSPORT_COPY.beenEmptyOther}>
          {isOwner ? PASSPORT_COPY.beenEmptyOwner : null}
        </EmptyState>
      ) : (
        <ul className="passportList">
          {shown.map((venue) => (
            <li key={venue.venueId} className="passportRow">
              <Link prefetch={false} href={venueMapUrl(venue.venueId)} className="passportRowName">
                {venue.venueName || "A London pub"}
              </Link>
              <span className="passportRowMeta">
                {/* A pub only the Been here list holds has no day, and says so. */}
                <span className="passportRowDate">
                  {venue.lastDate ? passportDayLabel(venue.lastDate) : PASSPORT_COPY.undated}
                </span>
                {isOwner ? ` · ${venue.sources.map((source) => PASSPORT_COPY.sourceLabel[source]).join(", ")}` : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!showAll && been.venues.length > BEEN_SHOWN ? (
        <p className="passportQuiet">
          <Button type="button" variant="ghost" onClick={() => setShowAll(true)}>
            Show all of them
          </Button>
        </p>
      ) : null}
    </section>
  );
}

function PassportBeen({ handle, isOwner }: { handle: string; isOwner: boolean }) {
  const been = usePassportRead<PassportBeenRead>("been", handle);
  return been ? <PassportBeenList been={been} isOwner={isOwner && been.access === "full"} /> : null;
}

type RankingEntry = { venueId: string; venueName: string | null; place: number };

function PassportRanked({ handle }: { handle: string }) {
  const { user } = useAuth();
  const account = user?.id ?? "";
  const [read, setRead] = useState<{ account: string; entries: RankingEntry[] } | null>(null);
  const [shareLine, setShareLine] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    void authedFetch("/api/social/rankings", { signal: controller.signal }, { requiresIdentity: true })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { entries?: RankingEntry[] };
        return Array.isArray(body.entries) ? body.entries : [];
      })
      .catch(() => null)
      .then((entries) => {
        if (!controller.signal.aborted && entries) setRead({ account, entries });
      });
    return () => controller.abort();
  }, [account]);

  if (!read || read.account !== account) return null;
  const entries = [...read.entries].sort((a, b) => a.place - b.place);

  async function share() {
    setSharing(true);
    setShareLine(null);
    try {
      const response = await authedFetch(
        `/api/profiles/${encodeURIComponent(handle)}/top-ten`,
        { cache: "no-store" },
        { requiresIdentity: true },
      );
      const body = (await response.json().catch(() => ({}))) as { path?: string };
      if (!response.ok || !body.path) throw new Error("share failed");
      const url = new URL(body.path, window.location.origin).toString();
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `@${handle}'s top ten`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareLine(PASSPORT_COPY.shareReady);
      }
    } catch (error) {
      // A person closing the share sheet is not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setShareLine(PASSPORT_COPY.shareFailed);
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <section id="passport-ranked" className="passportSection" aria-labelledby="passport-ranked-title">
      <div className="passportSectionHead">
        <h2 id="passport-ranked-title" className="passportSectionTitle">
          {PASSPORT_COPY.rankedTitle}
        </h2>
        {entries.length ? (
          <Button type="button" variant="secondary" onClick={share} disabled={sharing}>
            {PASSPORT_COPY.share}
          </Button>
        ) : null}
      </div>
      <p className="passportQuiet">{PASSPORT_COPY.rankedLine}</p>
      {shareLine ? (
        <p className="passportQuiet" role="status">
          {shareLine}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <EmptyState title="Nothing ranked yet.">{PASSPORT_COPY.rankedEmpty}</EmptyState>
      ) : (
        <ol className="passportList">
          {entries.map((entry) => (
            <li key={entry.venueId} className="passportRow">
              <span className="passportPlace">{entry.place}</span>
              <Link prefetch={false} href={venueMapUrl(entry.venueId)} className="passportRowName">
                {entry.venueName || "A London pub"}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The taste card. Renders nothing when no fact is stored. */
export function PassportTasteCard({ facts }: { facts: readonly TasteFact[] }): React.JSX.Element | null {
  if (!facts.length) return null;
  return (
    <section id="passport-taste" className="passportSection" aria-labelledby="passport-taste-title">
      <h2 id="passport-taste-title" className="passportSectionTitle">
        {TASTE_COPY.title}
      </h2>
      <dl className="passportFacts">
        {facts.map((fact) => (
          <div key={fact.key} className="passportFact">
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              <span className="passportFactDate">{passportDayLabel(fact.date)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PassportTaste({ handle }: { handle: string }) {
  const taste = usePassportRead<PassportTasteRead>("taste", handle);
  return taste ? <PassportTasteCard facts={taste.facts ?? []} /> : null;
}

function OverlapRow({ title, venues }: { title: string; venues: readonly PassportVenue[] }) {
  if (!venues.length) return null;
  return (
    <div className="passportSection">
      <h2 className="passportSectionTitle">{title}</h2>
      <ul className="passportList">
        {venues.map((venue) => (
          <li key={venue.venueId} className="passportRow">
            <Link prefetch={false} href={venueMapUrl(venue.venueId)} className="passportRowName">
              {venue.venueName || "A London pub"}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two overlap rows. An empty row is left out; two empty rows are nothing. */
export function PassportOverlapRows({ overlap }: { overlap: PassportOverlapRead }): React.JSX.Element | null {
  if (!overlap.topFive.length && !overlap.wantToTry.length) return null;
  return (
    <div id="passport-overlap">
      <OverlapRow title={PASSPORT_COPY.overlapTop} venues={overlap.topFive} />
      <OverlapRow title={PASSPORT_COPY.overlapWanted} venues={overlap.wantToTry} />
    </div>
  );
}

function PassportOverlap({ handle }: { handle: string }) {
  const { user } = useAuth();
  const overlap = usePassportRead<PassportOverlapRead>("overlap", handle, Boolean(user));
  return overlap ? <PassportOverlapRows overlap={overlap} /> : null;
}

export default function PassportSections({
  handle,
  isOwner,
}: {
  handle: string;
  isOwner: boolean;
}): React.JSX.Element | null {
  // "you" is the signed-out sentinel route, never an account.
  if (!handle || handle === "you") return null;
  return (
    <>
      <PassportBeen handle={handle} isOwner={isOwner} />
      {isOwner ? <PassportRanked handle={handle} /> : null}
      {isOwner ? <PassportTaste handle={handle} /> : null}
      {isOwner ? null : <PassportOverlap handle={handle} />}
    </>
  );
}
