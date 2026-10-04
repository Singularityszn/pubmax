import { describe, expect, it, vi } from "vitest";

import { answerFromBody } from "@/lib/conciergeAskClient";
import { confirmPalMemoryProposal } from "@/lib/palMemoryConfirmClient";

const AUTH = { userId: "11111111-1111-4111-8111-111111111111", accessToken: "token-1" };

describe("Pal memory card on the client", () => {
  it("keeps a memory card from the chat body and drops one with a kind outside the vocabulary", () => {
    const answer = answerFromBody({
      answer: "I can remember that if you confirm it.",
      proposals: [
        { id: "remember:1", kind: "remember_memory", label: "Remember: Cask ale", memoryKind: "drink_preference", value: "Cask ale" },
        { id: "remember:2", kind: "remember_memory", label: "Remember: £3 pints", memoryKind: "price_fact", value: "£3 pints" },
        { id: "remember:3", kind: "remember_memory", label: "Remember", memoryKind: "drink_preference", value: "  " },
      ],
    });
    expect(answer.status === "answered" && answer.proposals).toEqual([
      { id: "remember:1", kind: "remember_memory", label: "Remember: Cask ale", memoryKind: "drink_preference", value: "Cask ale" },
    ]);
  });

  it("saves only through the person's own POST to the memories route", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ memory: { id: "m-1" } }, { status: 201 }));

    const result = await confirmPalMemoryProposal({ memoryKind: "drink_preference", value: "Cask ale" }, AUTH, request);

    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    const [input, init] = request.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(input).toBe("/api/pub-pal/memories");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token-1");
    expect(JSON.parse(String(init.body))).toEqual({ kind: "drink_preference", value: "Cask ale" });
  });

  it("asks a signed-out person to sign in and sends nothing", async () => {
    const request = vi.fn(async () => Response.json({}));
    expect(await confirmPalMemoryProposal({ memoryKind: "drink_preference", value: "Cask ale" }, null, request)).toMatchObject({
      ok: false,
      needsSignIn: true,
    });
    expect(request).not.toHaveBeenCalled();

    const expired = vi.fn(async () => Response.json({ error: "Sign in to confirm Pal memory." }, { status: 401 }));
    expect(await confirmPalMemoryProposal({ memoryKind: "drink_preference", value: "Cask ale" }, AUTH, expired)).toMatchObject({
      ok: false,
      needsSignIn: true,
    });
  });

  it("reports a refused save so the card stays and nothing is claimed", async () => {
    const refused = vi.fn(async () =>
      Response.json({ error: "Pal memory could not be saved." }, { status: 503 }),
    );
    const result = await confirmPalMemoryProposal({ memoryKind: "drink_preference", value: "Cask ale" }, AUTH, refused);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.needsSignIn).toBeFalsy();
  });
});
