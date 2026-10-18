// Byte-range answers for a video served from process memory (keyless dev).
// Storage serves its own ranges once a signed URL takes over.

/** Serves the requested byte range, so a player can seek in a long reel. */
export function rangedVideoResponse(bytes: Uint8Array, contentType: string, range: string | null): Response {
  const total = bytes.byteLength;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, "Content-Length": String(total) } });
  }
  let start = match[1] === "" ? Math.max(0, total - Number(match[2])) : Number(match[1]);
  let end = match[1] === "" || match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
  if (start > end || start >= total) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
  }
  start = Math.max(0, start);
  end = Math.max(start, end);
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${total}` },
  });
}
