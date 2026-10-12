// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PintPassport from "@/components/profile/PintPassport";
import { buildPassport } from "@/lib/passport";

function renderPassport(boroughs: string[]) {
  const data = buildPassport(boroughs.map((borough) => ({
    venueId: "venue-eltcmh", handle: "city_local", borough, priceGbp: 6.5,
  })));
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(
    <PintPassport handle="city_local" displayName="Local" data={data} />,
  );
  return element;
}

describe("Passport geography", () => {
  it("counts the City once and names it separately from boroughs", () => {
    const element = renderPassport(["City of London", "City of London"]);
    const stat = [...element.querySelectorAll(".passportStat")]
      .find((node) => node.querySelector(".passportStatLabel")?.textContent === "Boroughs + City");
    expect(stat?.querySelector(".passportStatValue")?.textContent).toBe("1");
    expect(element.querySelector(".passportBoroughs")?.textContent)
      .toBe("Boroughs + City crossed: City of London");
  });

  it("keeps the borough label for visits outside the City", () => {
    const element = renderPassport(["Camden"]);
    expect(element.querySelector(".passportBoroughs")?.textContent)
      .toBe("Boroughs crossed: Camden");
    expect(element.textContent).not.toContain("Boroughs + City");
  });
});
