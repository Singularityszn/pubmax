"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { buildBoroughPassport } from "@/lib/passport";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle, type ProfileDrop } from "@/lib/profiles";

type PublicDrop = ProfileDrop & { id?: string };

type BoroughPassportSliceProps = {
  boroughName: string;
  venueIds: string[];
};

export default function BoroughPassportSlice({ boroughName, venueIds }: BoroughPassportSliceProps) {
  const [handle, setHandle] = useState("");
  const [passport, setPassport] = useState(() =>
    buildBoroughPassport([], boroughName, venueIds),
  );

  useEffect(() => {
    let active = true;
    async function load() {
      let myHandle = "";
      try {
        myHandle = normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
        if (active) setHandle(myHandle);
      } catch {
        // storage disabled — stay anonymous
      }
      if (!myHandle) {
        if (active) setPassport(buildBoroughPassport([], boroughName, venueIds));
        return;
      }
      try {
        // Scope the feed to this handle via ?author= — never pull the global
        // public feed just to filter client-side.
        const qs = new URLSearchParams({ author: myHandle });
        const res = await fetch(`/api/pint-drops?${qs.toString()}`);
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { drops?: PublicDrop[] };
        const mine = (body.drops ?? []).filter(
          (drop) => normalizeHandle(drop.handle) === myHandle,
        );
        if (active) {
          setPassport(buildBoroughPassport(mine, boroughName, venueIds));
        }
      } catch {
        // offline — keep the zeroed slice
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [boroughName, venueIds]);

  const hasActivity = !passport.isEmpty;

  return (
    <section className="boroughSection boroughPassport" aria-labelledby="boroughPassportHeading">
      <h2 id="boroughPassportHeading" className="boroughSectionTitle">
        Your {boroughName} passport
      </h2>
      <p className="boroughSectionDek">
        {handle ? (
          <>
            Pubs logged, drinks tried, and pints stamped in {boroughName} for @{handle}.
          </>
        ) : (
          <>
            Claim a handle on your profile to start collecting borough chapters. Session-only
            for now, no home address stored.
          </>
        )}
      </p>
      <dl className="boroughPassportGrid" aria-label={`Passport stats for ${boroughName}`}>
        <div className="boroughPassportStat">
          <dt>Pubs visited</dt>
          <dd>{passport.pubs}</dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Drinks tried</dt>
          <dd>{passport.beers}</dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Pints logged</dt>
          <dd>{passport.pints}</dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Cheapest pint</dt>
          <dd>{passport.cheapestPintGbp == null ? "–" : `£${passport.cheapestPintGbp.toFixed(2)}`}</dd>
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
            Open full passport →
          </Link>
        </p>
      ) : handle ? (
        <p className="boroughPassportFoot">
          Nothing stamped in {boroughName} yet.{" "}
          <Link href={`/map?q=${encodeURIComponent(boroughName)}`}>Log a pint on the map →</Link>
        </p>
      ) : (
        <p className="boroughPassportFoot">
          <Link href="/u/you">Set your handle →</Link>
        </p>
      )}
    </section>
  );
}
