"use client";

import "leaflet/dist/leaflet.css";

import {
  BadgePoundSterling,
  Beer,
  MapPin,
  Route,
  Search,
  SlidersHorizontal,
  Trophy,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { LatLngExpression } from "leaflet";

import {
  buildCrawlRoute,
  crawlSummary,
  filterVenues,
  formatPrice,
  groupVenuePrices,
  priceColor,
  type CrawlStyle,
  type Filters,
  type Venue,
  type VenuePrice,
} from "@/lib/venues";

const LONDON_CENTER: LatLngExpression = [51.515, -0.118];

const styleLabels: Record<CrawlStyle, string> = {
  balanced: "Balanced",
  cheapest: "Cheapest",
  heritage: "Historic",
  beerGarden: "Beer Garden",
  sports: "Live Sports",
  dateNight: "Date Night",
};

const initialFilters: Filters = {
  query: "",
  maxPrice: 7,
  crawlStyle: "balanced",
  stopCount: 6,
  routeWindow: 20,
  requireBeerGarden: false,
  requireLiveSports: false,
  requireFood: false,
  requireCocktails: false,
  canonicalOnly: true,
};

function Amenity({ active, label }: { active: boolean; label: string }) {
  return <span className={active ? "amenity active" : "amenity"}>{label}</span>;
}

function VenuePopup({ venue }: { venue: Venue }) {
  const previewPrices = venue.prices.slice(0, 5);
  return (
    <div className="popup">
      <h3>{venue.name}</h3>
      <p>{venue.address}</p>
      <div className="popupPrice">
        <strong>{formatPrice(venue.cheapestPrice)}</strong>
        <span>{venue.cheapestPint}</span>
      </div>
      <div className="popupAmenities">
        <Amenity active={venue.amenities.beerGarden} label="garden" />
        <Amenity active={venue.amenities.liveSports} label="sports" />
        <Amenity active={venue.amenities.food} label="food" />
        <Amenity active={venue.amenities.cocktails} label="cocktails" />
      </div>
      <ul>
        {previewPrices.map((price) => (
          <li key={price.app_price_id}>
            {price.pint_name} <span>{formatPrice(price.price_gbp)}</span>
          </li>
        ))}
      </ul>
      {venue.dataQualityNotes.length > 0 ? (
        <small>{venue.dataQualityNotes.join(", ")}</small>
      ) : null}
    </div>
  );
}

export default function PubMap() {
  const [rows, setRows] = useState<VenuePrice[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");
  const [filters, setFilters] = useState<Filters>(initialFilters);

  useEffect(() => {
    fetch("/data/pint_prices_app_dataset.json")
      .then((response) => response.json())
      .then((data: VenuePrice[]) => setRows(data));
  }, []);

  const venues = useMemo(() => groupVenuePrices(rows), [rows]);
  const filteredVenues = useMemo(() => filterVenues(venues, filters), [venues, filters]);
  const route = useMemo(() => buildCrawlRoute(filteredVenues, filters), [filteredVenues, filters]);
  const summary = useMemo(() => crawlSummary(route), [route]);
  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? route[0],
    [route, selectedVenueId, venues],
  );

  const visibleMarkers = filteredVenues.slice(0, 650);
  const cheapCount = filteredVenues.filter(
    (venue) => venue.cheapestPrice !== null && venue.cheapestPrice <= 5.5,
  ).length;

  return (
    <main className="appShell">
      <aside className="controlRail">
        <div className="brandBlock">
          <div className="brandMark">
            <Beer size={22} />
          </div>
          <div>
            <p className="eyebrow">PubMaxing</p>
            <h1>Design the right London pub crawl.</h1>
          </div>
        </div>

        <label className="searchBox">
          <Search size={18} />
          <input
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Search Shoreditch, Hackney, pub name..."
          />
        </label>

        <section className="panelSection">
          <div className="sectionTitle">
            <SlidersHorizontal size={16} />
            <span>Crawl Style</span>
          </div>
          <div className="segmented">
            {(Object.keys(styleLabels) as CrawlStyle[]).map((style) => (
              <button
                key={style}
                className={filters.crawlStyle === style ? "selected" : ""}
                onClick={() => setFilters({ ...filters, crawlStyle: style })}
              >
                {styleLabels[style]}
              </button>
            ))}
          </div>
        </section>

        <section className="panelSection">
          <div className="rangeLine">
            <span>Max Pint</span>
            <strong>£{filters.maxPrice.toFixed(2)}</strong>
          </div>
          <input
            type="range"
            min="4"
            max="9"
            step="0.25"
            value={filters.maxPrice}
            onChange={(event) =>
              setFilters({ ...filters, maxPrice: Number(event.target.value) })
            }
          />
          <div className="rangeLine">
            <span>Stops</span>
            <strong>{filters.stopCount}</strong>
          </div>
          <input
            type="range"
            min="4"
            max="7"
            step="1"
            value={filters.stopCount}
            onChange={(event) =>
              setFilters({ ...filters, stopCount: Number(event.target.value) })
            }
          />
          <div className="rangeLine">
            <span>Route Window</span>
            <strong>{filters.routeWindow} min</strong>
          </div>
          <input
            type="range"
            min="15"
            max="30"
            step="5"
            value={filters.routeWindow}
            onChange={(event) =>
              setFilters({ ...filters, routeWindow: Number(event.target.value) })
            }
          />
        </section>

        <section className="panelSection toggles">
          <label>
            <input
              type="checkbox"
              checked={filters.requireBeerGarden}
              onChange={(event) =>
                setFilters({ ...filters, requireBeerGarden: event.target.checked })
              }
            />
            Beer garden
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireLiveSports}
              onChange={(event) =>
                setFilters({ ...filters, requireLiveSports: event.target.checked })
              }
            />
            Live sports
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireFood}
              onChange={(event) => setFilters({ ...filters, requireFood: event.target.checked })}
            />
            Food
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireCocktails}
              onChange={(event) =>
                setFilters({ ...filters, requireCocktails: event.target.checked })
              }
            />
            Cocktails
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.canonicalOnly}
              onChange={(event) =>
                setFilters({ ...filters, canonicalOnly: event.target.checked })
              }
            />
            Clean borough rows
          </label>
        </section>

        <section className="statsGrid">
          <div>
            <span>Matched</span>
            <strong>{filteredVenues.length}</strong>
          </div>
          <div>
            <span>≤ £5.50</span>
            <strong>{cheapCount}</strong>
          </div>
        </section>
      </aside>

      <section className="mapStage">
        <MapContainer
          center={LONDON_CENTER}
          zoom={12}
          minZoom={10}
          maxZoom={18}
          scrollWheelZoom
          className="leafletMap"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          {visibleMarkers.map((venue) => (
            <CircleMarker
              key={venue.id}
              center={[venue.latitude, venue.longitude]}
              radius={route.some((stop) => stop.id === venue.id) ? 9 : 6}
              pathOptions={{
                color: "#ffffff",
                weight: route.some((stop) => stop.id === venue.id) ? 3 : 1,
                fillColor: priceColor(venue.cheapestPrice),
                fillOpacity: 0.88,
              }}
              eventHandlers={{
                click: () => setSelectedVenueId(venue.id),
              }}
            >
              <Popup>
                <VenuePopup venue={venue} />
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>

        <div className="mapLegend">
          <span>
            <i className="green" /> ≤ £5.50
          </span>
          <span>
            <i className="amber" /> £5.50-£7
          </span>
          <span>
            <i className="red" /> £7+
          </span>
        </div>
      </section>

      <aside className="routePanel">
        <div className="routeHeader">
          <div>
            <p className="eyebrow">Suggested Crawl</p>
            <h2>{styleLabels[filters.crawlStyle]} route</h2>
          </div>
          <Route size={24} />
        </div>

        <div className="routeMetrics">
          <div>
            <BadgePoundSterling size={17} />
            <span>{formatPrice(summary.total)}</span>
            <small>estimated round</small>
          </div>
          <div>
            <MapPin size={17} />
            <span>{summary.distance.toFixed(1)} km</span>
            <small>between stops</small>
          </div>
          <div>
            <Trophy size={17} />
            <span>{route.length}</span>
            <small>stops</small>
          </div>
        </div>

        <ol className="routeList">
          {route.map((venue, index) => (
            <li
              key={venue.id}
              className={selectedVenue?.id === venue.id ? "active" : ""}
              onClick={() => setSelectedVenueId(venue.id)}
            >
              <span className="stopNumber">{index + 1}</span>
              <div>
                <strong>{venue.name}</strong>
                <p>
                  {formatPrice(venue.cheapestPrice)} · {venue.cheapestPint}
                </p>
                <small>{venue.primaryBorough || venue.visibleBoroughs[0] || "London"}</small>
              </div>
            </li>
          ))}
        </ol>

        {selectedVenue ? (
          <section className="venueInspector">
            <div className="inspectorTitle">
              <Waves size={17} />
              <span>Venue Detail</span>
            </div>
            <h3>{selectedVenue.name}</h3>
            <p>{selectedVenue.address}</p>
            <div className="amenityRow">
              <Amenity active={selectedVenue.amenities.beerGarden} label="garden" />
              <Amenity active={selectedVenue.amenities.liveSports} label="sports" />
              <Amenity active={selectedVenue.amenities.food} label="food" />
              <Amenity active={selectedVenue.amenities.cocktails} label="cocktails" />
              <Amenity active={selectedVenue.amenities.pubQuiz} label="quiz" />
            </div>
            {selectedVenue.description ? (
              <p className="description">{selectedVenue.description}</p>
            ) : (
              <p className="description muted">
                No heritage note yet. This is where visit reports and venue research will add
                character.
              </p>
            )}
            <div className="priceList">
              {selectedVenue.prices.slice(0, 6).map((price) => (
                <div key={price.app_price_id}>
                  <span>{price.pint_name}</span>
                  <strong>{formatPrice(price.price_gbp)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </main>
  );
}
