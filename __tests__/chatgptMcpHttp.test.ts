import { describe, expect, it } from "vitest";
import { POST, GET, OPTIONS } from "@/app/api/mcp/route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:38761/api/mcp", { method: "POST", headers: {
    host: "localhost:38761", "content-type": "application/json", accept: "application/json, text/event-stream", ...headers,
  }, body: JSON.stringify(body) });
}
describe("public MCP HTTP boundary", () => {
  it("rejects a foreign Host even when the request URL and forwarded host are allowed", async () => {
    const input = request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, {
      host: "attacker.example", "x-forwarded-host": "pubmaxxing.com",
    });
    const response = await POST(input);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN", retryable: false });
    expect((await OPTIONS(input)).status).toBe(403);
  });

  it("rejects a missing Host instead of trusting the request URL", async () => {
    const input = request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    input.headers.delete("host");
    expect((await POST(input)).status).toBe(403);
    expect((await OPTIONS(input)).status).toBe(403);
  });

  it.each(["pubmaxxing.com", "LOCALHOST:38761", "127.0.0.1:38761", "[::1]:38761"])("accepts the allowed Host %s", async (host) => {
    expect((await OPTIONS(request({}, { host }))).status).toBe(204);
  });

  it("initializes stateless MCP and discovers the real tools without account credentials", async () => {
    const init = await POST(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "pubmaxx-proof", version: "1" },
    } }));
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    expect(init.headers.get("cache-control")).toBe("no-store");
    expect(await init.json()).toMatchObject({ result: { serverInfo: { name: "pubmaxx-night-architect" } } });
    const response = await POST(request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools).toHaveLength(4);
  });
  it("refuses foreign origins, malformed JSON, excessive bodies and unsupported methods", async () => {
    expect((await POST(request({}, { origin: "https://attacker.example" }))).status).toBe(403);
    expect((await POST(request({ text: "x".repeat(33_000) }))).status).toBe(413);
    const malformed = await POST(new Request("http://localhost:38761/api/mcp", { method: "POST", headers: { host: "localhost:38761", "content-type": "application/json" }, body: "{" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "MALFORMED_REQUEST", retryable: false });
    expect((await GET()).status).toBe(405);
    expect((await OPTIONS(request({}, { origin: "https://attacker.example" }))).status).toBe(403);
  });
});

it("searches a real district and returns only public sourced venue fields", async () => {
  const response = await POST(request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {
    name: "pubmaxx_search_venues", arguments: { query: "Soho", limit: 3 },
  } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.isError).not.toBe(true);
  expect(body.result.structuredContent.venues).toHaveLength(3);
  for (const pub of body.result.structuredContent.venues) {
    expect(pub.href).toMatch(/^https:\/\/pubmaxxing.com\/map\?sel=/);
    expect(pub.latitude).toBeGreaterThan(51);
    for (const price of pub.prices) expect(price).toMatchObject({ observedAt: expect.toBeOneOf([null, expect.any(String)]), status: expect.toBeOneOf(["recorded", "estimate"]) });
  }
});
