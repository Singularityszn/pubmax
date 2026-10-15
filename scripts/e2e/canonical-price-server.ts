import { createServer } from "node:http";

import next from "next";

import { PINT_DATASET_OBSERVED_AT } from "../../lib/dataFreshness";

const now = PINT_DATASET_OBSERVED_AT.getTime() + 1_000;
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
