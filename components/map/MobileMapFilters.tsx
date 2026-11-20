"use client";

import type { ComponentProps } from "react";
import MobilePriceChoices from "@/components/map/MobilePriceChoices";
import VenueFeatureFilters from "@/components/map/VenueFeatureFilters";

type Props = ComponentProps<typeof MobilePriceChoices> & {
  venueFeatures: ComponentProps<typeof VenueFeatureFilters>;
};

export default function MobileMapFilters({ venueFeatures, children, ...props }: Props) {
  return (
    <MobilePriceChoices {...props}>
      <VenueFeatureFilters {...venueFeatures} />
      {children}
    </MobilePriceChoices>
  );
}
