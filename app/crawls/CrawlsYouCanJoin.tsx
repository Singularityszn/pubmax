"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  OPEN_CRAWL_EMPTY_LINE,
  OPEN_CRAWL_UNREAD_LINE,
  joinableThisWeek,
  openCrawlPlacesLeft,
  openCrawlPlacesLine,
  parseOpenCrawlListing,
  type OpenCrawlListing,
} from "@/lib/openCrawl";
import { crewPath } from "@/lib/socialCrewsUi";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

// "CRAWLS YOU CAN JOIN THIS WEEK" (launch review 4.5, E1), the first section
// on /crawls. Open crews that carry a plan, starting in the next seven days,
// with a place left. Each row says who hosts it, when, where to meet, the
// host's one line and how many places are left, and its one door is "Ask to
// join": the crew page, where the signed-in join request route already lives
// and the host still says yes or no.
//
// The section is the whole public lane and nothing more, the same lane Tonight
// lists as "Open plans". While Social is in preview it renders nothing.

type LoadState =
  | { status: "loading" }
  | { status: "preview" }
  | { status: "degraded" }
  | { status: "ready"; crawls: OpenCrawlListing[] };

const ASK_TO_JOIN_LABEL = "Ask to join";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function readListings(body: unknown): LoadState {
  if (!body || typeof body !== "object") return { status: "degraded" };
  const record = body as { status?: unknown; crawls?: unknown };
  if (record.status === "preview") return { status: "preview" };
  if (record.status !== "ready" || !Array.isArray(record.crawls)) return { status: "degraded" };
  const crawls: OpenCrawlListing[] = [];
  for (const row of record.crawls) {
    const listing = parseOpenCrawlListing(row);
    if (listing) crawls.push(listing);
  }
  return { status: "ready", crawls: joinableThisWeek(crawls, Date.now()) };
}

export default function CrawlsYouCanJoin() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void loadSurfaceJson<unknown>(
      "/api/open-crawls",
      {
        signal: controller.signal,
        validate: (body) => readListings(body).status !== "degraded",
      },
      (body) => setState(readListings(body)),
    )
      .then((source) => {
        if (source === "failed" && !controller.signal.aborted) setState({ status: "degraded" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "degraded" });
      });
    return () => controller.abort();
  }, []);

  if (state.status === "loading" || state.status === "preview") return null;

  return (
    <section className="openCrawls" aria-labelledby="openCrawlsHeading" data-testid="crawls-you-can-join">
      <h2 id="openCrawlsHeading" className="openCrawlsHeading">
        Crawls you can join this week
      </h2>
      {state.status === "degraded" ? (
        <p className="openCrawlsLine" role="status">{OPEN_CRAWL_UNREAD_LINE}</p>
      ) : state.crawls.length === 0 ? (
        <p className="openCrawlsLine">{OPEN_CRAWL_EMPTY_LINE}</p>
      ) : (
        <ul className="openCrawlsList">
          {state.crawls.map((crawl) => {
            const left = openCrawlPlacesLeft(crawl);
            return (
              <li key={crawl.crewId} className="openCrawlsRow" data-testid="open-crawl">
                <h3 className="openCrawlsTitle">{crawl.title}</h3>
                <p className="openCrawlsDescription">{crawl.description}</p>
                <p className="openCrawlsMeta">
                  {`@${crawl.hostHandle}, ${WHEN.format(new Date(Date.parse(crawl.startTime)))}`}
                </p>
                <p className="openCrawlsMeta">
                  {`Meet at ${crawl.meetingVenueName}. ${openCrawlPlacesLine(left)}.`}
                </p>
                <Link
                  prefetch={false}
                  className="openCrawlsJoin"
                  href={crewPath(crawl.crewId)}
                  aria-label={`${ASK_TO_JOIN_LABEL}: ${crawl.title}`}
                >
                  {ASK_TO_JOIN_LABEL}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
