"use client";

import type { SocialCrewPublicPreviewDTO } from "@/lib/socialCrew";
import ReportPerson from "@/components/social/ReportPerson";
import { displayHandle } from "@/lib/handleDisplay";
import {
  STILL_TRUE_JOIN_LABEL,
  STILL_TRUE_PENDING_LINE,
  STILL_TRUE_SMALL_PRINT,
  stillTrueHeadcountLines,
  stillTrueListedLine,
} from "@/lib/openCrawl";
import { crewStartsCaption } from "@/lib/socialCrewsUi";
import {
  formatOpenCrawlShareSpendBand,
  openCrawlShareAreaLine,
  openCrawlSharePlacesLine,
} from "@/lib/openCrawlShareCard";

export type PublicCrewJoinState = "none" | "pending" | "declined";

export default function PublicCrewPreview({
  preview,
  joinState,
  busy,
  problem,
  onAskToJoin,
}: {
  preview: SocialCrewPublicPreviewDTO;
  joinState: PublicCrewJoinState;
  busy: boolean;
  problem: string;
  onAskToJoin: () => void;
}) {
  const starts = crewStartsCaption(preview.startsAt);
  const area = openCrawlShareAreaLine(preview.area);
  const night = preview.stillTrue ?? null;
  const places = night ? null : openCrawlSharePlacesLine(preview.placesLeft);
  const band = night || !preview.spendBand ? null : formatOpenCrawlShareSpendBand(preview.spendBand);
  const headcount = night ? stillTrueHeadcountLines(night) : [];
  const listed = night ? stillTrueListedLine(night.listedPint) : null;
  return (
    <>
      <header className="crewPage__head">
        <h1>{preview.title}</h1>
        <p className="crewPage__meta">
          <span>{displayHandle(preview.hostHandle)}</span>
          {starts ? <time dateTime={preview.startsAt}>{starts}</time> : null}
        </p>
      </header>

      <section aria-labelledby="public-crew-meeting-point">
        <h2 id="public-crew-meeting-point" className="crews__title">
          Meet at
        </h2>
        <p className="crews__note">
          {preview.meetingPoint.name}
          {area ? ` · ${area}` : null}
        </p>
        {places || band ? (
          <p className="crews__muted">{[places, band].filter(Boolean).join(" · ")}</p>
        ) : null}
        {headcount.length > 0 ? <p className="crews__note">{headcount.join(" ")}</p> : null}
        {listed ? <p className="crews__note">{listed}</p> : null}
        {night ? <p className="crews__muted">{STILL_TRUE_SMALL_PRINT}</p> : null}
      </section>

      {problem ? (
        <p className="crews__problem" role="alert">
          {problem}
        </p>
      ) : null}

      {joinState === "pending" ? (
        <p className="crews__muted" role="status">
          {night ? STILL_TRUE_PENDING_LINE : "Request sent. The host decides."}
        </p>
      ) : joinState === "declined" ? (
        <p className="crews__muted" role="status">
          The host said no to this one.
        </p>
      ) : (
        <section className="crews__notice">
          <button
            type="button"
            className="crews__button crews__button--primary"
            disabled={busy}
            onClick={onAskToJoin}
          >
            {busy ? "Working…" : night ? STILL_TRUE_JOIN_LABEL : "Ask to join"}
          </button>
        </section>
      )}
      <ReportPerson handles={[preview.hostHandle]} />
    </>
  );
}
