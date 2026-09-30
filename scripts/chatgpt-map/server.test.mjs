import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LONDON_BOROUGH_NAMES } from "../../lib/londonBoroughNames.mjs";
import { createPublicMapHttpServer } from "./server.mjs";

test("real MCP client initializes, lists the UI, reads venues and rejects private coordinate input", async () => {
  const calls = [];
  const server = await createPublicMapHttpServer({ loadVenues: async (area, limit) => {
    calls.push({ area, limit });
    return { area, venues: [], priceNotice: "Listed prices" };
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: "pubmaxx-proof", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 1);
    assert.equal(tools.tools[0]._meta.ui.resourceUri, "ui://pubmaxx/public-map/v1.html");
    assert.equal(tools.tools[0].annotations.readOnlyHint, true);
    const { properties, required, additionalProperties } = tools.tools[0].inputSchema;
    assert.deepEqual(Object.keys(properties).sort(), ["area", "limit"]);
    assert.deepEqual(properties.area.enum, [...LONDON_BOROUGH_NAMES]);
    assert.deepEqual(required, ["area"]);
    assert.equal(additionalProperties, false);
    assert.equal(properties.limit.maximum, 30);
    const result = await client.callTool({ name: "pubmaxx_venues_in_area", arguments: { area: "Camden" } });
    assert.equal(result.structuredContent.area, "Camden");
    await client.callTool({ name: "pubmaxx_venues_in_area", arguments: { area: "Kensington and Chelsea", limit: 30 } });
    assert.deepEqual(calls, [{ area: "Camden", limit: 12 }, { area: "Kensington and Chelsea", limit: 30 }]);
    for (const args of [
      { area: "Camden", friendLatitude: 51.5 },
      { area: "Soho" },
      { area: "Kensington & Chelsea" },
      { area: "camden" },
      { area: "Camden", limit: 31 },
    ]) {
      const refused = await client.callTool({ name: "pubmaxx_venues_in_area", arguments: args });
      assert.equal(refused.isError, true, JSON.stringify(args));
    }
    assert.equal(calls.length, 2);
    const resource = await client.readResource({ uri: tools.tools[0]._meta.ui.resourceUri });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(resource.contents[0]._meta.ui.csp, {
      connectDomains: ["https://tiles.openfreemap.org", "https://unpkg.com"],
      resourceDomains: ["https://unpkg.com", "https://tiles.openfreemap.org", "blob:"],
    });
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: { Origin: "https://foreign.test" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", body: "{" })).status, 400);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects a foreign Host even when an absolute request target names loopback", async () => {
  const server = await createPublicMapHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const status = await new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: `http://127.0.0.1:${port}/widget`, headers: { Host: "foreign.test" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
