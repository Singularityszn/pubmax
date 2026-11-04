"use client";

import { drinkLaneIcon } from "@/components/map/drinkLaneIcons";
import { Dock, DockIcon, DockItem, DockLabel } from "@/components/ui/dock";
import { MAP_DRINK_LANES } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";

/**
 * The drink lanes as a row of bar taps, for a desktop pointer.
 *
 * Each lane is a round tap handle on the Dock (components/ui/dock.tsx): the
 * handles swell under the pointer like a hand running along the bar, and the
 * one the map is under is TIPPED, its glass leaning as if mid-pour, with a
 * line poured under it. Selection reads in ink, never coral: coral is spent on
 * the plan door and the create disc, and a drink chooser is neither.
 *
 * It keeps the picker's contract with the chips it stands in for: one group
 * named "Drink prices shown on the map", eleven `.drinkLanePickerOption`
 * buttons on one row, each named by its lane's own label and pressed when it
 * is the lane. DrinkLanePicker loads this file only for a fine pointer with
 * room for the row, so framer-motion never rides the map's first load.
 */
export default function DrinkLaneTapHandles({
  lane,
  onChange,
}: {
  lane: DrinkCategory;
  onChange: (lane: DrinkCategory) => void;
}) {
  return (
    <Dock
      role="group"
      aria-label="Drink prices shown on the map"
      // The panel reads from the left edge, so the bar of taps starts there too.
      className="drinkTapRail mx-0"
      magnification={64}
      distance={120}
      panelHeight={64}
    >
      {MAP_DRINK_LANES.map((option) => {
        const selected = option.category === lane;
        const Icon = drinkLaneIcon(option.category);
        return (
          <DockItem key={option.category} className="drinkTapItem">
            <DockLabel visible={selected}>{option.label}</DockLabel>
            <button
              type="button"
              className={
                selected
                  ? "drinkLanePickerOption drinkTapHandle isSelected"
                  : "drinkLanePickerOption drinkTapHandle"
              }
              aria-pressed={selected}
              aria-label={option.label}
              onClick={() => onChange(option.category)}
            >
              <span className="drinkTapLever">
                <DockIcon>
                  <Icon className="drinkTapIcon" />
                </DockIcon>
              </span>
            </button>
            <span className="drinkTapPour" aria-hidden="true" />
          </DockItem>
        );
      })}
    </Dock>
  );
}
