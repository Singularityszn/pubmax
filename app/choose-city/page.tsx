import type { Metadata } from "next";

import CityChooser from "@/components/city/CityChooser";

export const metadata: Metadata = {
  title: "Choose your city",
  description:
    "Pick your PUBMAXXING city map: London, Manchester, Glasgow, and more. Listed pint prices, crawls, and the last way home.",
  alternates: { canonical: "/choose-city" },
};

export default function ChooseCityPage() {
  return <CityChooser variant="page" />;
}
