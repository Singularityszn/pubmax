"use client";

import type { ComponentProps } from "react";
import type { fairPence } from "@/lib/fairPintPricing";
import PubMap from "@/components/PubMap";
import { FairPintHost } from "./FairPintHost";

export default function FairPintMap({ priceReader, ...props }: ComponentProps<typeof PubMap> & { priceReader: typeof fairPence }) {
  return <FairPintHost priceReader={priceReader} cityId={props.cityId ?? "london"}><PubMap {...props} /></FairPintHost>;
}
