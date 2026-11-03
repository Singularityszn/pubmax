"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { boroughBingoSquares } from "@/lib/wildBoroughBingo";
import { loadSlimVenuesForCityResult, type SlimVenue } from "@/lib/venuesSlim";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { BeenVenue } from "@/lib/profilePassport";
import "./boroughBingo.css";

export default function BoroughBingo({ been }: { been: readonly BeenVenue[] }) {
  const [venues, setVenues] = useState<readonly SlimVenue[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let live = true;
    void loadSlimVenuesForCityResult("london").then((result) => {
      if (!live) return;
      if (result.status === "ready") setVenues(result.rows);
      else setUnavailable(true);
    }).catch(() => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, []);
  const squares = useMemo(() => venues ? boroughBingoSquares(been, venues) : [], [been, venues]);
  if (unavailable) return <p>London boroughs are unavailable right now.</p>;
  if (!venues) return <p role="status">Loading London boroughs…</p>;
  return (
    <section className="boroughBingoPreview" aria-labelledby="borough-bingo-preview-title">
      <h2 id="borough-bingo-preview-title">Borough Bingo</h2>
      <p>Your Been list marks the boroughs. Only you can see this card.</p>
      <ul className="boroughBingoPreviewGrid">
        {squares.map((square) => (
          <li key={square.borough} className={`boroughBingoPreviewSquare boroughBingoPreviewSquare--${square.kind}`}>
            {square.kind === "visited" ? <Link prefetch={false} href={venueMapUrl(square.venueId)}>{square.borough}<span>{square.venueName || "View pub"}</span></Link> : <><span>{square.borough}</span>{square.kind === "free" ? <small>Free square</small> : null}</>}
          </li>
        ))}
      </ul>
    </section>
  );
}
