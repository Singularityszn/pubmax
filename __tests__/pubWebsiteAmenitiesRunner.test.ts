import { describe, expect, it } from "vitest";

import {
  createSharedHomepageCli,
  EXTRA,
  FOOD_QUOTE,
  HOME,
  LANDING,
  OBSERVED_AT,
  pageAt,
  pagesWithLinkedLanding,
  POOL_QUOTE,
  PRICE_ROW,
  removeScratchCopiesAfterEach,
  runCli,
  SECOND_PUB,
  SPORTS_QUOTE,
  WELCOME,
} from "./helpers/pubWebsiteAmenitiesCli";

// The pub website amenities CLI: robots permission and page citations.
// The scratch CLI and its fixtures are shared in __tests__/helpers/pubWebsiteAmenitiesCli.ts.
removeScratchCopiesAfterEach();

describe("pub website amenities CLI permission and page citations", () => {
  it("refuses a shared homepage when its other pub retains no amenity", () => {
    const cli = createSharedHomepageCli();
    const result = cli.run();
    expect(result.status, result.stderr).toBe(0);
    const { dataset, evidence } = cli.output();
    expect(cli.calls().filter((call) => call.kind === "model")).toHaveLength(2);
    expect(evidence.rows, result.stdout).toEqual([]);
    expect(dataset.map((row: typeof PRICE_ROW) => row.live_sports)).toEqual(["", ""]);
  });

  it("rejects a quote assembled across separate pages", () => {
    const { dataset, evidence } = runCli(pagesWithLinkedLanding(EXTRA), {
      liveSports: { value: true, evidence: `for all visitors. ${SPORTS_QUOTE}` },
    });
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });

  it("rejects navigation text while retaining genuine linked-page evidence", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    const navigation = "Food and drinks Hotels About us Contact us Careers";
    pageAt(pages, HOME).body = `<p>${WELCOME}</p><nav>${navigation}</nav><a href="/sports">Sport</a>`;
    const { dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: navigation },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    expect(evidence.rows).toEqual([expect.objectContaining({ sourceUrl: EXTRA, amenities: { liveSports: SPORTS_QUOTE } })]);
    expect(dataset[0]).toMatchObject({ food: "", live_sports: "y" });
  });

  it("restamps both permitted pages without network calls or changing prices and observation dates", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const { calls, dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    }, { restamp: true });
    expect(calls).toEqual([]);
    expect(evidence.rows).toEqual([
      expect.objectContaining({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { food: FOOD_QUOTE } }),
      expect.objectContaining({ sourceUrl: EXTRA, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } }),
    ]);
    expect(evidence).toMatchObject({ stampedVenues: 1, stampedRows: 1 });
    expect(dataset[0]).toMatchObject({ food: "y", live_sports: "y" });
  });

  it("rejects identical quotes on distinct pages belonging to different pubs sharing a host", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pages[SECOND_PUB] = { body: `<p>Welcome to Synthetic Second Pub. ${SPORTS_QUOTE}</p>` };
    const { dataset, evidence } = runCli(pages, undefined, { secondPub: true });
    expect(evidence.rows).toEqual([]);
    expect(dataset.map((row: typeof PRICE_ROW) => row.live_sports)).toEqual(["", ""]);
  });

  it("keeps unique pub-page quotes but rejects a homepage shared by different pubs", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    pages[SECOND_PUB] = { body: `<p>Welcome to Synthetic Second Pub. ${POOL_QUOTE}</p>` };
    const { dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
      pool: { value: true, evidence: POOL_QUOTE },
    }, { secondPub: true });
    expect(evidence.rows).toEqual([
      expect.objectContaining({ osmId: "node/synthetic-1", sourceUrl: EXTRA, amenities: { liveSports: SPORTS_QUOTE } }),
      expect.objectContaining({ osmId: "node/synthetic-2", sourceUrl: SECOND_PUB, amenities: { pool: POOL_QUOTE } }),
    ]);
    expect(dataset[0]).toMatchObject({ food: "", live_sports: "y" });
    expect(dataset[1]).toMatchObject({ food: "", live_sports: "", pool: "y" });
  });

  it("retains homepage and linked-page quotes for one pub with their actual citations", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pageAt(pages, HOME).body = `<p>${WELCOME} ${FOOD_QUOTE}</p><a href="/sports">Sport</a>`;
    const { dataset, evidence } = runCli(pages, {
      food: { value: true, evidence: FOOD_QUOTE },
      liveSports: { value: true, evidence: SPORTS_QUOTE },
    });
    expect(evidence.rows).toEqual([
      expect.objectContaining({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { food: FOOD_QUOTE } }),
      expect.objectContaining({ sourceUrl: EXTRA, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } }),
    ]);
    expect(dataset[0]).toMatchObject({ food: "y", live_sports: "y" });
  });

  it("keeps a quote repeated on a shared-host homepage cited by its pub-specific linked page", () => {
    const pages = pagesWithLinkedLanding(EXTRA);
    pageAt(pages, HOME).body = `<p>${WELCOME} ${SPORTS_QUOTE}</p><a href="/sports">Sport</a>`;
    pages[SECOND_PUB] = { body: `<p>Welcome to Synthetic Second Pub. ${POOL_QUOTE}</p>` };
    const { dataset, evidence } = runCli(pages, {
      liveSports: { value: true, evidence: SPORTS_QUOTE },
      pool: { value: true, evidence: POOL_QUOTE },
    }, { secondPub: true, restamp: true });
    expect(evidence.rows).toEqual([
      expect.objectContaining({ osmId: "node/synthetic-1", sourceUrl: EXTRA, amenities: { liveSports: SPORTS_QUOTE } }),
      expect.objectContaining({ osmId: "node/synthetic-2", sourceUrl: SECOND_PUB, amenities: { pool: POOL_QUOTE } }),
    ]);
    expect(dataset[0].live_sports).toBe("y");
    expect(dataset[1]).toMatchObject({ live_sports: "", pool: "y" });
  });

  it("cites the permitted linked landing that contains the retained quote", () => {
    const { dataset, evidence } = runCli(pagesWithLinkedLanding());
    expect(evidence.rows).toEqual([expect.objectContaining({
      sourceUrl: LANDING,
      verifiedAt: OBSERVED_AT,
      amenities: { liveSports: SPORTS_QUOTE },
    })]);
    expect(dataset[0].live_sports).toBe("y");
  });

  it("excludes a linked landing denied by robots from model input and publication", () => {
    const { calls, dataset, evidence } = runCli(pagesWithLinkedLanding(LANDING, "Disallow: /"));
    const modelCalls = calls.filter((call) => call.kind === "model");
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]?.page).not.toContain(SPORTS_QUOTE);
    expect(calls).toContainEqual({ kind: "fetch", url: "https://landing.example/robots.txt" });
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });

  it("retains affirmative linked-page evidence when landing robots allows it", () => {
    const { calls, dataset, evidence } = runCli(pagesWithLinkedLanding());
    expect(calls.filter((call) => call.kind === "model")).toHaveLength(1);
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({ verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } });
    expect(dataset[0].live_sports).toBe("y");
  });

  it("retains affirmative homepage evidence when its landing robots allows it", () => {
    const pages = pagesWithLinkedLanding();
    pages[HOME] = { body: `<p>${WELCOME} ${SPORTS_QUOTE}</p>` };
    const { calls, dataset, evidence } = runCli(pages);
    expect(calls.filter((call) => call.kind === "model")).toHaveLength(1);
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({ sourceUrl: HOME, verifiedAt: OBSERVED_AT, amenities: { liveSports: SPORTS_QUOTE } });
    expect(dataset[0].live_sports).toBe("y");
  });

  it("refuses a homepage landing denied by robots before calling the model", () => {
    const pages = pagesWithLinkedLanding(LANDING, "Disallow: /");
    pages[HOME] = { body: `<p>${WELCOME} ${SPORTS_QUOTE}</p>`, url: LANDING };
    const { calls, dataset, evidence } = runCli(pages);
    expect(calls.filter((call) => call.kind === "model")).toEqual([]);
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });

  it("excludes a linked landing refused by shared source policy", () => {
    const { calls, dataset, evidence } = runCli(pagesWithLinkedLanding("https://127.0.0.1/sports"));
    expect(calls.filter((call) => call.kind === "model")).toHaveLength(1);
    expect(calls.find((call) => call.kind === "model")?.page).not.toContain(SPORTS_QUOTE);
    expect(evidence.rows).toEqual([]);
    expect(dataset[0].live_sports).toBe("");
  });
});
