import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { Button } from "@/components/ui/button";
import { OutCardBody } from "@/components/out/OutCard";
import { HomeTimingControl } from "@/components/out/HomeTimingControl";
import { SafeNightStrip } from "@/components/night/SafeNightStrip";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { filterRowsByArea, filterRowsByDateTime } from "@/lib/concierge/whatsOn";
import { buildOutResponse, loadServedOutEvents } from "@/lib/out/loadOut";
import { outListingKind } from "@/lib/out/listingKind";
import { loadOutingPriceEvidence } from "@/lib/outingEvidence.server";
import { outingEventStopFromRow } from "@/lib/outingEventStop";
import {
  OUTING_OCCASIONS,
  outingAsk,
  outingBasis,
  outingShortlist,
  parseOutingIntent,
  parseOutingOccasion,
} from "@/lib/outingOccasions";
import { outingShareContextParams } from "@/lib/outingShareContext";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { eventIdentityKey } from "@/lib/whatsOnRowShape.mjs";
import styles from "./outings.module.css";
import "../out/out.css";

export const metadata: Metadata = {
  title: "London outings",
  description:
    "Find a date-night pub, a garden, live music or a sourced night of dancing in London.",
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
};

function outingListingKey(row: WhatsOnRow): string {
  return eventIdentityKey(row) ?? `${row.source.label.trim().toLocaleLowerCase("en-GB")}|${row.id}`;
}

function dedupeOutingRows(rows: WhatsOnRow[]): WhatsOnRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = outingListingKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function OutingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const occasion = parseOutingOccasion(params.occasion);
  const intent = parseOutingIntent(params);
  const area = intent.area;
  const day =
    params.day === "tomorrow" || params.day === "weekend"
      ? params.day
      : "today";
  const eventsOccasion = occasion === "dancing" || occasion === "music";
  const quietDateCheck = occasion === "quiet" && Boolean(intent.date);
  const listing = eventsOccasion || quietDateCheck
    ? await buildOutResponse({ city: "london", day })
    : null;
  const datedListing = intent.date && (eventsOccasion || quietDateCheck)
    ? await loadServedOutEvents("london")
    : null;
  const relevantRows = datedListing
    ? dedupeOutingRows([...datedListing.rows, ...(listing?.events ?? [])])
    : listing?.events ?? [];
  const eventRows = filterRowsByDateTime(relevantRows, intent.date, intent.time);
  const selectedEventRows = eventRows.filter(
    (row) => outListingKind(row) === (occasion === "dancing" ? "club-night" : "gig"),
  );
  const events = area ? filterRowsByArea(selectedEventRows, area) : selectedEventRows;
  const quietWarnings = quietDateCheck && (listing?.listingsStatus !== "ready" || datedListing?.readStatus === "degraded");
  const venues = eventsOccasion
    ? []
    : outingShortlist(await loadConciergeVenues("london"), occasion, area, {
        ...(intent.date ? { date: intent.date } : {}),
        ...(quietDateCheck ? { events: relevantRows } : {}),
        ...(intent.groupSize ? { groupSize: intent.groupSize } : {}),
        ...(intent.alcohol !== "any" ? { alcohol: intent.alcohol } : {}),
      });
  const priceEvidence = eventsOccasion ? new Map() : await loadOutingPriceEvidence();
  const ask = `${outingAsk(occasion, area, intent)}${!intent.date ? day === "tomorrow" ? ", tomorrow" : day === "weekend" ? ", this weekend" : ", tonight" : ""}`;
  const shareParams = (eventStop: ReturnType<typeof outingEventStopFromRow> = null, eventSide: "before" | "after" | null = null) =>
    outingShareContextParams({ intent, eventStop, eventPosition: null, eventSide });
  const browseHref = (id: string) => {
    const query = shareParams();
    query.set("occasion", id);
    query.set("day", day);
    return `/outings?${query}`;
  };
  const eventPlanHref = (row: (typeof events)[number], side: "before" | "after") => {
    const eventStop = outingEventStopFromRow(row);
    if (!eventStop) return "/plan";
    const query = shareParams(eventStop, side);
    query.set("query", `${ask}. Keep the sourced event as a non-pub stop, with pub stops ${side} it.`);
    return `/plan?${query}`;
  };
  const planHref = () => {
    const query = shareParams();
    query.set("query", ask);
    query.set("day", day);
    return `/plan?${query}`;
  };
  const askParams = shareParams();
  const askIntentQuery = askParams.toString();
  const askHref = `/pal/chat?ask=${encodeURIComponent(ask)}${askIntentQuery ? `&${askIntentQuery}` : ""}`;
  const evidenceDate = (value: string | null | undefined) =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium" }).format(new Date(value))
      : null;
  return (
    <main id="main" className={styles.page}>
      <SiteNav />
      <Screen
        as="section"
        kicker="London outings"
        title={OUTING_OCCASIONS[occasion]}
        titleId="outings-title"
      >
        <p>Choose somewhere first. Ask for a closer fit when you need one.</p>
        <nav className={styles.choices} aria-label="Kind of outing">
          {Object.entries(OUTING_OCCASIONS).map(([id, label]) => (
            <Link
              prefetch={false}
              key={id}
              href={browseHref(id)}
              aria-current={id === occasion ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form className={styles.filters} action="/outings">
          <input type="hidden" name="occasion" value={occasion} />
          <label>
            London area
            <input
              name="area"
              defaultValue={area}
              maxLength={80}
              placeholder="All London"
            />
          </label>
          <label>
            When
            <select name="day" defaultValue={day}>
              <option value="today">Tonight</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="weekend">Weekend</option>
            </select>
          </label>
          <label>
            Date
            <input name="date" type="date" defaultValue={intent.date} />
          </label>
          <label>
            Start time
            <input name="time" type="time" defaultValue={intent.time} />
          </label>
          <label>
            Group size
            <input name="groupSize" type="number" min={1} max={30} defaultValue={intent.groupSize ?? ""} />
          </label>
          <label>
            Budget per person (£)
            <input name="budgetGbp" type="number" min={5} max={500} step="0.01" defaultValue={intent.budgetGbp ?? ""} />
          </label>
          <label>
            Alcohol preference
            <select name="alcohol" defaultValue={intent.alcohol}>
              <option value="any">No preference</option>
              <option value="none">Alcohol-free</option>
              <option value="included">Alcohol is okay</option>
            </select>
          </label>
          <Button className={styles.submit} type="submit" data-primary-action>
            Find places
          </Button>
        </form>
        <details className={styles.filterNote}>
          <summary>How these filters affect browse</summary>
          <ul>
            <li>Area narrows this list. Date filters dated music and dance listings, and removes pubs with a recorded loud event from quiet results.</li>
            <li>Start time matches recorded start times for music and dancing. Elsewhere date and time are passed to Ask and Plan.</li>
            <li>Groups of six or more rank pubs with listed food or a garden higher.</li>
            <li>Alcohol-free keeps pubs with a recorded alcohol-free offer. Other alcohol preferences pass to Ask and Plan.</li>
            <li>Budget passes to Ask and Plan; it is not a total-visit cap. Pint prices are separate evidence.</li>
          </ul>
        </details>
        {eventsOccasion ? (
          <>
            <p>
              Published listings only. Check the publisher for admission,
              cancellation and finish times.
            </p>
            {listing?.listingsStatus !== "ready" ? (
              <p role="status">
                Some listing sources are unavailable. This may not be the full
                evening.
              </p>
            ) : null}
            {events.length ? (
              <ul className={styles.results}>
                {events.map((row) => (
                  <li key={outingListingKey(row)}>
                    <OutCardBody row={row} />
                    <p>
                      {row.endsAt
                        ? `Published finish: ${new Date(row.endsAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`
                        : "Finish time not recorded."}
                    </p>
                    <p>
                      {typeof row.priceGbp === "number" && Number.isFinite(row.priceGbp)
                        ? `Admission: tickets from £${row.priceGbp.toFixed(2)}`
                        : "Admission price not recorded in listing."}
                    </p>
                    <p>Source checked: {evidenceDate(row.observedAt) ?? "date not recorded"}.</p>
                    <p>Add pubs before or after the event, in the order you choose.</p>
                    <p>
                      <Link prefetch={false} href={eventPlanHref(row, "before")}>Plan around this event with pubs before</Link>
                      {" · "}
                      <Link prefetch={false} href={eventPlanHref(row, "after")}>Plan around this event with pubs after</Link>
                    </p>
                    {row.venueId ? (
                      <Link prefetch={false} href={venueMapUrl(row.venueId)}>
                        See the venue and plan nearby stops
                      </Link>
                    ) : (
                      <p>This event is not matched to a pub on our map.</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status">
                No sourced{" "}
                {occasion === "dancing"
                  ? "dance nights"
                  : "live music listings"}{" "}
                for this area and time. Choose another area or day.
              </p>
            )}
            <section className={styles.home}>
              <h2>Before the first stop, and after the last</h2>
              <p>
                Build your pub stops around the event. Keep its ticket and
                timing with the publisher; pub prices do not include admission.
              </p>
              <Link
                prefetch={false}
                href={planHref()}
              >
                Plan the pub stops
              </Link>
              <p>
                Check your journey home for the time you expect to leave. Your
                destination stays with the journey planner.
              </p>
              <SafeNightStrip cityId="london" />
              <HomeTimingControl />
            </section>
          </>
        ) : (
          <>
            <p>
              Atmosphere is an editorial estimate based on the listed features
              below. Noise, seats and opening hours are not confirmed for your
              visit.
            </p>
            {quietWarnings ? (
              <p role="status">Dated event listings could not all be checked, so this quiet estimate is not a guarantee for your date.</p>
            ) : null}
            {venues.length ? (
              <ul className={styles.results}>
                {venues.map(({ venue }) => (
                  <li key={venue.id}>
                    <h2>
                      <Link prefetch={false} href={venueMapUrl(venue.id)}>
                        {venue.name}
                      </Link>
                    </h2>
                    <p>{venue.area}</p>
                    <p>{outingBasis(venue).join(" · ") || "Listed pub"}</p>
                    {priceEvidence.has(venue.id) ? (
                      <p>
                        Pint evidence: {priceEvidence.get(venue.id)!.drink || "listed drink"} £{priceEvidence.get(venue.id)!.priceGbp.toFixed(2)}.
                        {priceEvidence.get(venue.id)!.sourceUrl ? (
                          <> Source: <a href={priceEvidence.get(venue.id)!.sourceUrl!} target="_blank" rel="noopener noreferrer">price record</a>.</>
                        ) : " Source URL not recorded."}
                        {priceEvidence.get(venue.id)!.reviewedAt
                          ? ` Source reviewed ${evidenceDate(priceEvidence.get(venue.id)!.reviewedAt)}.`
                          : " Review date not recorded."}
                      </p>
                    ) : (
                      <p>No price recorded.</p>
                    )}
                    {occasion === "gardens" ? (
                      <p>Weather not checked for {venue.area || "this area"}.</p>
                    ) : null}
                    <p className={styles.estimate}>
                      Editorial estimate:{" "}
                      {OUTING_OCCASIONS[occasion].toLocaleLowerCase("en-GB")}{" "}
                      candidate.
                    </p>
                    <Link prefetch={false} href={venueMapUrl(venue.id)}>
                      See venue details and prices
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status">
                No matching pubs on record in this area. Choose another area to
                browse.
              </p>
            )}
          </>
        )}
        <div className={styles.next}>
          <Link
            prefetch={false}
            href={askHref}
          >
            Ask for a closer fit
          </Link>
          {!eventsOccasion ? (
            <Link
              prefetch={false}
              href={planHref()}
            >
              Make a plan
            </Link>
          ) : null}
        </div>
      </Screen>
    </main>
  );
}
