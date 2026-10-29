// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement("a", { href }, children) }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/supabase", () => ({ clientIp: () => "203.0.113.44", hashIp: (ip: string) => ip, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false }));

import { POST } from "@/app/api/pub-pal/chat/route";
import { createPalChatSession } from "@/lib/palChatClient";
import { AnswerCard } from "@/components/pal/PalChat";

afterEach(() => { vi.unstubAllEnvs(); document.body.replaceChildren(); });

it("mounts the accepted API answer with price, calories, explicit labels and source", async () => {
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  const ask = createPalChatSession({ fetchImpl: async (_url, init) => POST(new Request("http://localhost/api/pub-pal/chat", init)) });
  const result = await ask("Price and calories for Mixed Olives at The New Inn", "london");
  expect(result?.status).toBe("answered");
  if (!result || result.status !== "answered") throw new Error("The accepted item must produce a card");
  expect(result.cards).toHaveLength(1);
  const host = document.createElement("ul");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AnswerCard, { card: result.cards[0]!, onOpen: vi.fn(), locality: null })));
    expect(host.textContent).toContain("Mixed Olives at The New Inn");
    expect(host.textContent).toContain("£5.00");
    expect(host.textContent).toContain("163 kcal");
    expect(host.textContent).toContain("vegan, vegetarian");
    expect(host.textContent).toContain("Price observed 2026-10-13");
    expect(host.textContent).toContain("Availability unknown");
    expect(host.querySelector('a[href="https://www.newinnealing.com/food-and-drink"]')?.textContent).toContain("official published menu");
    expect(host.querySelector('a[href="/map?sel=venue-17qpap6"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
