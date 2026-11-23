import Link from "next/link";
import type { Route } from "next";
import type { RefObject } from "react";
import "./pagination.css";

type Props = {
  page: number;
  totalPages: number;
  label: string;
} & ({ hrefForPage: (page: number) => Route; onPageChange?: never; resultsRef?: never } | {
  onPageChange: (page: number) => void; hrefForPage?: never; resultsRef: RefObject<HTMLElement | null>;
});

export default function Pagination({ page, totalPages, label, hrefForPage, onPageChange, resultsRef }: Props) {
  if (totalPages <= 1) return null;
  const changePage = (target: number) => {
    onPageChange?.(target);
    resultsRef?.current?.focus({ preventScroll: true });
    resultsRef?.current?.scrollIntoView({ block: "start" });
  };
  return (
    <nav className="listingPagination" aria-label={label}>
      {page > 1 ? (hrefForPage
        ? <Link className="listingPageButton" href={hrefForPage(page - 1)}>Previous</Link>
        : <button type="button" className="listingPageButton" onClick={() => changePage(page - 1)}>Previous</button>
      ) : <span />}
      <span>Page {page} of {totalPages}</span>
      {page < totalPages ? (hrefForPage
        ? <Link className="listingPageButton" href={hrefForPage(page + 1)}>Next</Link>
        : <button type="button" className="listingPageButton" onClick={() => changePage(page + 1)}>Next</button>
      ) : <span />}
    </nav>
  );
}
