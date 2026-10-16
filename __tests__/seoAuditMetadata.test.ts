import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateMetadata } from "@/app/pint-index/page";
import { metadata as crawlsMetadata } from "@/app/crawls/page";

// The committed public snapshot is a genuine empty read. A populated fixture
// is exercised by the admission tests, independently of this display wording.
describe("the public discovery metadata", () => {
  it("names the Pint Index content without duplicating the layout's brand suffix", async () => {
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("London pint prices by borough and fare zone");
    expect(metadata.description).toContain("fare zone");
    expect(metadata.alternates?.canonical).toBe("/pint-index");
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.openGraph).toMatchObject({ title: metadata.title, description: metadata.description });
    expect(metadata.twitter).toMatchObject({ title: metadata.title, description: metadata.description });
  });

  it("names the existing London crawl directory and retains its canonical", () => {
    expect(crawlsMetadata.title).toBe("London pub crawl routes");
    expect(crawlsMetadata.alternates?.canonical).toBe("/crawls");
    expect(crawlsMetadata.openGraph).toMatchObject({ title: "London pub crawl routes", url: "/crawls" });
    expect(crawlsMetadata.twitter).toMatchObject({ title: "London pub crawl routes" });
  });
});
