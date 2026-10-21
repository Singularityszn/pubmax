import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { publicApiError } from "@/lib/apiError";
import { boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { createNightArchitectServer } from "@/lib/chatgpt/server";
import { publicPubDetails, searchPublicPubs } from "@/lib/chatgpt/data.server";
import { generatePublicEvening } from "@/lib/chatgpt/generation.server";
import { nightArchitectWidget } from "@/lib/chatgpt/widget.server";
import { isLimited } from "@/lib/pintDrops";
import { resolveClientIp } from "@/lib/clientIpTrust";
import { hashIp } from "@/lib/rateLimitHash";
import { POST as generate } from "@/app/api/plans/generate/route";

export const runtime = "nodejs";
export const maxDuration = 30;

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const own = new URL(request.url).origin;
  return origin === "https://chatgpt.com" || origin === "https://pubmaxxing.com" || origin === own;
}
function allowedHost(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "pubmaxxing.com" || hostname === process.env.VERCEL_URL
    || hostname === process.env.VERCEL_BRANCH_URL
    || ((process.env.NODE_ENV !== "production" || (process.env.PUBMAX_E2E_KEYLESS === "1" && !process.env.VERCEL_ENV)) && ["localhost", "127.0.0.1", "[::1]"].includes(hostname));
}

export async function POST(request: Request): Promise<Response> {
  if (!allowedHost(request) || !allowedOrigin(request)) return publicApiError("This request origin is not allowed.", "FORBIDDEN", 403);
  const key = `chatgpt-mcp:${hashIp(resolveClientIp((name) => request.headers.get(name)))}`;
  if (await isLimited(key, key, 120, 60_000)) {
    return publicApiError("Too many plugin requests. Try again shortly.", "RATE_LIMITED", 429, { retryable: true, headers: { "Retry-After": "60" } });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return publicApiError("Send application/json.", "INVALID_REQUEST", 415);
  }
  let body: unknown;
  try { body = await boundedJson(request, 32 * 1024); }
  catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? publicApiError("This plugin request is too large.", "PAYLOAD_TOO_LARGE", 413)
      : publicApiError("Send a valid JSON request.", "MALFORMED_REQUEST", 400);
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  const scoped = new Request(request.url, { method: "POST", headers: request.headers, signal });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  let server;
  let onAbort: (() => void) | undefined;
  try {
    server = createNightArchitectServer({
      search: searchPublicPubs, detail: publicPubDetails,
      generate: (input) => generatePublicEvening(input, scoped, generate),
    }, await nightArchitectWidget());
    await server.connect(transport);
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error("MCP request ended"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    const response = await Promise.race([transport.handleRequest(scoped, { parsedBody: body }), cancelled]);
    if (response.status >= 400) {
      await response.body?.cancel();
      return publicApiError("The MCP request could not be accepted. Check the protocol headers and message.", "INVALID_REQUEST", response.status);
    }
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return publicApiError("The plugin is unavailable. Try again shortly.", "UNAVAILABLE", 503, { retryable: true });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    await transport.close();
    await server?.close();
  }
}

export async function GET(): Promise<Response> {
  return publicApiError("Use POST for this stateless MCP endpoint.", "METHOD_NOT_ALLOWED", 405, { headers: { Allow: "POST, OPTIONS" } });
}
export async function OPTIONS(request: Request): Promise<Response> {
  if (!allowedHost(request) || !allowedOrigin(request)) return publicApiError("This request origin is not allowed.", "FORBIDDEN", 403);
  return new Response(null, { status: 204, headers: {
    Allow: "POST, OPTIONS",
    "Cache-Control": "no-store", Vary: "Origin",
  } });
}
