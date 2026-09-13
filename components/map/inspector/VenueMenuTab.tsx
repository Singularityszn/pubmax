import { useMemo, useState } from "react";

import type { Venue } from "@/lib/venues";
import DrinkMenu from "@/components/drinks/DrinkMenu";
import FoodMenu from "@/components/food/FoodMenu";
import MenuCategoryGrid from "@/components/drinks/MenuCategoryGrid";
import VenueActionStrip from "@/components/map/VenueActionStrip";
import { venueMenuForInspector } from "@/lib/venueMenu";
import { venueFoodMenuForInspector } from "@/lib/venueFoodMenu";
import { venuePriceUpdatesOf } from "@/lib/venuePriceUpdates";
import { menuHubTiles } from "@/lib/menuHub";
import type { DrinkCategory } from "@/lib/drinks";
import type { TabKey } from "@/lib/venueInspectorTabs";
import type { PintDrop } from "@/lib/pintDropShared";
import { pintDropDrinksForMenu } from "@/lib/pintDropDrinks";

/** The Drinks tab prints menu and website links, never a booking CTA. */
const BOOKING_ONLY_ON_OVERVIEW = ["book"] as const;
const NO_PINT_DROPS: readonly PintDrop[] = [];

export default function VenueMenuTab({
  venue,
  tab,
  pintDrops = NO_PINT_DROPS,
  onAddDrink,
}: {
  venue: Venue;
  tab: TabKey;
  pintDrops?: readonly PintDrop[];
  onAddDrink?: () => void;
}) {
  // Observed price-update overlays, PER VENUE, off the detail the sheet already
  // fetched. `/api/venue/[id]` scopes both packs to this pub's own keys and
  // carries them beside `bundlePrices` (lib/venuePriceUpdates.ts).
  //
  // THE BROWSER READS THE ANSWER, NEVER THE DATASET. This tab used to fetch the
  // two national packs in full: measured cold on the audit's phone rig, opening
  // Drinks on `/map?sel=` spent 1862 KB of drink rows and 1519 KB of food rows
  // to draw a handful about one pub. A venue with no sourced row, and a venue
  // whose detail has not landed yet, both render the seed/app-dataset menu, the
  // same fail-soft the fetch had.
  // Memoised on the venue, because the reader answers a fresh pair each call and
  // the menus below are keyed on its identity.
  const { drink: drinkUpdates, food: foodUpdates } = useMemo(
    () => venuePriceUpdatesOf(venue),
    [venue],
  );

  // The Menu tab's full drink list (beer from venue.prices + seeded non-beer
  // drinks), plus public Pint Drops already loaded by the Venue sheet.
  const menuDrinks = useMemo(
    () => {
      const curated = venueMenuForInspector(venue, drinkUpdates);
      return [...curated, ...pintDropDrinksForMenu(pintDrops, curated)];
    },
    [venue, drinkUpdates, pintDrops],
  );
  const menuFood = useMemo(
    () => venueFoodMenuForInspector(venue, foodUpdates),
    [venue, foodUpdates],
  );
  const hubTiles = useMemo(() => menuHubTiles(venue, menuDrinks), [venue, menuDrinks]);
  // Reset when the venue changes so a drinks drill-in never leaks across venues.
  type MenuView =
    | { mode: "hub" }
    | { mode: "drinks"; category?: DrinkCategory };
  const [menuView, setMenuView] = useState<MenuView>({ mode: "hub" });
  const [menuViewVenueId, setMenuViewVenueId] = useState(venue.id);
  if (menuViewVenueId !== venue.id) {
    setMenuViewVenueId(venue.id);
    setMenuView({ mode: "hub" });
  }

  return (
    <div
      role="tabpanel"
      id="venuePanel-menu"
      aria-labelledby="venueTab-menu"
      className="venueTabPanel"
      hidden={tab !== "menu"}
    >
      {menuView.mode === "hub" ? (
        <>
          {/* Booking lives on Overview only (finding 2.16). */}
          <VenueActionStrip venue={venue} omitKinds={BOOKING_ONLY_ON_OVERVIEW} />
          <MenuCategoryGrid
            tiles={hubTiles}
            venueKind={venue.kind}
            onAddDrink={onAddDrink}
            onOpenDrinks={(category) =>
              setMenuView(
                category ? { mode: "drinks", category } : { mode: "drinks" },
              )
            }
          />
          <FoodMenu items={menuFood} venueName={venue.name} />
        </>
      ) : (
        <DrinkMenu
          drinks={menuDrinks}
          venueName={venue.name}
          venueId={venue.id}
          categoryFilter={menuView.category}
          onBack={() => setMenuView({ mode: "hub" })}
          backLabel="Menus"
        />
      )}
    </div>
  );
}
