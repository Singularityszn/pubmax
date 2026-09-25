/** Bounded, source-policy-checked fetch for sitemap and menu-PDF resources. */

export class BoundedHarvestResourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BoundedHarvestResourceError";
    this.code = code;
  }
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // A redirect/refusal remains the useful outcome if closing its body fails.
  }
}

async function readBoundedBody(response, maxBytes) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new BoundedHarvestResourceError("invalid-length", "resource has invalid Content-Length");
    }
    if (size > maxBytes) {
      throw new BoundedHarvestResourceError("too-large", `resource exceeds ${maxBytes} byte limit`);
    }
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new BoundedHarvestResourceError("too-large", `resource exceeds ${maxBytes} byte limit`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BoundedHarvestResourceError("too-large", `resource exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetch one small public resource. Every redirect hop must keep the source
 * policy, origin, robots decision, MIME type and byte limit in force.
 */
export async function fetchBoundedHarvestResource({
  url,
  fetchImpl = fetch,
  isAllowedUrl,
  robotsChecker,
  expectedContentTypes,
  maxBytes,
  timeoutMs = 20_000,
  maxRedirects = 3,
  headers = {},
} = {}) {
  if (
    typeof url !== "string" ||
    typeof isAllowedUrl !== "function" ||
    !Array.isArray(expectedContentTypes) ||
    expectedContentTypes.length === 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw new BoundedHarvestResourceError("invalid-request", "bounded resource request is incomplete");
  }

  let initial;
  try {
    initial = new URL(url);
  } catch {
    throw new BoundedHarvestResourceError("policy-refused", `invalid resource URL: ${url}`);
  }
  if (!/^https?:$/.test(initial.protocol) || !isAllowedUrl(initial.href)) {
    throw new BoundedHarvestResourceError("policy-refused", `sourcePolicy refused ${url}`);
  }

  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new BoundedHarvestResourceError("timeout", `resource timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const work = (async () => {
    let current = initial.href;
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const currentUrl = new URL(current);
      if (
        currentUrl.origin !== initial.origin ||
        !/^https?:$/.test(currentUrl.protocol) ||
        !isAllowedUrl(currentUrl.href)
      ) {
        throw new BoundedHarvestResourceError("redirect-refused", `redirect target refused: ${current}`);
      }
      if (robotsChecker) {
        let robots;
        try {
          robots = await robotsChecker(currentUrl.href);
        } catch {
          throw new BoundedHarvestResourceError("robots-refused", `robots check failed for ${current}`);
        }
        if (robots?.allowed !== true) {
          throw new BoundedHarvestResourceError(
            "robots-refused",
            `robots.txt refused ${current}: ${robots?.evidence ?? "no readable decision"}`,
          );
        }
      }

      let response;
      try {
        response = await fetchImpl(current, {
          headers: { "user-agent": "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)", ...headers },
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new BoundedHarvestResourceError("timeout", `resource timed out after ${timeoutMs}ms`);
        }
        throw new BoundedHarvestResourceError("fetch-failed", `resource fetch failed for ${current}: ${error}`);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await cancelBody(response);
        if (!location || redirects === maxRedirects) {
          throw new BoundedHarvestResourceError("redirect-refused", `resource redirect limit exceeded for ${current}`);
        }
        let next;
        try {
          next = new URL(location, currentUrl).href;
        } catch {
          throw new BoundedHarvestResourceError("redirect-refused", `invalid redirect from ${current}`);
        }
        if (new URL(next).origin !== initial.origin || !isAllowedUrl(next)) {
          throw new BoundedHarvestResourceError("redirect-refused", `cross-origin or unlisted redirect refused: ${next}`);
        }
        current = next;
        continue;
      }
      if (!response.ok) {
        await cancelBody(response);
        throw new BoundedHarvestResourceError("http-refused", `resource returned HTTP ${response.status}`);
      }

      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const accepted = expectedContentTypes.some((expected) => contentType === expected.toLowerCase());
      if (!accepted) {
        await cancelBody(response);
        throw new BoundedHarvestResourceError(
          "content-type-refused",
          `resource returned unsupported content type ${contentType || "(missing)"}`,
        );
      }

      const bytes = await readBoundedBody(response, maxBytes);
      return { bytes, finalUrl: currentUrl.href, contentType };
    }
    throw new BoundedHarvestResourceError("redirect-refused", `resource redirect limit exceeded for ${url}`);
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timeoutId);
    if (!controller.signal.aborted) controller.abort();
  }
}
