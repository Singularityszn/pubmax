import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/night/SafeNightStrip", () => ({
  default: () => null,
  SafeNightStrip: () => (
    <a href="https://tfl.gov.uk/plan-a-journey/">Journey planner</a>
  ),
}));
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: async () => [],
}));
vi.mock("@/lib/out/loadOut", () => ({
  buildOutResponse: async () => ({ events: [], listingsStatus: "ready" }),
}));
import OutingsPage from "@/app/outings/page";
describe("public outing browse", () => {
  it("shows seven choices and keeps area/day in refinement without chat first", async () => {
    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({
          occasion: "date",
          area: "Soho",
          day: "tomorrow",
        }),
      }),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("Dancing");
    expect(html).toContain("Gardens");
    expect(html).toContain(encodeURIComponent("in Soho, tomorrow"));
    expect(html).toContain("No matching pubs");
  });
  it("does not replace missing dance listings with pubs and offers a private home handoff", async () => {
    const html = renderToStaticMarkup(
      await OutingsPage({
        searchParams: Promise.resolve({ occasion: "dancing" }),
      }),
    );
    expect(html).toContain("No sourced dance nights");
    expect(html).toContain("https://tfl.gov.uk/plan-a-journey/");
  });
});
