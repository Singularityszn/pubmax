import { expect, it } from "vitest";
import { generatePublicEvening } from "@/lib/chatgpt/generation.server";
import { parsePlanGenerationRequest } from "@/lib/planGenerationRequest";

const now = new Date("2026-10-21T12:00:00.000Z");
const caller = new Request("http://localhost/api/mcp", {
  headers: { authorization: "Bearer private", cookie: "private=value" },
});

it.each([
  ["2026-10-22T17:30:00+01:00", "2026-10-22T16:30:00.000Z", "2026-10-22T22:30:00.000Z"],
  ["2026-10-22T21:00:00+01:00", "2026-10-22T20:00:00.000Z", "2026-10-23T02:00:00.000Z"],
  ["2026-10-22T23:00:00+01:00", "2026-10-22T22:00:00.000Z", "2026-10-23T04:00:00.000Z"],
  ["2026-10-22T01:30:00+01:00", "2026-10-22T00:30:00.000Z", "2026-10-22T06:30:00.000Z"],
])("preserves the supplied start %s with the shared open-ended safety window", async (startsAt, canonical, endsAt) => {
  const result = await generatePublicEvening({ request: "Three Soho pubs", startsAt, includeHistory: false }, caller, async (request) => {
    expect(request.headers.get("authorization")).toBeNull();
    expect(request.headers.get("cookie")).toBeNull();
    const parsed = await parsePlanGenerationRequest(request, now);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return Response.json({ error: parsed.message }, { status: 400 });
    return Response.json(parsed.value);
  });
  expect(result).toMatchObject({ intake: {
    handoff: { timeWindow: { end: null, exactStartIso: canonical } },
    routeWindow: { startsAt: canonical, endsAt },
  } });
});

it.each([
  ["2026-10-20T21:00:00+01:00", "INTAKE_START_NOT_FUTURE"],
  ["2026-11-21T21:00:00Z", "INTAKE_START_OUT_OF_RANGE"],
])("retains shared start validation for %s", async (startsAt, code) => {
  await expect(generatePublicEvening({ request: "Three Soho pubs", startsAt, includeHistory: false }, caller, async (request) => {
    const parsed = await parsePlanGenerationRequest(request, now);
    if (parsed.ok) return Response.json({ accepted: true });
    return Response.json({ error: parsed.message, code: parsed.code }, { status: 400 });
  })).rejects.toMatchObject({ code });
});

it("retains the supported evening hours and the undated request path", async () => {
  await expect(generatePublicEvening({ request: "Three Soho pubs", startsAt: "2026-10-22T10:00:00Z", includeHistory: false }, caller,
    async () => { throw new Error("Unsupported hours reached the generator"); },
  )).rejects.toThrow("Choose a start between");
  const result = await generatePublicEvening({ request: "Three Soho pubs", includeHistory: false }, caller,
    async (request) => Response.json(await request.json()),
  );
  expect(result).toEqual({ query: "Three Soho pubs", cityId: "london", context: { stopCount: 3 } });
});
