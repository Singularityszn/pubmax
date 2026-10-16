// A request body that counts how much of itself a handler actually read.
//
// A route that buffers a whole body before checking its size reads every byte;
// a bounded read stops at its cap. The status code is often the same either way
// (a fire-and-forget beacon answers 204 to both), so the only honest proof that
// a cap is real is how far into the stream the handler went.

const CHUNK_BYTES = 64 * 1024;

export type CountingBody = {
  stream: ReadableStream<Uint8Array>;
  pulled: () => number;
};

export function countingBody(totalBytes: number, fill = 0x61): CountingBody {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(CHUNK_BYTES, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(fill));
    },
  });
  return { stream, pulled: () => sent };
}

/** A POST whose body is a counting stream, with no declared Content-Length. */
export function countingRequest(
  url: string,
  totalBytes: number,
  headers: Record<string, string> = {},
): { request: Request; pulled: () => number } {
  const body = countingBody(totalBytes);
  const request = new Request(url, {
    method: "POST",
    headers,
    body: body.stream,
    // Node's fetch requires this for a streamed request body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, pulled: body.pulled };
}
