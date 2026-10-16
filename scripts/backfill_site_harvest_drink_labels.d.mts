type RobotsAsk = (url: string) => Promise<{ allowed: boolean; reason: string; evidence: string }>;

/** One menu URL re-read after robots, with its landing re-asked and a PDF read as bytes. */
export declare function fetchBody(
  url: string,
  options?: { fetchImpl?: typeof fetch; robots?: RobotsAsk },
): Promise<{
  ok: boolean;
  body: string;
  reason?: string;
  sourceFormat?: "html" | "text";
  landedUrl?: string;
}>;
