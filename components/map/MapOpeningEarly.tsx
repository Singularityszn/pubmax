import type { CSSProperties } from "react";
import { MAP_OPENING_PREVIEW_CAMERA } from "@/lib/mapOpeningPreview";
import { PHONE_OPENING_OFFSET_Y } from "@/lib/phoneOpeningFrame";
import type { OpeningPricedVenue } from "@/lib/mapOpeningPricedVenues";
import type { openingPriceEvidence } from "@/lib/mapOpeningPriceEvidence";
import { venueMapUrl } from "@/lib/venueMapUrl";

type EarlyVenue = OpeningPricedVenue & NonNullable<ReturnType<typeof openingPriceEvidence>>;

const css = `
.mapEarly { display:none; position:fixed; inset:0; z-index:22; pointer-events:none; container-type:size; }
@media (max-width:440px) and (max-height:868px) and (orientation:portrait) {
  @supports selector(:popover-open) {
    html[data-map-preview="on"][data-map-ground="on"] .mapEarly { display:block; }
    html[data-map-preview="on"][data-map-ground="on"]:has(.mapEarly) .mapOpeningPreview { visibility:hidden; }
    html[data-map-preview="on"][data-map-ground="on"]:not([data-map-preview-discs="off"]):has(.mapEarly) .mapCanvasWrap { pointer-events:none; }
    html[data-map-preview="on"][data-map-ground="on"]:not([data-map-preview-discs="off"]):has(.mapEarly) .fairPintCard { max-height:calc(50dvh - 148px - env(safe-area-inset-bottom, 0px)); }
  }
}
html[data-map-preview-discs="off"] .mapEarly { display:none !important; }
.mapEarlyCamera { position:absolute; inset:0; perspective:150cqh; perspective-origin:50% calc(50% + var(--offset-y)); }
.mapEarlyPlane { position:absolute; left:50%; top:calc(50% + var(--offset-y)); width:0; height:0; transform:rotateX(var(--pitch)) rotateZ(calc(-1 * var(--map-preview-bearing, 0deg))); transform-style:preserve-3d; }
.mapEarlyButton { position:absolute; left:-32px; top:-32px; width:64px; height:64px; padding:0; border:0; border-radius:50%; background:transparent; color:var(--ink); pointer-events:auto; transform:translate3d(var(--x),var(--y),0) rotateZ(var(--map-preview-bearing, 0deg)) rotateX(calc(-1 * var(--pitch))); }
.mapEarlyFigure { display:grid; place-items:center; width:fit-content; min-width:44px; aspect-ratio:1; margin:auto; padding:4px; border:2px solid; border-radius:50%; background:var(--paper); font-size:12px; font-weight:700; }
.mapEarlyButton[data-aging="true"] .mapEarlyFigure { border-style:dashed; }
.mapEarlyButton:focus-visible { outline:3px solid var(--coral); outline-offset:0; }
.mapEarlyNote { position:absolute; left:12px; top:12px; padding:6px 10px; border-radius:8px; background:var(--paper); color:var(--ink); font-size:12px; }
.mapEarlyDetail { position:fixed; inset:auto 12px 90px; width:auto; max-width:440px; max-height:65vh; overflow:auto; margin:0 auto; box-sizing:border-box; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--paper); color:var(--ink); }
.mapEarlyDetail h2 { margin:0 0 8px; font-size:1.2rem; }
.mapEarlyDetail p { margin:8px 0; }
.mapEarlyDetail a { display:inline-flex; min-height:44px; align-items:center; color:var(--color-text); font-weight:600; text-decoration:underline; text-underline-offset:0.18em; }
`;

export default function MapOpeningEarly({ venues }: { venues: readonly EarlyVenue[] }) {
  if (!venues.length) return null;
  return (
    <>
      <style>{css}</style>
      <div className="mapEarly" aria-label="Priced pubs while the map loads" style={{ "--pitch": `${MAP_OPENING_PREVIEW_CAMERA.pitch}deg`, "--offset-y": `${PHONE_OPENING_OFFSET_Y}px` } as CSSProperties}>
        <div className="mapEarlyNote">More pubs are loading.</div>
        <div className="mapEarlyCamera"><div className="mapEarlyPlane">
          {venues.map((venue, index) => (
            <button
              key={venue.id}
              type="button"
              className="mapEarlyButton"
              data-venue-id={venue.id}
              data-aging={venue.aging}
              popoverTarget={`early-venue-${index}`}
              aria-label={`${venue.name}, ${venue.figure}. Show price details`}
              style={{ "--x": `${venue.x}px`, "--y": `${venue.y}px` } as CSSProperties}
            >
              <span className="mapEarlyFigure">{venue.figure}</span>
            </button>
          ))}
        </div></div>
      </div>
      {venues.map((venue, index) => (
        <div key={venue.id} id={`early-venue-${index}`} className="mapEarlyDetail" data-venue-id={venue.id} popover="auto" role="dialog" aria-labelledby={`early-venue-title-${index}`}>
          <h2 id={`early-venue-title-${index}`}>{venue.name}</h2>
          <p><strong>{venue.figure}</strong> · {venue.drink}</p>
          <p>Listed by {venue.source} · <time dateTime={venue.date}>{venue.date}</time></p>
          {venue.aging ? <p>{venue.ageNote}</p> : null}
          <a href={venueMapUrl(venue.id)}>Open full details</a>
        </div>
      ))}
    </>
  );
}
