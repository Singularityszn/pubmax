import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetPintDrops } from "@/lib/pintDrops";
import { importPubList } from "@/lib/pubListImport.server";

const catalog = {
  curated: [{ id: "harp", name: "The Harp", area: "Covent Garden" }],
  national: [{ id: "bell", name: "The Blue Bell", area: "York" }],
};

beforeEach(() => {
  __resetPintDrops();
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OPENROUTER_MODEL", "test/extraction");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_LIST_IMPORT", "1000");
  vi.stubEnv("PUBMAX_ALERT_WEBHOOK_URL", "");
  vi.stubEnv("POSTHOG_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
  vi.stubEnv("ARIZE_API_KEY", "");
  vi.stubEnv("ARIZE_SPACE_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pub list import with the OpenRouter fallback", () => {
  it("matches prose through the default extractor and drops invented pubs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ items: [
        { name: "The Harp", areaHint: "Covent Garden" },
        { name: "The Blue Bell", areaHint: "York" },
        { name: "The Invented Arms", areaHint: "" },
      ] }) } }],
    }));

    const result = await importPubList({
      text: "Try The Harp in Covent Garden and The Blue Bell in York.",
      sourceUrl: "https://www.tiktok.com/@pubs/video/123",
    }, catalog);

    expect(result.items).toMatchObject([
      { name: "The Harp", state: "matched", venue: { id: "harp" } },
      { name: "The Blue Bell", state: "matched", venue: { id: "bell", price: null } },
    ]);
    expect(result.items).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const options = fetch.mock.calls[0]?.[1];
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      model: "test/extraction",
      temperature: 0,
      max_tokens: 3000,
      provider: { require_parameters: true, zdr: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: {
            type: "object", required: ["items"], additionalProperties: false,
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object", required: ["name", "areaHint"], additionalProperties: false,
                  properties: { name: { type: "string" }, areaHint: { type: "string" } },
                },
              },
            },
          },
        },
      },
    });
    const schema = body.response_format.json_schema.schema;
    expect(schema.properties.items).not.toHaveProperty("maxItems");
    expect(schema.properties.items.items.properties.name).not.toHaveProperty("maxLength");
    expect(schema.properties.items.items.properties.name).not.toHaveProperty("minLength");
    expect(body.messages[1]).toEqual({
      role: "user", content: "Try The Harp in Covent Garden and The Blue Bell in York.",
    });
    expect(String(options?.body)).not.toContain("tiktok.com");
    expect(options?.cache).toBe("no-store");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses deterministic lists without spending the model budget", async () => {
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_LIST_IMPORT", "1");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: '{"items":[{"name":"The Harp","areaHint":""}]}' } }],
    }));

    expect((await importPubList({ text: "The Harp\nThe Blue Bell" }, catalog)).items)
      .toMatchObject([{ state: "matched" }, { state: "matched" }]);
    expect(fetch).not.toHaveBeenCalled();
    expect((await importPubList({ text: "Try The Harp." }, catalog)).items)
      .toMatchObject([{ state: "matched", venue: { id: "harp" } }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await importPubList({ text: "Try The Harp again." }, catalog)).items)
      .toMatchObject([{ state: "unmatched", rawLine: "Try The Harp again." }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["", "   "])("keeps deterministic results when no model key is available: %j", async (key) => {
    vi.stubEnv("OPENROUTER_API_KEY", key);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed."));

    expect((await importPubList({ text: "The Harp" }, catalog)).items)
      .toMatchObject([{ state: "matched", venue: { id: "harp" } }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps deterministic results when the model budget is closed", async () => {
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PUB_LIST_IMPORT", "0");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed."));

    expect((await importPubList({ text: "The Harp" }, catalog)).items)
      .toMatchObject([{ state: "matched", venue: { id: "harp" } }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "not json", JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
    JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
    JSON.stringify({ choices: [{ message: { content: "[]" } }] }),
    JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }),
    JSON.stringify({ choices: [{ message: { content: '[{"name":"The Harp"}]' } }] }),
  ])("keeps the known pub after an unusable model response: %s", async (response) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(response));

    expect((await importPubList({ text: "The Harp" }, catalog)).items)
      .toMatchObject([{ state: "matched", venue: { id: "harp" } }]);
  });

  it("releases refused provider responses without reading their content", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status: 429 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    expect((await importPubList({ text: "The Harp" }, catalog)).items)
      .toMatchObject([{ state: "matched", venue: { id: "harp" } }]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces the 40-item limit locally even if the model ignores the prompt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ items: [
        { name: "The Harp", areaHint: "" },
        ...Array.from({ length: 40 }, () => ({ name: "Invented Arms", areaHint: "" })),
      ] }) } }],
    }));

    expect((await importPubList({ text: "Try The Harp." }, catalog)).items)
      .toMatchObject([{ state: "unmatched", rawLine: "Try The Harp." }]);
  });

  it("returns the deterministic result when the provider times out", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      expect(ms).toBe(10_000);
      return AbortSignal.abort(new DOMException("Timed out", "TimeoutError"));
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
      options?.signal?.throwIfAborted();
      throw new Error("The provider request must have a deadline.");
    });

    expect((await importPubList({ text: "The Harp" }, catalog)).items)
      .toMatchObject([{ state: "matched", venue: { id: "harp" } }]);
  });

  it.each([false, true])("traces no pasted input, source or output when the provider fails: %s", async (fails) => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    vi.stubEnv("ARIZE_API_KEY", "test-arize");
    vi.stubEnv("ARIZE_SPACE_KEY", "test-space");
    const fetch = vi.spyOn(globalThis, "fetch");
    const text = "Try The Harp. Private message 987654.";
    if (fails) fetch.mockRejectedValue(new Error(text));
    else fetch.mockResolvedValue(Response.json({
      choices: [{ message: { content: '{"items":[{"name":"The Harp","areaHint":""}]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }));

    try {
      await importPubList({ text, sourceUrl: "https://www.instagram.com/@private" }, catalog);
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]?.attributes["metadata.route"]).toBe("api/pub-list-import");
      const captured = JSON.stringify(spans.map(({ attributes, events, status }) => ({ attributes, events, status })));
      expect(captured).not.toContain("Private message");
      expect(captured).not.toContain("The Harp");
      expect(captured).not.toContain("instagram.com");
      expect(spans[0]?.attributes).not.toHaveProperty("input.value");
      expect(spans[0]?.attributes).not.toHaveProperty("output.value");
      if (!fails) expect(spans[0]?.attributes["llm.token_count.total"]).toBe(120);
    } finally {
      trace.disable();
      await provider.shutdown();
    }
  });
});
