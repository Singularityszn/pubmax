import { createHash } from "node:crypto";
import { createServer, request, type ClientRequest, type ServerResponse } from "node:http";

// Deliver the real response unchanged, splitting after the first Pal action.
// Hold the remaining HTML and real font bytes for controlled transport timing.
// This models the partial-header paint, not a naturally observed CI schedule.
export async function fragmentedLandingProxy(baseURL: string, { fontTimeoutMs = 10_000 }: { fontTimeoutMs?: number } = {}) {
  const upstreamOrigin = new URL(baseURL);
  if (upstreamOrigin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(upstreamOrigin.hostname)) {
    throw new Error("The streamed landing regression requires a local HTTP baseURL.");
  }
  if (!Number.isFinite(fontTimeoutMs) || fontTimeoutMs < 500 || fontTimeoutMs > 10_000) {
    throw new Error("The font wait must be between 500 and 10000 ms.");
  }
  const requests = new Set<ClientRequest>();
  const waitingFonts: Array<{ response: ServerResponse; release: () => void }> = [];
  const delivery = { originalSha256: "", htmlBytes: 0, splitAt: 0, heldFonts: 0, errors: [] as string[] };
  // Open from the header split until the HTML tail is written. A font the
  // browser asks for in that window is held until the tail, decided when the
  // request arrives so a slow upstream reply cannot slip past the hold.
  let headerStreaming = false;
  let minimumHoldFinished = false;
  let releaseLanding: (() => void) | undefined;
  const releaseWhenReady = () => {
    if (minimumHoldFinished && waitingFonts.filter(({ response }) => !response.destroyed).length >= 2) releaseLanding?.();
  };
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let fontDeadline: ReturnType<typeof setTimeout> | undefined;
  const server = createServer((incoming, outgoing) => {
    const fontRequestedWhileStreaming = headerStreaming && /\.woff2?$/.test(new URL(incoming.url ?? "/", upstreamOrigin).pathname);
    const upstreamURL = new URL(upstreamOrigin);
    const path = new URL(incoming.url ?? "/", upstreamOrigin);
    upstreamURL.pathname = path.pathname;
    upstreamURL.search = path.search;
    const upstream = request(upstreamURL, {
      method: incoming.method,
      headers: { ...incoming.headers, host: upstreamOrigin.host, "accept-encoding": "identity" },
    }, (reply) => {
      const isLanding = path.pathname === "/" && reply.statusCode === 200 &&
        String(reply.headers["content-type"]).includes("text/html");
      const holdFont = fontRequestedWhileStreaming && reply.statusCode === 200;
      if (!isLanding && !holdFont) {
        outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(outgoing);
        return;
      }
      const chunks: Buffer[] = [];
      reply.on("data", (chunk: Buffer) => chunks.push(chunk));
      reply.on("error", (error) => {
        delivery.errors.push(error.message);
        outgoing.destroy(error);
      });
      reply.on("end", () => {
        const body = Buffer.concat(chunks);
        if (holdFont) {
          const release = () => {
            outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
            outgoing.end(body);
          };
          if (headerStreaming) {
            waitingFonts.push({ response: outgoing, release });
            releaseWhenReady();
          }
          else release();
          return;
        }
        const actions = body.indexOf("siteNavActions lpNavActions");
        const firstLinkEnd = body.indexOf("</a>", actions);
        const headerEnd = body.indexOf("</header>", actions);
        if (actions < 0 || firstLinkEnd < 0 || headerEnd < firstLinkEnd) {
          delivery.errors.push("The response has no complete public landing action link.");
          outgoing.writeHead(502);
          outgoing.end("Landing header boundary unavailable");
          return;
        }
        delivery.splitAt = firstLinkEnd + Buffer.byteLength("</a>");
        delivery.htmlBytes = body.length;
        delivery.originalSha256 = createHash("sha256").update(body).digest("hex");
        const headers = { ...reply.headers };
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        outgoing.writeHead(200, headers);
        headerStreaming = true;
        minimumHoldFinished = false;
        releaseLanding = () => {
          headerStreaming = false;
          clearTimeout(releaseTimer);
          clearTimeout(fontDeadline);
          for (const { response, release } of waitingFonts.splice(0)) {
            if (!response.destroyed) {
              release();
              delivery.heldFonts += 1;
            }
          }
          outgoing.end(body.subarray(delivery.splitAt));
          releaseLanding = undefined;
        };
        outgoing.flushHeaders();
        outgoing.write(body.subarray(0, delivery.splitAt));
        releaseTimer = setTimeout(() => {
          minimumHoldFinished = true;
          releaseWhenReady();
        }, 500);
        fontDeadline = setTimeout(() => {
          delivery.errors.push("The streamed landing setup timed out before at least two real font responses completed.");
          releaseLanding?.();
        }, fontTimeoutMs);
      });
    });
    requests.add(upstream);
    upstream.once("close", () => requests.delete(upstream));
    upstream.setTimeout(10_000, () => upstream.destroy(new Error("Local landing upstream timed out.")));
    upstream.on("error", (error) => {
      delivery.errors.push(error.message);
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end("Local landing upstream unavailable");
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The landing proxy has no private port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    delivery,
    async close() {
      clearTimeout(releaseTimer);
      clearTimeout(fontDeadline);
      waitingFonts.length = 0;
      for (const pending of requests) pending.destroy();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
