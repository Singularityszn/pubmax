"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type * as maplibregl from "maplibre-gl";

import PriceBadge from "@/components/PriceBadge";
import type { VenueSignal } from "@/components/map/canvas/types";
import { PEEK_AGING_SUFFIX } from "@/components/map/VenuePeekPintPrice";
import {
  drinkLensCoverageNote,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import {
  MAP_SPLIT_LIST_DEBOUNCE_MS,
  MAP_SPLIT_LIST_PAGE_SIZE,
  buildMapSplitListGroups,
  mapSplitListFacts,
  mapSplitListMembershipKey,
  mapSplitListVenues,
  pageMapSplitListGroups,
  type MapSplitListRow,
  type MapSplitListSort,
} from "@/lib/mapSplitList";
import { MAP_SPLIT_LIST_ID } from "@/lib/mapSplitListFocus";
import type {
  LondonRestaurantListModel,
  UkBasePubListModel,
} from "@/lib/mapVenueList";
import { priceBand, priceBandAreaForVenue, priceBandClass } from "@/lib/priceBand";
import type { UkBasePub, UkBaseStreamStatus } from "@/lib/ukBasePubs";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { FOCUS_TRAP_EXEMPT_ATTRIBUTE } from "@/lib/useFocusTrap";
import type { Venue } from "@/lib/venues";

import "./mapSplitList.css";

type Point = { lng: number; lat: number };

/** The slice of the live MapLibre map the halo needs, so a test can hand in its own. */
export type MapSplitListMap = Pick<maplibregl.Map, "getContainer" | "project" | "on" | "off">;

/** What the list held when "Search as I move the map" was switched off. */
type HeldView = {
  key: string;
  venueIds: ReadonlySet<string>;
  basePubs: UkBasePubListModel["rows"];
  restaurants: LondonRestaurantListModel["rows"];
  viewportCenter: [number, number] | null;
};

type LiveView = {
  venues: readonly Venue[];
  basePubs: UkBasePubListModel["rows"];
  restaurants: LondonRestaurantListModel["rows"];
  viewportCenter: [number, number] | null;
};

function liveViewKey(view: LiveView): string {
  return mapSplitListMembershipKey({
    venueIds: view.venues.map((venue) => venue.id),
    basePubIds: view.basePubs.map((row) => row.id),
    restaurantIds: view.restaurants.map((row) => row.id),
  });
}

/**
 * The ring that marks a row's pin on the map while the reader points at the
 * row or moves the keyboard onto it. A DOM mark over the canvas, placed through
 * the map's own projection and moved with the camera; it paints nothing into
 * the map's style, so the pin and basemap styling stay the canvas's own. Held
 * in a ref rather than state, so pointing at a row repaints nothing in React.
 */
function usePinHalo(map: MapSplitListMap | null) {
  const haloRef = useRef<{ point: Point | null; place: () => void } | null>(null);
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    const element = container.ownerDocument.createElement("div");
    element.className = "mapSplitListHalo";
    element.setAttribute("aria-hidden", "true");
    element.hidden = true;
    container.appendChild(element);
    const halo = {
      point: null as Point | null,
      place: () => {
        const point = halo.point;
        if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
          element.hidden = true;
          return;
        }
        let projected: { x: number; y: number };
        try {
          projected = map.project([point.lng, point.lat]);
        } catch {
          element.hidden = true;
          return;
        }
        element.hidden = false;
        element.style.transform = `translate(${projected.x}px, ${projected.y}px)`;
      },
    };
    map.on("move", halo.place);
    haloRef.current = halo;
    return () => {
      map.off("move", halo.place);
      element.remove();
      haloRef.current = null;
    };
  }, [map]);
  const show = useCallback((point: Point) => {
    const halo = haloRef.current;
    if (!halo) return;
    halo.point = point;
    halo.place();
  }, []);
  const hide = useCallback(() => {
    const halo = haloRef.current;
    if (!halo) return;
    halo.point = null;
    halo.place();
  }, []);
  return useMemo(() => ({ show, hide }), [hide, show]);
}

function RowPrice({ row }: { row: MapSplitListRow }) {
  const price = row.price;
  if (!price?.figure) return null;
  const band = priceBand(price.bandGbp, priceBandAreaForVenue(row.id));
  return price.observed ? (
    <PriceBadge band={band} className={price.aging ? "priceBadge--aging" : undefined}>
      {price.figure}
    </PriceBadge>
  ) : (
    <strong className={priceBandClass(band) || undefined}>{price.figure}</strong>
  );
}

function rowTrustLine(row: MapSplitListRow): string {
  if (!row.price) return row.unpricedLabel ?? "";
  const { caption, day, aging } = row.price;
  return `${caption}${day ? ` · ${day}` : ""}${aging ? PEEK_AGING_SUFFIX : ""}`;
}

const GROUP_TITLES = {
  venue: "Listed pubs and venues",
  base: "Other pubs and bars · no listed price",
  restaurant: "Restaurants · no listed price",
} as const;

/**
 * THE LIST BESIDE THE MAP. From 1024px, Explore lists the venues in the
 * current map view in a column on the left while the map fills the right, and
 * the two move together: the column re-reads the view when the camera settles
 * (debounced), a row the reader points at rings its pin, and a click opens the
 * venue sheet through the same handler a pin tap uses.
 *
 * It is also the keyboard and screen-reader parallel to the canvas pins at
 * these widths (WCAG 2.1.1), the job List view does below 1024px: every venue
 * in view is a real button, the rows are one tab stop moved with the arrow
 * keys, and the Layers "List view" action hands focus here. It is an exempt
 * surface of the venue drawer's focus trap, so another pub can be opened while
 * one is open (components/AGENTS.md, the exempt-surface rule).
 */
export default function MapSplitList({
  cityName,
  visibleVenues,
  filteredVenues,
  ukBaseModel,
  restaurantModel,
  ukBaseStatus = "ready",
  dropSignals,
  lensPrices = null,
  lensNoun = null,
  lensStatus = "ready",
  viewportCenter,
  reader,
  loaded,
  map,
  onSelectVenue,
  onSelectUkBasePub,
  onPrefetchVenue,
}: {
  cityName: string;
  /** The curated venues the map projects inside the view, through every map filter. */
  visibleVenues: readonly Venue[];
  /** Every curated venue through the map filters, in view or not (for a held view). */
  filteredVenues: readonly Venue[];
  ukBaseModel: UkBasePubListModel;
  restaurantModel: LondonRestaurantListModel;
  ukBaseStatus?: UkBaseStreamStatus;
  /** The UNMERGED Pint Drop signal the venue sheet reads. */
  dropSignals: ReadonlyMap<string, VenueSignal>;
  lensPrices?: ReadonlyMap<string, MapLensPrice> | null;
  lensNoun?: string | null;
  lensStatus?: CategoryPriceIndexStatus;
  viewportCenter: [number, number] | null;
  reader: Point | null;
  /** The venue index and the view's projection have both landed for this city. */
  loaded: boolean;
  /** The live map, for the halo; null until the canvas hands it over. */
  map: MapSplitListMap | null;
  onSelectVenue: (id: string) => void;
  onSelectUkBasePub: (pub: UkBasePub) => void;
  onPrefetchVenue: (id: string) => void;
}) {
  const [sort, setSort] = useState<MapSplitListSort>("cheapest");
  const [followMap, setFollowMap] = useState(true);
  const [held, setHeld] = useState<HeldView | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const halo = usePinHalo(map);
  const pointedIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusAfterMoreRef = useRef<number | null>(null);

  // The view, as it stood once the camera stopped settling. A pan can settle
  // several times in a row, and the list re-reads once.
  const live = useMemo<LiveView>(
    () => ({
      venues: visibleVenues,
      basePubs: ukBaseModel.rows,
      restaurants: restaurantModel.rows,
      viewportCenter,
    }),
    [restaurantModel.rows, ukBaseModel.rows, viewportCenter, visibleVenues],
  );
  const settled = useDebouncedValue(live, MAP_SPLIT_LIST_DEBOUNCE_MS);
  const settledKey = useMemo(() => liveViewKey(settled), [settled]);
  const liveKey = useMemo(() => liveViewKey(live), [live]);
  const holdView = useCallback(
    (view: LiveView, key: string): HeldView => ({
      key,
      venueIds: new Set(view.venues.map((venue) => venue.id)),
      basePubs: view.basePubs,
      restaurants: view.restaurants,
      viewportCenter: view.viewportCenter,
    }),
    [],
  );

  // While "Search as I move the map" is off, the list keeps the view it last
  // searched; the live filters still apply to it.
  const shownView: HeldView | null = followMap ? null : held;
  const venues = useMemo(
    () =>
      mapSplitListVenues({
        followMap: shownView === null,
        visible: settled.venues,
        filtered: filteredVenues,
        heldIds: shownView?.venueIds ?? null,
      }),
    [filteredVenues, settled.venues, shownView],
  );
  const groups = useMemo(
    () =>
      buildMapSplitListGroups({
        venues,
        basePubs: shownView?.basePubs ?? settled.basePubs,
        restaurants: shownView?.restaurants ?? settled.restaurants,
        dropSignals,
        lensPrices,
        lensNoun,
        lensStatus,
        viewportCenter: shownView ? shownView.viewportCenter : settled.viewportCenter,
        reader,
        sort,
      }),
    [dropSignals, lensNoun, lensPrices, lensStatus, reader, settled, shownView, sort, venues],
  );

  // A new view starts at its first page again.
  const listKey = shownView?.key ?? settledKey;
  const [limit, setLimit] = useState(MAP_SPLIT_LIST_PAGE_SIZE);
  const [limitKey, setLimitKey] = useState(listKey);
  if (limitKey !== listKey) {
    setLimitKey(listKey);
    setLimit(MAP_SPLIT_LIST_PAGE_SIZE);
  }
  const paged = useMemo(() => pageMapSplitListGroups(groups, limit), [groups, limit]);
  const shownRows = useMemo(
    () => [...paged.venues, ...paged.basePubs, ...paged.restaurants],
    [paged],
  );
  // The facts are read for the rows drawn, never for the whole view.
  const factsById = useMemo(
    () => new Map(shownRows.map((row) => [row.id, row.venue ? mapSplitListFacts(row.venue) : []])),
    [shownRows],
  );
  // ONE tab stop for the rows: the row last moved to, else the first.
  const tabStopId = shownRows.some((row) => row.id === activeId)
    ? activeId
    : (shownRows[0]?.id ?? null);

  // A row that left the list takes its halo with it.
  useEffect(() => {
    const pointed = pointedIdRef.current;
    if (pointed && !shownRows.some((row) => row.id === pointed)) {
      pointedIdRef.current = null;
      halo.hide();
    }
  }, [halo, shownRows]);

  // "Show more" hands focus to the first row it revealed.
  useEffect(() => {
    const index = focusAfterMoreRef.current;
    if (index === null) return;
    focusAfterMoreRef.current = null;
    const rows = scrollRef.current?.querySelectorAll<HTMLElement>("[data-split-row]");
    rows?.[index]?.focus();
  }, [paged.shown]);

  const point = useCallback(
    (row: MapSplitListRow) => {
      pointedIdRef.current = row.id;
      halo.show({ lng: row.lng, lat: row.lat });
    },
    [halo],
  );
  const unpoint = useCallback(
    (row: MapSplitListRow) => {
      if (pointedIdRef.current !== row.id) return;
      pointedIdRef.current = null;
      halo.hide();
    },
    [halo],
  );
  const open = useCallback(
    (row: MapSplitListRow) => {
      if (row.group === "base" && row.basePub) {
        onSelectUkBasePub(row.basePub);
        return;
      }
      onSelectVenue(row.id);
    },
    [onSelectUkBasePub, onSelectVenue],
  );

  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-split-row]") ?? [],
    );
    const index = rows.indexOf(event.target as HTMLElement);
    if (index === -1 || rows.length === 0) return;
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? Math.min(index + 1, rows.length - 1)
        : event.key === "ArrowUp"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : rows.length - 1;
    rows[next]?.focus();
  };

  const toggleFollow = (next: boolean) => {
    setFollowMap(next);
    setHeld(next ? null : holdView(settled, settledKey));
  };
  const searchThisView = () => setHeld(holdView(live, liveKey));
  const heldIsStale = shownView !== null && shownView.key !== liveKey;

  const total = groups.total;
  const awaiting = total === 0 && ukBaseStatus !== "unavailable" && (ukBaseStatus === "loading" || !loaded);
  const order = sort === "cheapest" ? "cheapest first" : reader ? "nearest you first" : "nearest first";
  const status = awaiting
    ? "Counting them up…"
    : total === 0
      ? ukBaseStatus === "unavailable"
        ? "Unlisted pubs unavailable"
        : "Nothing in view"
      : `${total} ${total === 1 ? "place" : "places"}${shownView ? " from your last search" : ""}, ${order}`;
  const coverageNote =
    lensPrices !== null ? drinkLensCoverageNote(lensNoun?.toLowerCase() ?? "this view", lensStatus) : null;

  const renderGroup = (group: MapSplitListRow["group"], rows: MapSplitListRow[]) =>
    rows.length === 0 ? null : (
      <section className="mapSplitListGroup" aria-label={GROUP_TITLES[group]} key={group}>
        <h3 className="mapSplitListGroupTitle">{GROUP_TITLES[group]}</h3>
        <ul className="mapSplitListRows" aria-label={GROUP_TITLES[group]}>
          {rows.map((row) => {
            const facts = factsById.get(row.id) ?? [];
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className="mapSplitListRow"
                  data-split-row=""
                  data-venue-id={row.id}
                  tabIndex={row.id === tabStopId ? 0 : -1}
                  onClick={() => open(row)}
                  onPointerEnter={() => {
                    point(row);
                    // Base pubs have no venue record, so there is nothing to warm.
                    if (row.group !== "base") onPrefetchVenue(row.id);
                  }}
                  onPointerLeave={() => unpoint(row)}
                  onFocus={() => {
                    setActiveId(row.id);
                    point(row);
                    if (row.group !== "base") onPrefetchVenue(row.id);
                  }}
                  onBlur={() => unpoint(row)}
                >
                  <span className="mapSplitListRowMain">
                    <span className="mapSplitListRowName">{row.name}</span>
                    {facts.length > 0 ? (
                      <span className="mapSplitListRowFacts">{facts.join(" · ")}</span>
                    ) : null}
                  </span>
                  <span className="mapSplitListRowAside">
                    <RowPrice row={row} />
                    {row.walkMinutes !== null ? (
                      <span className="mapSplitListRowWalk">{row.walkMinutes} min walk</span>
                    ) : null}
                  </span>
                  <span className="mapSplitListRowTrust">{rowTrustLine(row)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );

  return (
    <section
      id={MAP_SPLIT_LIST_ID}
      className="mapSplitList"
      aria-label={`${cityName} pubs in this view`}
      tabIndex={-1}
      {...{ [FOCUS_TRAP_EXEMPT_ATTRIBUTE]: "" }}
    >
      <header className="mapSplitListHead">
        <div className="mapSplitListHeadline">
          <h2 className="mapSplitListTitle">Pubs in this view</h2>
          <p className="mapSplitListCount" role="status" aria-live="polite">{status}</p>
        </div>
        <div className="mapSplitListControls">
          <div className="mapSplitListSort" role="group" aria-label="Sort the list">
            <button
              type="button"
              className="mapSplitListSortChip"
              aria-pressed={sort === "cheapest"}
              onClick={() => setSort("cheapest")}
            >
              Cheapest
            </button>
            <button
              type="button"
              className="mapSplitListSortChip"
              aria-pressed={sort === "nearest"}
              onClick={() => setSort("nearest")}
            >
              Nearest
            </button>
          </div>
          <label className="mapSplitListFollow">
            <input
              type="checkbox"
              checked={followMap}
              onChange={(event) => toggleFollow(event.currentTarget.checked)}
            />
            <span>Search as I move the map</span>
          </label>
        </div>
        {heldIsStale ? (
          <button type="button" className="mapSplitListSearchHere" onClick={searchThisView}>
            Show pubs in this view
          </button>
        ) : null}
        {coverageNote ? (
          <p className="mapSplitListNote" role="status">{coverageNote}</p>
        ) : null}
      </header>

      <div className="mapSplitListScroll" ref={scrollRef} onKeyDown={onRowsKeyDown}>
        {total === 0 ? (
          awaiting ? null : (
            <p className="mapSplitListEmpty">
              {ukBaseStatus === "unavailable"
                ? "Unlisted pubs could not load. Try the map again."
                : "Nothing in view fits that, which takes some doing round here. Move the map, push the price cap up or drop a filter and the pubs come back."}
            </p>
          )
        ) : (
          <>
            <p className="sr-only">Use the up and down arrow keys to move between places.</p>
            {renderGroup("venue", paged.venues)}
            {renderGroup("base", paged.basePubs)}
            {renderGroup("restaurant", paged.restaurants)}
            {paged.more > 0 ? (
              <button
                type="button"
                className="mapSplitListMore"
                onClick={() => {
                  focusAfterMoreRef.current = paged.shown;
                  setLimit((current) => current + MAP_SPLIT_LIST_PAGE_SIZE);
                }}
              >
                Show {Math.min(MAP_SPLIT_LIST_PAGE_SIZE, paged.more)} more
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
