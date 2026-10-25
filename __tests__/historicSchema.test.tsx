import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import HistoricDetailPage from "@/app/historic/[slug]/page";

async function historicSchema(slug: string) {
  const document = renderToStaticMarkup(
    await HistoricDetailPage({ params: Promise.resolve({ slug }) }),
  );
  const script = document.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  expect(script).not.toBeNull();
  return { document, schema: JSON.parse(script![1]!) };
}

describe("historic pub identity markup", () => {
  it("keeps a single unambiguous Wikipedia identity", async () => {
    const { schema } = await historicSchema("prospect-of-whitby");
    expect(schema.sameAs).toEqual(["https://en.wikipedia.org/wiki/Prospect_of_Whitby"]);
  });

  it("does not equate the pub with a photographic print that cites it", async () => {
    const { document, schema } = await historicSchema("the-grapes");
    expect(schema.sameAs).toEqual(["https://en.wikipedia.org/wiki/The_Grapes,_Limehouse"]);
    expect(document).toContain('href="https://www.alastairhiltonphotographer.com/product-page/the-grapes"');
  });

  it("omits identity claims when the record cites different pubs", async () => {
    const { document, schema } = await historicSchema("black-lion");
    expect(schema).not.toHaveProperty("sameAs");
    expect(document).toContain('href="https://en.wikipedia.org/wiki/Black_Lion,_Kilburn"');
    expect(document).toContain('href="https://en.wikipedia.org/wiki/Black_Lion,_Hammersmith"');
  });
});
