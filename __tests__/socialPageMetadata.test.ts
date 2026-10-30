import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateMetadata } from "@/app/social/page";

describe("/social generateMetadata indexing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps Social indexed by default", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "");
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("indexes Social when the friends launch flag is on", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });
});

// Launch review, 30 Oct 2026, item 10: /discover and /drinks redirect to
// /social?tab=discover, a page headed "Pubs and pints", which was titled
// "Social | PUBMAXX". The title and description follow the tab now.
describe("/social generateMetadata follows the tab", () => {
  const params = (query: Record<string, string>) => ({ searchParams: Promise.resolve(query) });

  it("titles the Pubs and pints tab by its heading", async () => {
    const metadata = await generateMetadata(params({ tab: "discover" }));
    expect(metadata.title).toBe("Pubs and pints");
    expect(metadata.description).toBe("London pubs and their listed pint prices, plus heritage crawls to walk.");
    expect(metadata.alternates?.canonical).toBe("/social?tab=discover");
    expect((metadata.openGraph as { title?: string }).title).toBe("Pubs and pints · PUBMAXX");
  });

  it("keeps the posts tab titled as Social", async () => {
    const metadata = await generateMetadata(params({}));
    expect(metadata.title).not.toBe("Pubs and pints");
    expect(metadata.alternates?.canonical).toBe("/social");
  });

  it("titles an invalid query as /social, where the page sends it", async () => {
    const metadata = await generateMetadata(params({ tab: "nonsense" }));
    expect(metadata.alternates?.canonical).toBe("/social");
  });
});
