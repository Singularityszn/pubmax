import { EventEmitter } from "node:events";
import { appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("node:fs", () => ({
  existsSync: (file: string) => file.endsWith("uk_osm_pubs.json"),
  readFileSync: () => JSON.stringify([
    { osmId: "node/1", name: "King Edward VII", website: "https://kingeddies.co.uk/" },
    { osmId: "node/2", name: "Fox & Hounds", website: "https://www.craftunionpubs.com/fox" },
    { osmId: "node/3", name: "Little Driver", website: "https://www.craftunionpubs.com/driver" },
    { osmId: "node/4", name: "Tap East", website: "http://www.tapeast.co.uk/" },
  ]),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

const asked: string[] = [];
vi.mock("@/lib/harvest/robots.ts", () => ({
  createRobotsChecker: () => async (url: string) => {
    asked.push(url);
    return { allowed: true };
  },
}));

const rendered: string[] = [];
const DRINKS = `
  <p>Coca-Cola Zero 330ml £2.80</p>
  <p>Diet Coke 330ml £2.80</p>
  <p>J2O Apple & Mango £3.20</p>
  <p>Fentimans Ginger Beer £3.40</p>`;

vi.mock("node:child_process", () => ({
  spawn: (_cmd: string, args: string[]) => {
    const url = defined(args[args.indexOf("fetch") + 1]);
    rendered.push(url);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() });
    queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify(
        url === "http://www.tapeast.co.uk/"
          ? { url, markdown: "", links: [], error: "Upstream returned HTTP 405" }
          : url === "https://kingeddies.co.uk/"
          ? {
            http_status: 200,
            markdown: `<p>${"Welcome to King Edward VII, a Stratford pub since 1812. ".repeat(30)}</p>`,
            links: ["https://kingeddies.co.uk/home/menu/", "https://www.instagram.com/kingeddies"],
          }
          : { http_status: 200, markdown: `<p>${"Our drinks are poured by people who care about them. ".repeat(30)}</p>${DRINKS}`, links: [] },
      ));
      child.emit("close", 0);
    });
    return child;
  },
}));

describe("rendered pub sites", () => {
  it("renders a single-pub site's home page and its drinks link, and dates each row to that page", async () => {
    process.argv.push("--pub-sites");
    try {
      await import("../scripts/harvest/uk-prices/render.mjs");
    } finally {
      process.argv.splice(process.argv.indexOf("--pub-sites"), 1);
    }
    // The estate host serving two pubs is never rendered, and the
    // off-site link is never opened.
    expect(rendered.sort()).toEqual([
      "http://www.tapeast.co.uk/",
      "https://kingeddies.co.uk/",
      "https://kingeddies.co.uk/home/menu/",
    ]);
    expect(asked.sort()).toEqual(rendered);

    // A render that failed is recorded as a failure, once, never as a page
    // that states no menu.
    const ledgerWrites = vi.mocked(writeFileSync).mock.calls.filter(([file]) => String(file).endsWith("rendered.json"));
    const ledger = JSON.parse(String(defined(ledgerWrites.at(-1))[1])) as { pages: Record<string, { outcome: string }> };
    expect(ledger.pages["http://www.tapeast.co.uk/"]?.outcome).toBe("render-failed");
    expect(ledger.pages["https://kingeddies.co.uk/"]?.outcome).toBe("priced");

    const writes = vi.mocked(appendFileSync).mock.calls;
    expect(writes).toHaveLength(1);
    const rows = String(defined(writes[0])[1]).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows.map((row) => [row.drinkLabel, row.priceGbp])).toEqual(
      expect.arrayContaining([["Coca-Cola Zero 330ml", 2.8], ["Diet Coke 330ml", 2.8]]),
    );
    expect(rows.every((row) =>
      row.sourceUrl === "https://kingeddies.co.uk/home/menu/" &&
      row.venueId === "venue-uk-n1" &&
      row.pubsOnHost === 1 &&
      row.renderer === "wigolo",
    )).toBe(true);
  });
});
