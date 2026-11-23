import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { priceDateWord } from "@/lib/priceDateWord";
import { priceSourceOf } from "@/lib/priceSourceLink";
import type { ListedPriceInput } from "@/lib/priceTier";
import PriceSourceName from "@/components/venue/PriceSourceName";
import styles from "./ListedPriceLine.module.css";

/**
 * The line under a published price: the drink it is for, who listed it, the
 * day its source was read, and that it may have changed since. A source read never
 * confirms tonight's price, so the last clause is always said.
 */
export default function ListedPriceLine({ listed, className }: { listed: ListedPriceInput; className?: string }) {
  const drink = listed.drinkLabel?.trim();
  const serving = listed.servingSize?.trim();
  const source = priceSourceOf(listed.publisher, listed.sourceUrl);
  const ms = Date.parse(listed.observedAt);
  const day = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
  return (
    <small className={className}>
      {drink ? <>{serving ? `${drink}, ${serving.toLowerCase()}` : drink} · </> : null}
      {source.kind === "missing" ? null : "Listed by "}
      <PriceSourceName className={`priceSourceLink ${styles.publisher}`} label={listed.publisher} url={listed.sourceUrl} />
      {day ? (
        <>
          {source.kind === "refused" ? ` ${priceDateWord("read", true)}` : `, ${priceDateWord("read")}`}{" "}
          <time dateTime={day}>{formatObservedDate(new Date(`${day}T12:00:00Z`))}</time>.
        </>
      ) : (
        `${source.kind === "refused" ? "" : "."} Read date unavailable.`
      )}{" "}
      May have changed since.
    </small>
  );
}
