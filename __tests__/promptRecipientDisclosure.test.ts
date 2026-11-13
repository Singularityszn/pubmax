import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const { deliveries } = vi.hoisted(() => ({
  deliveries: [] as Array<{ url: string; payload: unknown }>,
}));

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/paidSpendBudget.server", () => ({ paidSpendBudgetRefusal: async () => null }));
vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: class {
    constructor(private readonly options: { baseURL: string }) {}
    async systemOne(payload: unknown) {
      deliveries.push({ url: this.options.baseURL, payload });
      return { model: "test", answers: { safe: { type: "noul", noul: 0.9 } } };
    }
  },
}));
vi.mock("@opentelemetry/exporter-trace-otlp-proto", () => ({
  OTLPTraceExporter: class {
    constructor(private readonly options: { url: string }) {}
    export(spans: ReadableSpan[], callback: (result: { code: number }) => void) {
      deliveries.push({ url: this.options.url, payload: spans.map((span) => span.attributes) });
      callback({ code: 0 });
    }
    async shutdown() {}
    async forceFlush() {}
  },
}));

import PrivacyPage from "@/app/privacy/page";
import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import { flushArizeTracing, registerArizeTracing, traceArizeModelCall } from "@/lib/observability/arize";

afterEach(() => vi.unstubAllEnvs());

it("discloses the destinations that receive safety messages and prompt traces", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-key");
  vi.stubEnv("TYPESAFE_BASE_URL", "");
  vi.stubEnv("ARIZE_API_KEY", "test-key");
  vi.stubEnv("ARIZE_SPACE_KEY", "test-space");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const message = "A quiet pub near the Lamb and Flag";

  const judgment = await systemOneOutcome(
    { message },
    { safe: { type: "noul", instructions: "Is the request safe?" } },
    { lane: "typesafe" },
  );
  expect(judgment.status).toBe("ok");
  await registerArizeTracing();
  expect(await traceArizeModelCall({
    route: "api/pub-pal/chat", model: "test", provider: "anthropic", prompt: message,
    call: async () => "Two quiet picks.",
  })).toBe("Two quiet picks.");
  await flushArizeTracing();

  const promptHosts = new Set(deliveries
    .filter((delivery) => JSON.stringify(delivery.payload).includes(message))
    .map((delivery) => new URL(delivery.url).host));
  expect([...promptHosts].sort()).toEqual(["api.typesafe.ai", "otlp.arize.com"]);
  const page = new JSDOM(renderToStaticMarkup(createElement(PrivacyPage))).window.document;
  const disclosed = page.querySelector('[aria-labelledby="third"]')?.textContent ?? "";
  for (const host of promptHosts) expect(disclosed).toContain(host);
});
