"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import Pagination from "@/components/listing/Pagination";
import { RowList, RowListItem } from "@/components/ui/row-list";
import PriceBadge from "@/components/PriceBadge";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { BoroughPubListRow } from "./boroughPubRows.server";

function BoroughPubRow({ pub, index }: { pub: BoroughPubListRow; index: number }) {
  const { evidence, price } = pub;
  return (
    <RowListItem
      href={venueMapUrl(pub.id)}
      lead={<span className="boroughRank">{index + 1}</span>}
      title={pub.name}
      meta={pub.pintLabel ?? undefined}
      detail={evidence ? <>
        <p>{evidence.drinkLabel ?? "Drink not recorded"} · {evidence.servingSize || "Serving not recorded"}</p>
        <ListedPriceSource evidence={evidence} kind={evidence.sourceKind} />
      </> : undefined}
      trailing={
        <Link prefetch={false} href={`/pubs/${encodeURIComponent(pub.id)}#ledger`} className="boroughLedgerLink" aria-label={`${pub.name}: price history`}>
          {price === null ? <span className="listingNoFigure">No price</span> : (
            <PriceBadge variant={price.variant} band={price.band}>{price.label}</PriceBadge>
          )}
        </Link>
      }
    />
  );
}

export default function BoroughPubList({ pubs, name }: { pubs: BoroughPubListRow[]; name: string }) {
  const [page, setPage] = useState(1);
  const resultsRef = useRef<HTMLDivElement>(null);
  const totalPages = Math.ceil(pubs.length / 24);
  const current = Math.min(page, Math.max(totalPages, 1));
  const offset = (current - 1) * 24;
  return <>
    <div ref={resultsRef} tabIndex={-1}>
      <RowList label={`Pubs in ${name}, cheapest pint first`} className="boroughRows boroughPubRows listingRead">
        {pubs.slice(offset, offset + 24).map((pub, index) => <BoroughPubRow key={pub.id} pub={pub} index={offset + index} />)}
      </RowList>
    </div>
    <Pagination page={current} totalPages={totalPages} label="Pub pages" onPageChange={setPage} resultsRef={resultsRef} />
  </>;
}
