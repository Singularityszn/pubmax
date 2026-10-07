import { describe, expect, it, vi } from "vitest";

import { answerFromBody } from "@/lib/conciergeAskClient";
import { confirmPalMemoryProposal } from "@/lib/palMemoryConfirmClient";

const AUTH = { userId: "11111111-1111-4111-8111-111111111111", accessToken: "token-1" };

const card = (id: string) => ({ id, memoryKind: "drink_preference" as const, value: "Cask ale" });

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

    const result = await confirmPalMemoryProposal(card("card-1"), AUTH, request);

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
    expect(await confirmPalMemoryProposal(card("card-2"), null, request)).toMatchObject({
      ok: false,
      needsSignIn: true,
    });
    expect(request).not.toHaveBeenCalled();

    const expired = vi.fn(async () => Response.json({ error: "Sign in to confirm Pal memory." }, { status: 401 }));
    expect(await confirmPalMemoryProposal(card("card-3"), AUTH, expired)).toMatchObject({
      ok: false,
      needsSignIn: true,
    });
  });

  it("reports a refused save so the card stays and nothing is claimed", async () => {
    const refused = vi.fn(async () =>
      Response.json({ error: "We couldn't save that memory." }, { status: 503 }),
    );
    const result = await confirmPalMemoryProposal(card("card-4"), AUTH, refused);
    expect(result).toMatchObject({ ok: false });
    expect(result?.ok === false && result.needsSignIn).toBeFalsy();
  });

  it("sends one POST for a card tapped twice while saving, and lets a failed card be tried again", async () => {
    let release: (response: Response) => void = () => {};
    const slow = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );

    const first = confirmPalMemoryProposal(card("card-5"), AUTH, slow);
    const second = await confirmPalMemoryProposal(card("card-5"), AUTH, slow);
    expect(second).toBeNull();
    release(Response.json({ memory: { id: "m-5" } }, { status: 201 }));
    expect(await first).toEqual({ ok: true });
    expect(await confirmPalMemoryProposal(card("card-5"), AUTH, slow)).toBeNull();
    expect(slow).toHaveBeenCalledTimes(1);

    const failing = vi.fn<typeof fetch>(async () => Response.json({ error: "We couldn't save that memory." }, { status: 503 }));
    expect(await confirmPalMemoryProposal(card("card-6"), AUTH, failing)).toMatchObject({ ok: false });
    const recovered = vi.fn<typeof fetch>(async () => Response.json({ memory: { id: "m-6" } }, { status: 201 }));
    expect(await confirmPalMemoryProposal(card("card-6"), AUTH, recovered)).toEqual({ ok: true });
    expect(recovered).toHaveBeenCalledTimes(1);
  });
});
