import styles from "./PreparedBriefStamp.module.css";

const LONDON_PREPARED_AT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
  timeZoneName: "short",
});

/** The page's render instant stays separate from each source's observation date. */
export default function PreparedBriefStamp({ preparedAt }: { preparedAt: string | number | undefined }) {
  if (preparedAt === undefined) return null;
  const date = new Date(preparedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <p className={styles.stamp} data-testid="brief-prepared-at">
      Page prepared <time dateTime={date.toISOString()}>{LONDON_PREPARED_AT.format(date)}</time>.
      {" "}Source dates can be older.
    </p>
  );
}
