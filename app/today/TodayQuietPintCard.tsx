// "A quiet pint": heritage-cited pubs that also read as quiet right now, for
// the calmer cohort the youth-skewing surfaces under-serve. Hosted on /today
// and /tonight from the same server compose (lib/quietPint over the cited
// historic-pub set); this component only renders it, so there is no client
// fetch and the first paint is deterministic. Fail-soft: a null module renders
// nothing.
//
// A SECTION, NOT A CARD (taste plan, 18 Oct 2026). A heading, one line, and a
// hairline list. What every row shares is said ONCE in that line: the quiet
// reading is one reading for the hour ("Usually quiet on a Sunday"), every
// history is sourced, and when every source is the same publisher it is named
// there too. Each row keeps only what is its own: the name, its banded pint,
// the cited line, its grade and era, and the link to its own source. The cited
// heritage line does the selling; the copy never markets at the reader.

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";

import { ProseDisclosure } from "@/components/Disclosure";
import { PintPriceBadge } from "@/components/PriceBadge";
import type { QuietPintModule } from "@/lib/quietPint";

import "./quietPintCard.css";

type Props = { module: QuietPintModule | null };

/** One publisher behind every row, or null when the rows cite several. */
function sharedSource(module: QuietPintModule): string | null {
  const labels = new Set(module.rows.map((row) => row.sourceLabel));
  return labels.size === 1 ? (module.rows[0]?.sourceLabel ?? null) : null;
}

export default function TodayQuietPintCard({ module }: Props) {
  if (!module || module.rows.length === 0) return null;
  const quietLabel = module.rows[0]?.quietLabel ?? null;
  const oneSource = sharedSource(module);

  return (
    <section
      className="todayCard"
      aria-labelledby="today-quiet-pint-title"
      data-testid="today-quiet-pint"
    >
      <h2 className="todayCardTitle" id="today-quiet-pint-title">
        A quiet pint, and a bit of history.
      </h2>
      <p className="todayCardLine">
        {quietLabel ? `${quietLabel}, the usual pattern for this hour rather than a live count. ` : null}
        {oneSource ? `Every history here is sourced from ${oneSource}.` : "Every history here is sourced."}
      </p>

      <ul className="quietPintList">
        {module.rows.map((row) => (
          <li key={row.id} className="quietPintRow">
            <div className="quietPintTop">
              <Link className="quietPintLink quietPintName pressable" href={row.mapHref}>
                {row.name}
              </Link>
              {typeof row.priceGbp === "number" ? (
                <PintPriceBadge
                  className="quietPintPrice"
                  priceGbp={row.priceGbp}
                  venueId={row.id}
                  label={row.priceLabel ?? undefined}
                />
              ) : null}
            </div>
            <div className="quietPintHeritage">
              <ProseDisclosure text={row.heritageLine} />
            </div>
            <p className="quietPintFoot">
              {[row.gradeLabel, row.eraLabel].filter(Boolean).join(" · ")}
              {row.gradeLabel || row.eraLabel ? <span aria-hidden="true"> · </span> : null}
              {row.sourceRef ? (
                <a
                  className="quietPintSource"
                  href={row.sourceRef}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${row.name}, source: ${row.sourceLabel}`}
                >
                  {oneSource ? "Source" : row.sourceLabel}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                <span className="quietPintSource">{row.sourceLabel}</span>
              )}
            </p>
          </li>
        ))}
      </ul>

      <p className="todayCardFootRow">
        <Link href="/historic" className="todayInkLink">
          More historic pubs
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
