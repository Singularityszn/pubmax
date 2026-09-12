import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  enabled: false,
  rivalry: vi.fn(async () => [{ city: "London" }]),
  heritage: vi.fn(async () => [{ id: "crawl-1" }]),
  editorialCards: vi.fn(() => [{ id: "editorial" }]),
  heritageCards: vi.fn(() => [{ id: "heritage" }]),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/trustedHandoffFlags.server", () => ({
  readTrustedHandoffFlag: () => reads.enabled,
}));

vi.mock("@/lib/cityRivalry", () => ({
  buildCityRivalrySnapshot: reads.rivalry,
}));

vi.mock("@/lib/heritageCrawls", () => ({
  loadHeritageCrawls: reads.heritage,
}));

vi.mock("@/app/discover/editorial.server", () => ({
  buildDiscoverEditorial: reads.editorialCards,
  buildDiscoverHeritageCards: reads.heritageCards,
}));

vi.mock("@/app/social/SocialPageClient", () => ({
  default: ({ rivalry, editorialCards, heritageCards }: { rivalry: unknown[]; editorialCards: unknown[]; heritageCards: unknown[] }) =>
    createElement("output", null, JSON.stringify({ rivalry, editorialCards, heritageCards })),
}));

import SocialPage from "@/app/social/page";

describe("Social server rollback boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.enabled = false;
  });

  it("does not load discover data when rollback is active", async () => {
    const element = await SocialPage({
      searchParams: Promise.resolve({ tab: "discover" }),
    });
    const html = renderToStaticMarkup(element);

    expect(reads.rivalry).not.toHaveBeenCalled();
    expect(reads.heritage).not.toHaveBeenCalled();
    expect(reads.editorialCards).not.toHaveBeenCalled();
    expect(reads.heritageCards).not.toHaveBeenCalled();
    expect(html).toContain("{&quot;rivalry&quot;:[],&quot;editorialCards&quot;:[],&quot;heritageCards&quot;:[]}");
  });

  it("keeps plain Social free of Discover data when the feature is enabled", async () => {
    reads.enabled = true;
    await SocialPage({ searchParams: Promise.resolve({}) });
    expect(reads.rivalry).not.toHaveBeenCalled();
    expect(reads.heritage).not.toHaveBeenCalled();
    expect(reads.editorialCards).not.toHaveBeenCalled();
    expect(reads.heritageCards).not.toHaveBeenCalled();
  });

  it("resolves cards on the server for the enabled Discover tab", async () => {
    reads.enabled = true;
    const element = await SocialPage({ searchParams: Promise.resolve({ tab: "discover" }) });
    expect(reads.rivalry).toHaveBeenCalledOnce();
    expect(reads.heritage).toHaveBeenCalledOnce();
    expect(reads.editorialCards).toHaveBeenCalledOnce();
    expect(reads.heritageCards).toHaveBeenCalledWith([{ id: "crawl-1" }]);
    const html = renderToStaticMarkup(element);
    expect(html).toContain("editorial");
    expect(html).toContain("heritage");
  });
});
