"use client";

import { useMemo, type ComponentProps } from "react";
import MapVenueList from "@/components/map/MapVenueList";
import { buildMapVenueListModel, closedMapVenueListModel } from "@/lib/mapVenueList";
import { buildPhoneMapVenueListModel } from "@/lib/mapPhoneVenueList";

export default function MapVenueListLoader({ input, ...props }: Omit<ComponentProps<typeof MapVenueList>, "model"> & {
  input: Parameters<typeof buildMapVenueListModel>;
}) {
  const { open, phone } = props;
  const model = useMemo(() => !open ? closedMapVenueListModel(input[0].length)
    : phone ? buildPhoneMapVenueListModel(...input) : buildMapVenueListModel(...input), [input, open, phone]);
  return <MapVenueList {...props} model={model} />;
}
