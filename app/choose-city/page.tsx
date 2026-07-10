import type { Metadata } from "next";

import CityChooser from "@/components/city/CityChooser";

export const metadata: Metadata = {
  title: "Choose your city",
  description:
    "Pick a PUBMAXXING city map — London, Manchester, Glasgow, and more. Price-aware pubs, crawls, and last rides.",
};

export default function ChooseCityPage() {
  return <CityChooser variant="page" />;
}
