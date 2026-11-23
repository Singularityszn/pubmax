import { formatObservedDate } from "@/lib/dataFreshness";
import { priceDateWord } from "@/lib/priceDateWord";
import { priceSourceOf } from "@/lib/priceSourceLink";
import PriceSourceName from "./PriceSourceName";
import styles from "./ListedPriceSource.module.css";

export default function ListedPriceSource({ evidence, className = "", kind = "listed" }: {
  evidence: { publisher: { label: string; url?: string | null } | null; observedOn: string | null };
  className?: string;
  kind?: "listed" | "reported";
}) {
  const { label, url } = evidence.publisher ?? {};
  const source = priceSourceOf(label, url);
  const dateKind = kind === "reported" ? "seen" : "read";
  // "Link unavailable." closes its own sentence.
  const refused = source.kind === "refused";
  return <p className={`listedPriceSource ${className}`}>
    {source.kind === "missing" ? null : <>{kind === "reported" ? "Reported via" : "Listed by"} </>}
    <PriceSourceName className={styles.publisher} label={label} url={url} />
    {evidence.observedOn
      ? <>{refused ? ` ${priceDateWord(dateKind, true)}` : `, ${priceDateWord(dateKind)}`} <time dateTime={evidence.observedOn}>{formatObservedDate(new Date(`${evidence.observedOn}T12:00:00Z`))}</time>.</>
      : `${refused ? "" : "."} ${kind === "reported" ? "Report date unavailable." : "Read date unavailable."}`}
  </p>;
}
