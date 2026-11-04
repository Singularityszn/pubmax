import {
  Beer,
  BeerOff,
  Citrus,
  Coffee,
  CupSoda,
  GlassWater,
  Martini,
  Snowflake,
  TreePalm,
  Wheat,
  Wine,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { DrinkCategory } from "@/lib/drinks";

/**
 * The tap handle each drink lane wears in the desktop drink picker
 * (DrinkLaneTapHandles). A spirit has no glass of its own in the icon set, so
 * it wears what it is made from or what it is drunk with: malt for whisky, a
 * lime for gin, a palm for rum, ice for vodka. The handle's NAME is always the
 * lane's own label, so an icon is a hint and never the only word.
 */
const DRINK_LANE_ICONS: Record<DrinkCategory, LucideIcon> = {
  beer: Beer,
  wine: Wine,
  cocktail: Martini,
  "alcohol-free": BeerOff,
  "soft-drink": CupSoda,
  coffee: Coffee,
  whisky: Wheat,
  gin: Citrus,
  rum: TreePalm,
  vodka: Snowflake,
  shot: Zap,
  other: GlassWater,
};

export function drinkLaneIcon(category: DrinkCategory): LucideIcon {
  return DRINK_LANE_ICONS[category];
}
