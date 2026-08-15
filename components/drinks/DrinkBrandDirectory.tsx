import { formatObservedDate } from "@/lib/dataFreshness";
import {
  type DrinkBrandLandingRow,
  formatDrinkBrandLandingPublisherStatus,
} from "@/lib/drinkBrandLanding";

export function formatDrinkBrandCollectedDate(iso: string): string {
  return formatObservedDate(new Date(iso));
}

export function DrinkBrandPublisherDisclosure({
  className,
  row,
  variant = "row",
}: {
  className: string;
  row: DrinkBrandLandingRow;
  variant?: "hero" | "row";
}) {
  const status = formatDrinkBrandLandingPublisherStatus(row.publisher);

  return (
    <span className={className}>
      {row.publisher ? (
        variant === "hero" ? (
          <a
            href={row.publisher.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {status}
          </a>
        ) : (
          <>
            <span>Publisher: </span>
            <a
              href={row.publisher.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {row.publisher.label}
            </a>
          </>
        )
      ) : (
        status
      )}
    </span>
  );
}
