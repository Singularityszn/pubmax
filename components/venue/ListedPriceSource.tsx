import { formatObservedDate } from "@/lib/dataFreshness";
import type { VenueListedPint } from "@/lib/venueListedPint";
import styles from "./ListedPriceSource.module.css";

export default function ListedPriceSource({ evidence, className = "" }: {
  evidence: Pick<VenueListedPint, "publisher" | "observedOn">;
  className?: string;
}) {
  return <p className={`listedPriceSource ${className}`}>
    {evidence.publisher ? <>Listed by <a className={styles.publisher} href={evidence.publisher.url} target="_blank" rel="noopener noreferrer">{evidence.publisher.label}</a></> : "Publisher not recorded"}
    {evidence.observedOn ? <>, collected <time dateTime={evidence.observedOn}>{formatObservedDate(new Date(`${evidence.observedOn}T12:00:00Z`))}</time>.</> : ". Read date unavailable."}
  </p>;
}
