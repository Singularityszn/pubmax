import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  rivalry: vi.fn(async () => [{ city: "London" }]),
  heritage: vi.fn(async () => [{ id: "crawl-1" }]),
  launch: false,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/trustedHandoffFlags.server", () => ({
  readTrustedHandoffFlag: () => reads.launch,
}));

vi.mock("@/lib/cityRivalry", () => ({
  buildCityRivalrySnapshot: reads.rivalry,
}));

vi.mock("@/lib/heritageCrawls", () => ({
  loadHeritageCrawls: reads.heritage,
}));

vi.mock("@/app/social/SocialPageClient", () => ({
  default: ({ rivalry, heritageCrawls, londonLaneOpen }: { rivalry: unknown[]; heritageCrawls: unknown[]; londonLaneOpen?: boolean }) =>
    createElement("output", null, JSON.stringify({ rivalry, heritageCrawls, londonLaneOpen })),
}));

import SocialPage from "@/app/social/page";

afterEach(() => {
  reads.launch = false;
  vi.unstubAllEnvs();
});

async function renderPage(search: Record<string, string> = {}): Promise<string> {
  const element = await SocialPage({ searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(element);
}

describe("Social server rollback boundary", () => {
  it("does not load discover data when rollback is active", async () => {
    const html = await renderPage({ tab: "discover" });

    expect(reads.rivalry).not.toHaveBeenCalled();
    expect(reads.heritage).not.toHaveBeenCalled();
    expect(html).toContain("{&quot;rivalry&quot;:[],&quot;heritageCrawls&quot;:[],&quot;londonLaneOpen&quot;:false}");
  });

  it("opens the signed-out London lane only while Social is live and not frozen", async () => {
    expect(await renderPage(), "rollback closes the lane").toContain("&quot;londonLaneOpen&quot;:false");

    reads.launch = true;
    expect(await renderPage(), "live Social opens it").toContain("&quot;londonLaneOpen&quot;:true");

    vi.stubEnv("PUBMAX_SOCIAL_FREEZE", "social");
    expect(await renderPage(), "the freeze pauses it").toContain("&quot;londonLaneOpen&quot;:false");
  });
});
