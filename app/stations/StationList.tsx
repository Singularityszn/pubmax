"use client";

import type { Route } from "next";
import { useId, useRef, useState } from "react";
import Pagination from "@/components/listing/Pagination";
import { RowList, RowListItem } from "@/components/ui/row-list";

export default function StationList({ stations }: { stations: { name: string; zone: number; slug: string }[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const needle = query.trim().toLocaleLowerCase("en-GB");
  const matching = stations.filter((station) => station.name.toLocaleLowerCase("en-GB").includes(needle));
  const totalPages = Math.ceil(matching.length / 24);
  const current = Math.min(page, Math.max(totalPages, 1));
  return <>
    <div className="stationSearch listingRead">
      <label htmlFor={searchId}>Find a station</label>
      <input id={searchId} type="search" value={query} placeholder="Station name"
        onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
    </div>
    <div ref={resultsRef} tabIndex={-1}>
      {matching.length ? <RowList label="London stations" className="boroughRows listingRead">
        {matching.slice((current - 1) * 24, current * 24).map((station) =>
          <RowListItem key={station.name} href={`/stations/${station.slug}` as Route} title={station.name} meta={`Zone ${station.zone}`} />)}
      </RowList> : <p>No stations match this search.</p>}
    </div>
    <Pagination page={current} totalPages={totalPages} label="Station pages" onPageChange={setPage} resultsRef={resultsRef} />
  </>;
}
