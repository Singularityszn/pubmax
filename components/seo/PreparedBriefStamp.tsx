import styles from "./PreparedBriefStamp.module.css";

const LONDON_PREPARED_AT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/London",
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

function preparationLabel(date: Date): string {
  const parts = Object.fromEntries(LONDON_PREPARED_AT.formatToParts(date).map(({ type, value }) => [type, value]));
  const hour = Number(parts.hour) % 24;
  const offsetHours = (hour - date.getUTCHours() + 24) % 24;
  // Localised zone names differ between Node and browsers. Read this instant's offset instead.
  const zone = offsetHours === 1 ? "BST" : "GMT";
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${String(hour).padStart(2, "0")}:${parts.minute} ${zone}`;
}

/** The page's render instant stays separate from each source's observation date. */
export default function PreparedBriefStamp({ preparedAt }: { preparedAt: string | number | undefined }) {
  if (preparedAt === undefined) return null;
  const date = new Date(preparedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <p className={styles.stamp} data-testid="brief-prepared-at">
      Page prepared <time dateTime={date.toISOString()}>{preparationLabel(date)}</time>.
      {" "}Source dates can be older.
    </p>
  );
}
