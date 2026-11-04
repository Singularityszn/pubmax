import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, get } from "node:http";
import test from "node:test";
import { setImmediate, setTimeout } from "node:timers/promises";
import { fragmentedLandingProxy } from "../e2e/helpers/fragmentedLandingProxy.mts";

const html = Buffer.from('<header><div class="siteNavActions lpNavActions"><a>Pal</a><a>More</a></div></header><main>Complete page</main>');
// These bytes exercise HTTP transport only. The browser spec still uses real fonts.
const font = Buffer.from("local upstream font transport bytes");

async function withTransport(fontReply, check, options) {
  const upstream = createServer((incoming, outgoing) => {
    if (incoming.url === "/") {
      outgoing.writeHead(200, { "content-type": "text/html" });
      outgoing.end(html);
    } else {
      fontReply(incoming, outgoing);
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const proxy = await fragmentedLandingProxy(`http://127.0.0.1:${upstream.address().port}`, options);
  const pending = [];
  const read = (path, onData) => {
    const result = new Promise((resolve, reject) => {
      get(`${proxy.origin}${path}`, (response) => {
        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(chunk);
          onData?.(chunk);
        });
        response.on("error", reject);
        response.on("aborted", () => reject(new Error("Proxy response aborted")));
        response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
      }).on("error", reject);
    });
    result.catch(() => undefined);
    pending.push(result);
    return result;
  };
  try {
    await check(proxy, read);
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    await Promise.allSettled(pending);
    assert.equal(upstream.listening, false);
  }
}

test("two normal fonts co-release unchanged bytes while a later reply does not count as held", { timeout: 5_000 }, async () => {
  let lateReply;
  await withTransport((incoming, outgoing) => {
    if (incoming.url === "/late.woff2") {
      lateReply = outgoing;
      return;
    }
    outgoing.writeHead(200, { "content-type": "font/woff2" });
    outgoing.end(font);
  }, async (proxy, read) => {
    let fonts;
    const page = read("/", () => {
      fonts ??= [read("/a.woff2"), read("/b.woff2"), read("/late.woff2")];
    });
    const document = await page;
    const normalFonts = await Promise.all(fonts.slice(0, 2));
    assert.equal(document.status, 200);
    assert.deepEqual(document.body, html);
    assert.equal(proxy.delivery.originalSha256, createHash("sha256").update(html).digest("hex"));
    assert.ok(normalFonts.every((response) => response.status === 200 && response.body.equals(font)));
    assert.equal(proxy.delivery.heldFonts, 2);
    lateReply.writeHead(200, { "content-type": "font/woff2" });
    lateReply.end(font);
    assert.deepEqual((await fonts[2]).body, font);
    assert.equal(proxy.delivery.heldFonts, 2, "Late passthrough must not count as a co-released response");
    assert.deepEqual(proxy.delivery.errors, []);
  });
});

test("the HTML tail waits for both font bodies when upstream takes longer than 500 ms", { timeout: 5_000 }, async () => {
  const replies = [];
  let bothRequested;
  const requested = new Promise((resolve) => { bothRequested = resolve; });
  await withTransport((_incoming, outgoing) => {
    replies.push(outgoing);
    if (replies.length === 2) bothRequested();
  }, async (proxy, read) => {
    let fonts;
    let finished = false;
    const page = read("/", () => {
      fonts ??= [read("/a.woff2"), read("/b.woff2")];
    });
    page.then(() => { finished = true; }, () => undefined);
    await requested;
    await setTimeout(650);
    await setImmediate();
    assert.equal(finished, false, "The HTML tail must stay held while both upstream font bodies are unavailable");
    assert.equal(proxy.delivery.heldFonts, 0);
    for (const reply of replies) {
      reply.writeHead(200, { "content-type": "font/woff2" });
      reply.end(font);
    }
    const [document, ...responses] = await Promise.all([page, ...fonts]);
    assert.deepEqual(document.body, html);
    assert.ok(responses.every((response) => response.body.equals(font)));
    assert.equal(proxy.delivery.heldFonts, 2);
    assert.deepEqual(proxy.delivery.errors, []);
  });
});

test("fewer than two fonts produces a bounded setup error instead of hanging", { timeout: 5_000 }, async () => {
  await withTransport((_incoming, outgoing) => {
    outgoing.writeHead(200, { "content-type": "font/woff2" });
    outgoing.end(font);
  }, async (proxy, read) => {
    let onlyFont;
    const page = read("/", () => { onlyFont ??= read("/only.woff2"); });
    const document = await Promise.race([
      page,
      setTimeout(1_500, null, { ref: false }).then(() => { throw new Error("The proxy did not end its failed setup within the bound"); }),
    ]);
    assert.deepEqual(document.body, html);
    assert.deepEqual((await onlyFont).body, font);
    assert.equal(proxy.delivery.heldFonts, 1);
    assert.ok(proxy.delivery.errors.some((error) => /at least two.*font/i.test(error)));
  }, { fontTimeoutMs: 700 });
});

test("an upstream font error is recorded and cannot satisfy the setup count", { timeout: 5_000 }, async () => {
  await withTransport((incoming, outgoing) => {
    if (incoming.url === "/broken.woff2") {
      outgoing.writeHead(200, { "content-type": "font/woff2" });
      outgoing.write(font.subarray(0, 3));
      outgoing.flushHeaders();
      setImmediate().then(() => outgoing.destroy());
      return;
    }
    outgoing.writeHead(200, { "content-type": "font/woff2" });
    outgoing.end(font);
  }, async (proxy, read) => {
    let fonts;
    const page = read("/", () => { fonts ??= [read("/a.woff2"), read("/broken.woff2")]; });
    const document = await page;
    const responses = await Promise.allSettled(fonts);
    assert.deepEqual(document.body, html);
    assert.equal(responses[0].status, "fulfilled");
    assert.equal(responses[1].status, "rejected");
    assert.equal(proxy.delivery.heldFonts, 1);
    assert.ok(proxy.delivery.errors.some((error) => /aborted|reset|hang up/i.test(error)));
    assert.ok(proxy.delivery.errors.some((error) => /at least two.*font/i.test(error)));
  }, { fontTimeoutMs: 700 });
});

test("closing a pending setup closes only its owned transports and cancels its deadline", { timeout: 5_000 }, async () => {
  let fontRequested;
  const requested = new Promise((resolve) => { fontRequested = resolve; });
  await withTransport(() => fontRequested(), async (proxy, read) => {
    let pendingFont;
    const page = read("/", () => { pendingFont ??= read("/pending.woff2"); });
    await requested;
    await proxy.close();
    assert.equal((await Promise.allSettled([page, pendingFont])).every((result) => result.status === "rejected"), true);
    await assert.rejects(read("/"), /ECONNREFUSED/);
    await setTimeout(750);
    assert.equal(proxy.delivery.heldFonts, 0);
    assert.equal(proxy.delivery.errors.some((error) => /setup timed out/i.test(error)), false);
  }, { fontTimeoutMs: 700 });
});

test("a disconnected font client cannot count towards two co-released responses", { timeout: 5_000 }, async () => {
  let abandonedRequest;
  let abandon;
  const abandoned = new Promise((resolve) => { abandon = resolve; });
  await withTransport((incoming, outgoing) => {
    outgoing.writeHead(200, { "content-type": "font/woff2" });
    outgoing.end(font);
    if (incoming.url === "/gone.woff2") abandonedRequest.destroy();
  }, async (proxy, read) => {
    let started = false;
    let goodFont;
    const page = read("/", () => {
      if (started) return;
      started = true;
      abandonedRequest = get(`${proxy.origin}/gone.woff2`);
      abandonedRequest.on("error", () => undefined);
      abandonedRequest.once("close", abandon);
    });
    await abandoned;
    goodFont = read("/good.woff2");
    const document = await page;
    assert.deepEqual(document.body, html);
    assert.deepEqual((await goodFont).body, font);
    assert.equal(proxy.delivery.heldFonts, 1);
    assert.ok(proxy.delivery.errors.some((error) => /at least two.*font/i.test(error)));
  }, { fontTimeoutMs: 700 });
});
