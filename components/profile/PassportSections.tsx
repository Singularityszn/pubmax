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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { authedFetch } from "@/lib/authedFetch";
import { buildCrawlMapHref } from "@/lib/crawlUrl";
import {
  PASSPORT_COPY,
  TASTE_COPY,
  passportDayLabel,
  type BeenCompare,
  type BeenVenue,
  type ComparedVenue,
  type PassportVenue,
  type TasteFact,
} from "@/lib/profilePassport";
import {
  heldRanking,
  startRankingCheckpoint,
  transitionRankingCheckpoint,
  type RankingCheckpointEvent,
  type RankingReadOutcome,
} from "@/lib/rankingCheckpoint";
import { socialPubRankingPayload, socialPubRankingReadFailure, type SocialPubRankingEntry } from "@/lib/socialPubRankings";
import { venueMapUrl } from "@/lib/venueMapUrl";

import BeenCardShare from "./BeenCardShare";
import BeenCompareMap from "./BeenCompareMap";
import FirstTenRanking from "./FirstTenRanking";
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
  handle,
}: {
  been: PassportBeenRead;
  isOwner: boolean;
  handle?: string;
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
      {isOwner && handle ? <BeenCardShare handle={handle} count={been.venues.length} /> : null}
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
  return been ? (
    <PassportBeenList been={been} isOwner={isOwner && been.access === "full"} handle={handle} />
  ) : null;
}

type Ranked = SocialPubRankingEntry[];

/** The owner's ranking read, as what it proves. */
async function readRanked(signal: AbortSignal, readerInside: () => boolean): Promise<RankingReadOutcome<Ranked>> {
  try {
    const response = await authedFetch("/api/social/rankings", { signal }, { requiresIdentity: true });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const entries = socialPubRankingPayload(payload);
      return entries ? { kind: "data", data: entries } : { kind: "unavailable" };
    }
    return socialPubRankingReadFailure(response.status, payload) === "refused"
      ? { kind: "refused", readerInside: readerInside() }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Keyed on the account, so a list never outlives the account it was read for. */
function PassportRanked({ handle }: { handle: string }) {
  const { user } = useAuth();
  const account = user?.id ?? "";
  return account ? <RankedSection key={account} account={account} handle={handle} /> : null;
}

function RankedSection({ account, handle }: { account: string; handle: string }) {
  const { user } = useAuth();
  const [state, setState] = useState(startRankingCheckpoint<Ranked>);
  const current = useRef(state);
  const send = useCallback((event: RankingCheckpointEvent<Ranked>) => {
    const next = transitionRankingCheckpoint(current.current, event);
    if (next === current.current) return;
    current.current = next;
    setState(next);
  }, []);
  const [shareLine, setShareLine] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const pendingWrite = useRef<Promise<void> | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const request = state.request;
  useEffect(() => {
    if (current.current.phase !== "reading") return;
    const controller = new AbortController();
    void (async () => {
      // A save the session never confirmed settles before the list is read.
      await pendingWrite.current;
      if (controller.signal.aborted) return;
      const outcome = await readRanked(controller.signal, () => Boolean(sectionRef.current?.contains(document.activeElement)));
      if (!controller.signal.aborted) send({ type: "answered", request, outcome });
    })();
    return () => controller.abort();
  }, [request, send]);

  const afterRetry = state.phase === "ready" && state.afterRetry ? state.request : null;
  useLayoutEffect(() => {
    if (afterRetry !== null) headingRef.current?.focus();
  }, [afterRetry]);

  const retired = state.phase === "refused" && state.retired ? state.request : null;
  useEffect(() => {
    if (retired === null) return;
    // A closing comparison hands the page back in a microtask.
    queueMicrotask(() => headingRef.current?.focus());
  }, [retired]);

  // Nothing read for one account is shown under another, even for one render.
  if ((user?.id ?? "") !== account) return null;
  const held = heldRanking(state);
  const retrying = state.phase === "reading" && state.retrying;
  // The first read of a page says nothing until it has something to say.
  const quiet = state.phase === "ready" || state.phase === "refused" || (state.phase === "reading" && held === null && !retrying);
  const statusText = quiet ? "" : state.phase === "unavailable" ? "Your ranking is unavailable right now." : "Checking your ranking…";
  const announcement = <p className="sr-only" role="status">{statusText}</p>;
  if (state.phase === "refused") {
    return state.retired ? (
      <section id="passport-ranked" className="passportSection" aria-labelledby="passport-ranked-title">
        <h2 id="passport-ranked-title" className="passportSectionTitle" ref={headingRef} tabIndex={-1}>
          {PASSPORT_COPY.rankedTitle}
        </h2>
        <p className="passportQuiet" role="status">Your ranking is not available to this account right now.</p>
      </section>
    ) : announcement;
  }
  if (held === null && quiet) return announcement;
  const retryStatus = state.phase !== "ready" ? (
    <>
      <p className="passportQuiet" aria-hidden="true">{statusText}</p>
      {state.phase === "unavailable" || retrying ? (
        <p className="passportQuiet">
          <Button type="button" variant="ghost" aria-disabled={retrying} onClick={() => { if (current.current.phase === "unavailable") send({ type: "read", retrying: true }); }}>
            Try again
          </Button>
        </p>
      ) : null}
    </>
  ) : null;
  if (held === null) {
    return (
      <>{announcement}<section ref={sectionRef} id="passport-ranked" className="passportSection" aria-labelledby="passport-ranked-title">
        <h2 id="passport-ranked-title" className="passportSectionTitle" ref={headingRef} tabIndex={-1}>
          {PASSPORT_COPY.rankedTitle}
        </h2>
        {retryStatus}
      </section></>
    );
  }
  const entries = [...held].sort((a, b) => a.place - b.place);

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
    <>{announcement}<section ref={sectionRef} id="passport-ranked" className="passportSection" aria-labelledby="passport-ranked-title">
      <div className="passportSectionHead">
        <h2 id="passport-ranked-title" className="passportSectionTitle" ref={headingRef} tabIndex={-1}>
          {PASSPORT_COPY.rankedTitle}
        </h2>
        {entries.length ? (
          <Button type="button" variant="secondary" onClick={share} disabled={sharing}>
            {PASSPORT_COPY.share}
          </Button>
        ) : null}
      </div>
      <p className="passportQuiet">{PASSPORT_COPY.rankedLine}</p>
      {retryStatus}
      {shareLine ? (
        <p className="passportQuiet" role="status">
          {shareLine}
        </p>
      ) : null}
      {entries.length === 0 ? null : (
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
      <FirstTenRanking
        entries={held}
        disabled={state.phase !== "ready"}
        completionFocusRef={headingRef}
        onSaved={(saved) => send({ type: "session_saved", data: saved })}
        onClosed={(refresh, reason) => {
          if (reason !== "refused") pendingWrite.current = refresh;
          send({ type: "session_closed", refresh: refresh !== undefined, refused: reason === "refused" });
        }}
      />
    </section></>
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

const COMPARE_SHOWN = 8;

function CompareColumn({ title, venues }: { title: string; venues: readonly PassportVenue[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? venues : venues.slice(0, COMPARE_SHOWN);
  return (
    <div className="passportCompareColumn">
      <h3 className="passportCompareTitle">
        {title} <span className="passportCompareCount">{venues.length}</span>
      </h3>
      {venues.length === 0 ? (
        <p className="passportQuiet">{PASSPORT_COPY.compareNone}</p>
      ) : (
        <ul className="passportList">
          {shown.map((venue) => (
            <li key={venue.venueId} className="passportRow">
              <Link prefetch={false} href={venueMapUrl(venue.venueId)} className="passportRowName">
                {venue.venueName || "A London pub"}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!showAll && venues.length > COMPARE_SHOWN ? (
        <Button type="button" variant="ghost" onClick={() => setShowAll(true)}>
          Show all {venues.length}
        </Button>
      ) : null}
    </div>
  );
}

/** The viewer's Been list next to a mate's, as three name lists. No score. */
function PassportBeenCompare({ been }: { been: BeenCompare<ComparedVenue> }): React.JSX.Element {
  const empty = !been.both.length && !been.onlyYou.length && !been.onlyThem.length;
  return (
    <section id="passport-compare" className="passportSection" aria-labelledby="passport-compare-title">
      <h2 id="passport-compare-title" className="passportSectionTitle">
        {PASSPORT_COPY.compareTitle}
      </h2>
      <p className="passportQuiet">{PASSPORT_COPY.compareLine}</p>
      {empty ? (
        <p className="passportQuiet">{PASSPORT_COPY.compareEmpty}</p>
      ) : (
        <div className="passportCompare">
          <BeenCompareMap been={been} />
          <CompareColumn title={PASSPORT_COPY.compareBoth} venues={been.both} />
          <CompareColumn title={PASSPORT_COPY.compareOnlyYou} venues={been.onlyYou} />
          <CompareColumn title={PASSPORT_COPY.compareOnlyThem} venues={been.onlyThem} />
        </div>
      )}
    </section>
  );
}

/** The overlap rows. An empty row is left out; nothing to show is nothing. */
export function PassportOverlapRows({ overlap }: { overlap: PassportOverlapRead }): React.JSX.Element | null {
  const been = overlap.been ?? null;
  if (!overlap.topFive.length && !overlap.wantToTry.length && !been) return null;
  return (
    <div id="passport-overlap">
      {been ? <PassportBeenCompare been={been} /> : null}
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
