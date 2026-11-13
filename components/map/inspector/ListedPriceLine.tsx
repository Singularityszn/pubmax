import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { firstHttp } from "@/lib/httpUrl";
import type { ListedPriceInput } from "@/lib/priceTier";
import styles from "./ListedPriceLine.module.css";

/**
 * The line under a published price: the drink it is for, who listed it, the
 * day it was recorded, and that it may have changed since. A source read never
 * confirms tonight's price, so the last clause is always said.
 */
export default function ListedPriceLine({ listed, className }: { listed: ListedPriceInput; className?: string }) {
  const drink = listed.drinkLabel?.trim();
  const serving = listed.servingSize?.trim();
  const label = listed.publisher?.trim() || "source";
  const url = firstHttp(listed.sourceUrl);
  const ms = Date.parse(listed.observedAt);
  const day = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
  return (
    <small className={className}>
      {drink ? <>{serving ? `${drink}, ${serving.toLowerCase()}` : drink} · </> : null}
      Listed by{" "}
      {url ? (
        <a className={`priceSourceLink ${styles.publisher}`} href={url} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        <>{label} (Link unavailable)</>
      )}
      {day ? (
        <>
          , recorded <time dateTime={day}>{formatObservedDate(new Date(`${day}T12:00:00Z`))}</time>.
        </>
      ) : (
        ". Record date unavailable."
      )}{" "}
      May have changed since.
    </small>
  );
}
