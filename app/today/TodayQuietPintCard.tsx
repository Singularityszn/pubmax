// "A quiet pint" card: heritage-cited pubs that also read as quiet right now,
// for the calmer cohort the youth-skewing surfaces under-serve. Hosted on
// /today and /tonight from the same server compose (lib/quietPint over the
// cited historic-pub set); this component only renders it, so there is no
// client fetch and the first paint is deterministic. Fail-soft: a null module
// renders nothing.
//
// Follows /today's card idiom exactly (the #528 Tube/pints cards). The cited
// heritage line does the selling; the copy never markets at the reader. The
// quiet indicator is the app's honest register ("Usually quiet on a Tuesday"),
// and every cited claim carries its source, like Pub of the Day. No em dashes.

import Link from "next/link";
import { ArrowRight, ExternalLink, Wine } from "lucide-react";

import { ProseDisclosure } from "@/components/Disclosure";
import type { QuietPintModule } from "@/lib/quietPint";

import { todayTextButtonClass } from "./todayTextButton";

import styles from "./QuietPintCard.module.css";

type Props = { module: QuietPintModule | null };

export default function TodayQuietPintCard({ module }: Props) {
  if (!module || module.rows.length === 0) return null;

  return (
    <section
      className={styles.todayCard}
      aria-labelledby="today-quiet-pint-title"
      data-testid="today-quiet-pint"
    >
      <div className={styles.todayCardHead}>
        <span className={styles.todayCardIcon} aria-hidden="true">
          <Wine size={18} />
        </span>
        <div>
          <p className={styles.todayCardEyebrow}>For a quieter pint</p>
          <h2 className={styles.todayCardTitle} id="today-quiet-pint-title">
            A quiet pint, and a bit of history.
          </h2>
        </div>
      </div>

      <ul className={styles.quietPintList}>
        {module.rows.map((row) => (
          <li key={row.id} className={styles.quietPintRow}>
            <Link className={`${styles.quietPintLink} pressable`} href={row.mapHref}>
              <span className={styles.quietPintTop}>
                <span className={styles.quietPintName}>{row.name}</span>
                {row.priceLabel ? (
                  <span className={styles.quietPintPrice}>{row.priceLabel}</span>
                ) : null}
              </span>
            </Link>
            <div className={styles.quietPintHeritage}>
              <ProseDisclosure text={row.heritageLine} />
            </div>
            <div className={styles.quietPintFoot}>
              {row.gradeLabel ? (
                <span className={styles.quietPintGrade}>{row.gradeLabel}</span>
              ) : null}
              {row.eraLabel ? (
                <span className={styles.quietPintEra}>{row.eraLabel}</span>
              ) : null}
              <span className={styles.quietPintQuiet}>{row.quietLabel}</span>
              <span className={styles.todayProvChip}>{row.provenanceLabel}</span>
              {row.sourceRef ? (
                <a
                  className={styles.quietPintSource}
                  href={row.sourceRef}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  via {row.sourceLabel}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                <span className={styles.quietPintSource}>via {row.sourceLabel}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className={styles.todayCardFootRow}>
        <span className={styles.todayProvenance}>
          Quiet reads the usual pattern for the hour, not the door.
        </span>
        <Link href="/historic" className={todayTextButtonClass(styles.todayTextButton)}>
          More historic pubs
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
