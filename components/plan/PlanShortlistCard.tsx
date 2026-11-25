import { PintPriceBadge } from "@/components/PriceBadge";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import type { ShortlistOption, ShortlistView } from "@/lib/planShortlist";
import { venueDirectionsUrl } from "@/lib/venueJourney";

const londonMeetingTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});

export function ShortlistPrice({ option }: { option: ShortlistOption }) {
  const price = option.listedPint;
  if (!price) return <p>No current listed pint price</p>;
  return (
    <div>
      <PintPriceBadge priceGbp={price.priceGbp} venueId={option.venueId} /> {price.pintName}
      <ListedPriceSource evidence={price} />
    </div>
  );
}

export function ConfirmedShortlist({ view }: { view: ShortlistView }) {
  const confirmed = view.confirmed;
  const option = view.options.find((entry) => entry.venueId === confirmed?.venueId);
  if (!confirmed || !option) return null;
  return (
    <div className="planShortlist__option">
      <h2>{option.venueName}</h2>
      <p><time dateTime={confirmed.startTime}>{londonMeetingTime.format(new Date(confirmed.startTime))}</time> London time</p>
      <a href={venueDirectionsUrl(option, null, { mode: "walking" })} target="_blank" rel="noopener noreferrer">
        Open directions
      </a>
    </div>
  );
}
