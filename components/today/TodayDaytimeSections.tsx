import { ExternalLink } from "lucide-react";

import DeskDataCredit from "@/components/nearme/DeskDataCredit";
import PriceBadge from "@/components/PriceBadge";
import { RowList, RowListItem } from "@/components/ui/row-list";
import { formatGbp } from "@/lib/formatGbp";
import type {
  TodayCoffeeModule,
  TodayLunchModule,
  TodayWorkSpotsModule,
} from "@/app/today/todayDaytime";

// The daytime sections of /today: somewhere to work, a coffee, lunch at a pub.
// Each is a heading, one line naming its source and date, and its rows. A
// module with no rows is no section: the heading never stands over an empty
// list, and nothing prints a zero.

export function TodayWorkSpots({ module }: { module: TodayWorkSpotsModule | null }) {
  if (!module || module.rows.length === 0) return null;
  return (
    <section className="todayCard" aria-labelledby="today-work-title" data-testid="today-work-spots">
      <h2 className="todayCardTitle" id="today-work-title">
        {`Work spots around ${module.areaLabel}.`}
      </h2>
      <p className="todayCardLine">{`Wifi and hours as OpenStreetMap lists them. ${module.checkedCaption}.`}</p>
      <RowList className="todayDaytimeList">
        {module.rows.map((row) => (
          <RowListItem
            key={row.id}
            title={row.name}
            meta={[row.kindLabel, row.amenityLine, row.hoursCaption].filter(Boolean).join(" · ")}
          />
        ))}
      </RowList>
      <DeskDataCredit />
    </section>
  );
}

export function TodayCoffee({ module }: { module: TodayCoffeeModule | null }) {
  if (!module || module.rows.length === 0) return null;
  return (
    <section className="todayCard" aria-labelledby="today-coffee-title" data-testid="today-coffee">
      <h2 className="todayCardTitle" id="today-coffee-title">
        {`Coffee in ${module.areaLabel}.`}
      </h2>
      <p className="todayCardLine">Listed prices from each cafe’s own page. Only Shoreditch so far.</p>
      <RowList className="todayDaytimeList">
        {module.rows.map((row) => (
          <RowListItem
            key={row.venueId}
            title={row.name}
            meta={
              <a
                className="todayProvenanceLink"
                href={row.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {`${row.drinkLabel}. ${row.sourceLine}`}
              </a>
            }
            // A coffee figure, not a pint's, so the badge stays neutral: a
            // price band is a claim about a pint alone.
            trailing={<PriceBadge>{formatGbp(row.priceGbp)}</PriceBadge>}
          />
        ))}
      </RowList>
    </section>
  );
}

export function TodayLunch({ module }: { module: TodayLunchModule | null }) {
  if (!module || module.rows.length === 0) return null;
  return (
    <section className="todayCard" aria-labelledby="today-lunch-title" data-testid="today-lunch">
      <h2 className="todayCardTitle" id="today-lunch-title">
        {`Lunch at the pub, around ${module.areaLabel}.`}
      </h2>
      <p className="todayCardLine">
        Pubs whose listing says they serve food and that publish a menu. We don’t check the menu or the kitchen hours.
      </p>
      <RowList className="todayDaytimeList">
        {module.rows.map((row) => (
          <RowListItem
            key={row.id}
            href={row.mapHref}
            title={row.name}
            meta={
              <>
                <a
                  className="todayProvenanceLink"
                  href={row.menuUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {`Menu on ${row.menuSource}`}
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
                {` · ${row.readLine}`}
              </>
            }
          />
        ))}
      </RowList>
    </section>
  );
}
