import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import { firstHttp } from "@/lib/httpUrl";
import styles from "./ListedPriceSource.module.css";

export default function ListedPriceSource({ evidence, className = "", kind = "listed" }: {
  evidence: { publisher: { label: string; url?: string | null } | null; observedOn: string | null };
  className?: string;
  kind?: "listed" | "reported";
}) {
  const label = evidence.publisher?.label.trim();
  const url = firstHttp(evidence.publisher?.url);
  return <p className={`listedPriceSource ${className}`}>
    {label ? <>{kind === "reported" ? "Reported via" : "Listed by"} {url ? <a className={styles.publisher} href={url} target="_blank" rel="noopener noreferrer">{label}</a> : <>{label} (Link unavailable)</>}</> : "Publisher not recorded"}
    {evidence.observedOn ? <>, {kind === "reported" ? "seen" : "collected"} <time dateTime={evidence.observedOn}>{formatObservedDate(new Date(`${evidence.observedOn}T12:00:00Z`))}</time>.</> : kind === "reported" ? ". Report date unavailable." : ". Read date unavailable."}
  </p>;
}
