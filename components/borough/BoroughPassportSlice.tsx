"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useAuth } from "@/components/auth/AuthProvider";
import { formatGbp } from "@/lib/formatGbp";
import { buildBoroughPassport } from "@/lib/passport";
import { normalizeHandle, type ProfileDrop } from "@/lib/profiles";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

type PublicDrop = ProfileDrop & { id?: string };

type BoroughPassportSliceProps = {
  boroughName: string;
  venueIds: string[];
};

export default function BoroughPassportSlice({ boroughName, venueIds }: BoroughPassportSliceProps) {
  const { identityResolved } = useAuth();
  const viewerHandle = useViewerHandle();
  const handle = viewerHandle ?? "";
  const [passport, setPassport] = useState(() =>
    buildBoroughPassport([], boroughName, venueIds),
  );
  const identityLoading = !identityResolved;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      if (!identityResolved) return;
      if (!handle) {
        if (active) setPassport(buildBoroughPassport([], boroughName, venueIds));
        return;
      }
      // Scope the feed to this handle via ?author= — never pull the global
      // public feed just to filter client-side.
      const qs = new URLSearchParams({ author: handle });
      await loadSurfaceJson<{ drops?: PublicDrop[] }>(
        `/api/pint-drops?${qs.toString()}`,
        {
          signal: controller.signal,
          validate: (body) => Array.isArray(body?.drops),
        },
        (body) => {
          const mine = (body.drops ?? []).filter(
            (drop) => normalizeHandle(drop.handle) === handle,
          );
          if (active) {
            setPassport(buildBoroughPassport(mine, boroughName, venueIds));
          }
        },
      );
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [boroughName, handle, identityResolved, venueIds]);

  // A previous account's passport must not survive an unresolved account
  // boundary. The live answer controls whether these stats are data or shapes.
  const shownPassport = identityLoading
    ? buildBoroughPassport([], boroughName, venueIds)
    : passport;
  const hasActivity = !shownPassport.isEmpty;

  // A stranger has no passport, so the section has no rows: four zeros under
  // a heading is an empty state standing in as page content (taste plan,
  // 18 Oct 2026). It renders nothing once the account answers with no handle.
  if (!identityLoading && !handle) return null;

  return (
    <section
      className={`boroughSection boroughPassport${identityLoading ? " boroughPassportLoading" : ""}`}
      aria-labelledby="boroughPassportHeading"
      aria-busy={identityLoading}
    >
      <h2 id="boroughPassportHeading" className="listingSectionTitle">
        {identityLoading ? "Borough passport" : `Your ${boroughName} passport`}
      </h2>
      <p className="listingSectionDek">
        {identityLoading ? (
          <span className="boroughPassportSkeleton boroughPassportSkeletonCopy" aria-hidden="true" />
        ) : (
          <>
            Pubs logged, drinks tried, and pints stamped in {boroughName} for @{handle}.
          </>
        )}
      </p>
      <dl className="boroughPassportGrid" aria-label={`Passport stats for ${boroughName}`}>
        <div className="boroughPassportStat">
          <dt>Pubs visited</dt>
          <dd>
            {identityLoading ? <span className="boroughPassportSkeleton" aria-hidden="true" /> : shownPassport.pubs}
          </dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Drinks tried</dt>
          <dd>
            {identityLoading ? <span className="boroughPassportSkeleton" aria-hidden="true" /> : shownPassport.beers}
          </dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Pints logged</dt>
          <dd>
            {identityLoading ? <span className="boroughPassportSkeleton" aria-hidden="true" /> : shownPassport.pints}
          </dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Cheapest pint</dt>
          <dd>
            {identityLoading ? (
              <span className="boroughPassportSkeleton" aria-hidden="true" />
            ) : shownPassport.cheapestPintGbp == null ? (
              "None yet"
            ) : (
              formatGbp(shownPassport.cheapestPintGbp)
            )}
          </dd>
        </div>
      </dl>
      {hasActivity ? (
        <p className="boroughPassportFoot">
          {passport.badges.length > 0 ? (
            <>
              {passport.badges.length} badge{passport.badges.length === 1 ? "" : "s"} earned here
              or nearby.{" "}
            </>
          ) : null}
          <Link href={handle ? `/u/${encodeURIComponent(handle)}` : "/u/you"}>
            Open full passport
          </Link>
        </p>
      ) : handle ? (
        <p className="boroughPassportFoot">
          Nothing stamped in {boroughName} yet.{" "}
          <Link prefetch={false} href={`/map?q=${encodeURIComponent(boroughName)}`}>Log a pint on the map</Link>
        </p>
      ) : null}
    </section>
  );
}
