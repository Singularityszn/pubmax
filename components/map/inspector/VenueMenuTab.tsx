import { useMemo, useState } from "react";

import type { Venue } from "@/lib/venues";
import DrinkMenu from "@/components/drinks/DrinkMenu";
import FoodMenu from "@/components/food/FoodMenu";
import MenuCategoryGrid from "@/components/drinks/MenuCategoryGrid";
import VenueActionStrip from "@/components/map/VenueActionStrip";
import { venueMenuForInspector } from "@/lib/venueMenu";
import { venueFoodMenuForInspector } from "@/lib/venueFoodMenu";
import { menuHubTiles } from "@/lib/menuHub";
import type { DrinkCategory } from "@/lib/drinks";
import type { TabKey } from "@/lib/venueInspectorTabs";

export default function VenueMenuTab({ venue, tab }: { venue: Venue; tab: TabKey }) {
  // The Menu tab's full drink list (beer from venue.prices + seeded non-beer
  // drinks) — see lib/venueMenu.ts for the composition seam.
  const menuDrinks = useMemo(() => venueMenuForInspector(venue), [venue]);
  const menuFood = useMemo(() => venueFoodMenuForInspector(venue), [venue]);
  const hubTiles = useMemo(() => menuHubTiles(venue, menuDrinks), [venue, menuDrinks]);
  // Menu hub → drinks deep-dive (Greene King–style Menus grid, alcohol-first).
  // Reset when the venue changes so a drill-in never leaks across pubs.
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
          <VenueActionStrip venue={venue} />
          <MenuCategoryGrid
            tiles={hubTiles}
            venueName={venue.name}
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
