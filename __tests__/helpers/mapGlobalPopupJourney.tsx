import { useState, type ReactNode } from "react";

import CommandPaletteProvider, { useCommandPalette } from "@/components/command/CommandPaletteProvider";
import MapToolbar from "@/components/map/MapToolbar";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { SPOONS_VALUE_LENS_OFF } from "@/lib/spoonsValue";
import { initialFilters } from "@/lib/venues";
import { computeZonePintIndex } from "@/lib/zones";

const noop = () => undefined;

function PaletteState() {
  const { isOpen } = useCommandPalette();
  return <output aria-label="Command palette open">{String(isOpen)}</output>;
}

export function MapGlobalPopupJourney({ drawer, nav }: { drawer: boolean; nav?: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(drawer);
  useMapKeyboardShortcuts({
    mobileViewport: false,
    planningOpen: false,
    selectedVenueId: drawerOpen ? "selected-pub" : "",
    onBack: () => setDrawerOpen(false),
    onInterruptReveal: noop,
    logIntentFallbackVisible: false,
    dismissLogIntent: noop,
  });
  return (
    <CommandPaletteProvider>
      <PaletteState />
      <div className={drawerOpen ? "appShell detail-open" : "appShell"}>
        {nav}
        <MapToolbar
          query="Camden"
          onQueryChange={noop}
          searchContent={<input aria-label="Search pubs" value="Camden" readOnly />}
          favoritePint={null}
          onFavoritePintChange={noop}
          drinkFiltersActive
          drinkCategory="wine"
          drinkBrand=""
          onDrinkBrandChange={noop}
          onDrinkLaneChange={noop}
          drinkLaneStatus="ready"
          spoonsValueOn={false}
          spoonsValueLens={SPOONS_VALUE_LENS_OFF}
          onSpoonsValueChange={noop}
          personaId={null}
          onPersonaSelect={noop}
          personaTonightCategory={null}
          planningOpen={false}
          detailOpen={drawerOpen}
          desktopLaneActive
          onTogglePlanning={noop}
          filters={{ ...initialFilters, query: "Camden", drinkCategory: "wine" }}
          onFiltersChange={noop}
          searchSettled
          filteredVenueCount={10}
          searchableVenueCount={10}
          zoneIndex={computeZonePintIndex([])}
          experienceLens="all"
          experienceSummary=""
          onExperienceLensChange={noop}
        />
        {drawerOpen ? <aside className="mapDrawer right open">Selected pub</aside> : null}
      </div>
    </CommandPaletteProvider>
  );
}
