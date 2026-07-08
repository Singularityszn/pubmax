"use client";

import Link from "next/link";

import type { PassportData } from "@/lib/passport";

// The Pint Passport (user story 29): a collectible field-guide "passport page"
// that renders a handle's already-computed stats + badges as stamped identity.
// Prop-driven and stateless — the page aggregates the data (lib/passport
// buildPassport) and hands it here. The same component renders the FIRST-RUN
// empty state (story 30): when `data.isEmpty`, the stat faces read zero and a
// "start your passport" call-to-action block is shown instead of a bare card.
//
// Design: keeps one stamped identity seal, while stats and badges stay calm and
// aligned so the passport reads like a field-guide page instead of a sheet of
// rubber stamps. All colour / spacing comes from existing tokens via profile.css.

type PintPassportProps = {
  // The @handle this passport belongs to (already normalized), for the header.
  handle: string;
  // The display name shown as the passport's "holder".
  displayName: string;
  data: PassportData;
  // When true, this is the viewer's OWN passport (drives first-run CTA copy:
  // "start yours" vs a neutral empty state for someone else's fresh handle).
  isOwn?: boolean;
};

function formatGbp(value: number | null): string {
  return value == null ? "—" : `£${value.toFixed(2)}`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="passportStat">
      <span className="passportStatValue">{value}</span>
      <span className="passportStatLabel">{label}</span>
    </div>
  );
}

export default function PintPassport({ handle, displayName, data, isOwn }: PintPassportProps) {
  const {
    pubs,
    boroughs,
    beers,
    crawls,
    pints,
    cheapestPintGbp,
    storyPosts,
    badges,
    isEmpty,
  } = data;

  return (
    <section className="pintPassport" aria-labelledby="passportHeading">
      <header className="passportHead">
        <div>
          <p className="passportKicker" aria-hidden="true">
            Pint Passport
          </p>
          <h2 id="passportHeading" className="passportHolder">
            {displayName}
          </h2>
          <p className="passportHandle">@{handle}</p>
        </div>
        {/* The signature stamp — the one tilted ink element on the page. */}
        <span className="passportSeal ink-stamp ink-stamp--tilt" aria-hidden="true">
          PUBMAXXING
        </span>
      </header>

      {isEmpty ? (
        <div className="passportFirstRun">
          <p className="passportFirstRunLead">
            {isOwn
              ? "Your passport is blank — for now."
              : "This passport is blank — for now."}
          </p>
          <p className="passportFirstRunCopy">
            {isOwn
              ? "Every pint you log stamps a page: pubs visited, boroughs crossed, beers tried, the cheapest pint you've found. Start collecting your nights."
              : "No pints logged here yet. When they are, this page fills with pubs, boroughs, beers and badges."}
          </p>
          {isOwn ? (
            <div className="passportFirstRunActions">
              <Link className="passportCta passportCtaPrimary" href="/map">
                Open the map
              </Link>
              <Link className="passportCta" href="/map?log=1">
                Log a pint
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The stat grid renders in BOTH states — zeros on first run make the
          passport read as a real (empty) page to fill, not a broken one. */}
      <div className="passportGrid" role="group" aria-label="Passport statistics">
        <Stat label="Pubs" value={pubs} />
        <Stat label="Boroughs" value={boroughs.length} />
        <Stat label="Beers" value={beers} />
        <Stat label="Crawls" value={crawls} />
        <Stat label="Pints" value={pints} />
        <Stat label="Cheapest pint" value={formatGbp(cheapestPintGbp)} />
        <Stat label="Story posts" value={storyPosts} />
        <Stat label="Badges" value={badges.length} />
      </div>

      {boroughs.length ? (
        <p className="passportBoroughs">
          <span className="passportBoroughsLabel">Boroughs crossed:</span>{" "}
          {boroughs.join(" · ")}
        </p>
      ) : null}

      {badges.length ? (
        <ul className="passportBadges" aria-label="Badges earned">
          {badges.map((badge) => (
            <li
              key={badge.id}
              className="passportBadge"
              title={`${badge.label} — ${badge.description}`}
            >
              {badge.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
