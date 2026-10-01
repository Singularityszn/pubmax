const CONTEXT_DEV_EXTRACT_DEFAULT_URL = "https://www.fullers.co.uk/event-finder";

export function contextDevExtractEnvelope(
  data: Record<string, unknown>,
  options: { url?: string; partial?: boolean; markdown?: string } = {},
) {
  const url = options.url ?? CONTEXT_DEV_EXTRACT_DEFAULT_URL;
  return {
    status: "ok",
    url,
    data,
    urls_analyzed: [url],
    request_id: "test",
    cache_metadata: { age_ms: 0, status: "miss" },
    metadata: { maxCrawlDepth: 0, numBlocked: 0, numFailed: 0, numSkipped: 0, numSuccess: 1 },
    ...(options.markdown === undefined ? {} : { markdown: options.markdown }),
    ...(options.partial ? { partial: true } : {}),
  };
}

export function contextDevExtractOkBody() {
  const url = "https://www.fullers.co.uk/events";
  return contextDevExtractEnvelope(
    {
      events: [
        {
          title: "Quiz night",
          placeName: "The Red Lion",
          kind: "event",
          sourceUrl: "https://example.com/e/1",
        },
      ],
    },
    {
      url,
      markdown: "# Events\nQuiz night at The Red Lion",
    },
  );
}
