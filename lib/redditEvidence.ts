/** Public Reddit comment citations, not listing pages or synthetic thread stubs. */
export function isRedditCommentUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["www.reddit.com", "reddit.com"].includes(url.hostname) &&
      /^\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+\/[^/]+\/[a-z0-9]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}
