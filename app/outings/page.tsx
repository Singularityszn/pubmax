import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "@/components/nav/SiteNav";
import Screen from "@/components/ui/screen";
import { OutCardBody } from "@/components/out/OutCard";
import { SafeNightStrip } from "@/components/night/SafeNightStrip";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { filterRowsByArea } from "@/lib/concierge/whatsOn";
import { buildOutResponse } from "@/lib/out/loadOut";
import { outListingKind } from "@/lib/out/listingKind";
import {
  OUTING_OCCASIONS,
  outingAsk,
  outingBasis,
  outingShortlist,
  parseOutingOccasion,
} from "@/lib/outingOccasions";
import { venueMapUrl } from "@/lib/venueMapUrl";
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

export default async function OutingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const occasion = parseOutingOccasion(params.occasion);
  const area =
    typeof params.area === "string" ? params.area.trim().slice(0, 80) : "";
  const day =
    params.day === "tomorrow" || params.day === "weekend"
      ? params.day
      : "today";
  const eventsOccasion = occasion === "dancing" || occasion === "music";
  const listing = eventsOccasion
    ? await buildOutResponse({ city: "london", day })
    : null;
  const eventRows =
    listing?.events.filter(
      (row) =>
        outListingKind(row) ===
        (occasion === "dancing" ? "club-night" : "gig"),
    ) ?? [];
  const events = area ? filterRowsByArea(eventRows, area) : eventRows;
  const venues = eventsOccasion
    ? []
    : outingShortlist(await loadConciergeVenues("london"), occasion, area);
  const ask = `${outingAsk(occasion, area)}${day === "tomorrow" ? ", tomorrow" : day === "weekend" ? ", this weekend" : ", tonight"}`;
  const timing =
    day === "tomorrow"
      ? ", tomorrow"
      : day === "weekend"
        ? ", this weekend"
        : ", tonight";
  const browseHref = (id: string) =>
    `/outings?${new URLSearchParams({ occasion: id, ...(area ? { area } : {}), day })}`;
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
          <button type="submit">Find places</button>
        </form>
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
                  <li key={row.id}>
                    <OutCardBody row={row} />
                    <p>
                      {row.endsAt
                        ? `Published finish: ${new Date(row.endsAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`
                        : "Finish time not recorded."}
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
                href={`/plan?query=${encodeURIComponent(`Plan a pub crawl${area ? ` in ${area}` : " in London"}${timing}`)}`}
              >
                Plan the pub stops
              </Link>
              <p>
                Check your journey home for the time you expect to leave. Your
                destination stays with the journey planner.
              </p>
              <SafeNightStrip cityId="london" />
            </section>
          </>
        ) : (
          <>
            <p>
              Atmosphere is an editorial estimate based on the listed features
              below. Noise, seats and opening hours are not confirmed for your
              visit.
            </p>
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
            href={`/pal/chat?ask=${encodeURIComponent(ask)}`}
          >
            Ask for a closer fit
          </Link>
          {!eventsOccasion ? (
            <Link
              prefetch={false}
              href={`/plan?query=${encodeURIComponent(occasion === "crawl" || occasion === "friends" ? ask : `Plan a ${occasion === "gardens" ? "garden" : occasion === "date" ? "date-night" : "quiet"} pub route${area ? ` in ${area}` : " in London"}${timing}`)}`}
            >
              Make a plan
            </Link>
          ) : null}
        </div>
      </Screen>
    </main>
  );
}
