import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import next from "next";

import { PINT_DATASET_FILE, PINT_DATASET_OBSERVED_AT } from "../../lib/dataFreshness";
import { latestPriceRowRead } from "../../lib/priceReadDay.mjs";

// After every bundled read: the noon stamp can precede an afternoon collection.
const rows = JSON.parse(
  readFileSync(path.join(process.cwd(), "public", "data", PINT_DATASET_FILE), "utf8"),
) as { scraped_at_values?: unknown }[];
const now = Math.max(PINT_DATASET_OBSERVED_AT.getTime(), latestPriceRowRead(rows) ?? 0) + 1_000;
Date.now = () => now;

async function start() {
  const app = next({ dev: false, hostname: "127.0.0.1" });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The fixture server requires a TCP port.");
    process.send!({ baseURL: `http://127.0.0.1:${address.port}`, now });
  });
}

void start();
