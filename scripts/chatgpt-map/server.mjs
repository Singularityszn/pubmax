import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { LONDON_BOROUGHS, loadPublicVenues } from "./public-venues.mjs";
import { sharedWidgetStyles } from "./shared-styles.mjs";

const RESOURCE_URI = "ui://pubmaxx/public-map/v1.html";
const WIDGET = new URL("./widget.html", import.meta.url);
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_BODY_BYTES = 32 * 1024;

function createMcpServer(widget, loadVenues) {
  const server = new McpServer({ name: "pubmaxx-public-map", version: "0.1.0" });
  registerAppResource(server, "public-venue-map", RESOURCE_URI, {}, async () => ({
    contents: [{
      uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: widget,
      _meta: { ui: { prefersBorder: true, csp: {
        connectDomains: ["https://tiles.openfreemap.org", "https://unpkg.com"],
        // MapLibre creates its pinned module worker through a local blob URL.
        resourceDomains: ["https://unpkg.com", "https://tiles.openfreemap.org", "blob:"],
      } } },
    }],
  }));
  registerAppTool(server, "pubmaxx_venues_in_area", {
    title: "Pubs and listed pint prices",
    description: "Read listed PUBMAXX venues in one London borough, named exactly as one of the accepted area values. Districts and neighbourhoods are not accepted. Bundled pint prices are not a live feed. No personal location, account or friends data is available.",
    inputSchema: z.object({ area: z.enum(LONDON_BOROUGHS), limit: z.number().int().min(1).max(30).default(12) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }, async ({ area, limit }) => {
    try {
      const result = await loadVenues(area, limit);
      return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Pubs could not be loaded. Ask to retry pub search." }] };
    }
  });
  return server;
}

/** Local preview only. Published hosting requires a separate release decision. */
export async function createPublicMapHttpServer({ loadVenues = loadPublicVenues } = {}) {
  const [template, lightCss, darkCss] = await Promise.all([
    readFile(WIDGET, "utf8"),
    readFile(new URL("../../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../app/theme.css", import.meta.url), "utf8"),
  ]);
  const widget = template.replace("/* PUBMAXX_SHARED_STYLES */", sharedWidgetStyles(lightCss, darkCss));
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const host = req.headers.host;
    if (typeof host !== "string" || /[\\/\\\\@?#\s]/.test(host)) { res.writeHead(403).end("Host refused"); return; }
    let authority;
    try { authority = new URL(`http://${host}`); }
    catch { res.writeHead(403).end("Host refused"); return; }
    if (!ALLOWED_HOSTS.has(authority.hostname)) { res.writeHead(403).end("Local preview only"); return; }
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) { res.writeHead(400).end("Use an origin-form request target"); return; }
    let url;
    try { url = new URL(req.url, authority); }
    catch { res.writeHead(400).end("Invalid request"); return; }
    if (!ALLOWED_HOSTS.has(url.hostname)) { res.writeHead(403).end("Local preview only"); return; }
    if (req.headers.origin) {
      try {
        if (!ALLOWED_HOSTS.has(new URL(req.headers.origin).hostname)) { res.writeHead(403).end("Origin refused"); return; }
      } catch { res.writeHead(403).end("Origin refused"); return; }
    }
    if (url.pathname === "/widget" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(widget); return;
    }
    if (url.pathname !== "/mcp") { res.writeHead(404).end("Not found"); return; }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end("Use POST for this stateless MCP server"); return; }
    let bytes = 0;
    let body;
    try {
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) { res.writeHead(413).end("Request too large"); return; }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { res.writeHead(400).end("Invalid JSON"); return; }
    const server = createMcpServer(widget, loadVenues);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500).end("MCP request failed");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PUBMAX_MCP_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError("PUBMAX_MCP_PORT must be between 1024 and 65535.");
  const server = await createPublicMapHttpServer();
  server.listen(port, "127.0.0.1", () => console.log(`PUBMAXX local public map: http://127.0.0.1:${port}/mcp`));
}
