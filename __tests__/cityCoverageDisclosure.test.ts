import { describe, expect, it } from "vitest";

import {
  cityCoverageDisclosure,
  cityCoverageItemList,
} from "@/lib/cityCoverageDisclosure";
import { listEnabledCities } from "@/lib/cities";

describe("city coverage disclosure", () => {
  it("names every London capability that is ready now", () => {
    expect(cityCoverageDisclosure("london")).toEqual({
      available: [
        "Listed pubs",
        "Dated Pint Prices",
        "Crawls",
        "Tonight",
        "Get home",
      ],
      needed: [],
    });
  });

  it("keeps an editorial city clear that Pint Prices are still needed", () => {
    expect(cityCoverageDisclosure("manchester")).toEqual({
      available: ["Listed pubs", "Crawls"],
      needed: ["Pint Prices"],
    });
  });

  it("keeps a map-only city clear that Pint Prices and crawls are still needed", () => {
    expect(cityCoverageDisclosure("bath")).toEqual({
      available: ["Listed pubs"],
      needed: ["Pint Prices", "Crawls"],
    });
  });
});

describe("city coverage ItemList", () => {
  it("publishes one canonical map entry for every enabled city", () => {
    const cities = listEnabledCities();
    const itemList = cityCoverageItemList(cities);

    expect(itemList).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "PUBMAXX city pub maps",
      numberOfItems: 10,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "London pub map",
          url: "https://pubmaxxing.com/map",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Manchester pub map",
          url: "https://pubmaxxing.com/map/manchester",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Liverpool pub map",
          url: "https://pubmaxxing.com/map/liverpool",
        },
        {
          "@type": "ListItem",
          position: 4,
          name: "Oxford pub map",
          url: "https://pubmaxxing.com/map/oxford",
        },
        {
          "@type": "ListItem",
          position: 5,
          name: "Durham pub map",
          url: "https://pubmaxxing.com/map/durham",
        },
        {
          "@type": "ListItem",
          position: 6,
          name: "Glasgow pub map",
          url: "https://pubmaxxing.com/map/glasgow",
        },
        {
          "@type": "ListItem",
          position: 7,
          name: "Bristol pub map",
          url: "https://pubmaxxing.com/map/bristol",
        },
        {
          "@type": "ListItem",
          position: 8,
          name: "Cambridge pub map",
          url: "https://pubmaxxing.com/map/cambridge",
        },
        {
          "@type": "ListItem",
          position: 9,
          name: "Bath pub map",
          url: "https://pubmaxxing.com/map/bath",
        },
        {
          "@type": "ListItem",
          position: 10,
          name: "Llandudno pub map",
          url: "https://pubmaxxing.com/map/llandudno",
        },
      ],
    });
  });
});
