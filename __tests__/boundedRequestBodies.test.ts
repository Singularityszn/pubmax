import { beforeEach, describe, expect, it, vi } from "vitest";

// Every write that reads a body reads it through a cap.
//
// A handler that calls `request.formData()`, `request.json()` or `req.text()`
// buffers the WHOLE body before it can look at the size, so a caller who sends
// a few hundred megabytes spends that memory on our function whatever the
// answer turns out to be. The bounded readers in lib/boundedRequest.server.ts
// stop at the cap. Each case below streams a body far over its route's cap with
// no declared length and checks how much of it the handler pulled, because the
// status is often the same either way.

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => "user-1",
    verifyCallerAuth: async () => ({ status: "verified", identity: { id: "user-1" } }),
  };
});
vi.mock("@/lib/eventsRateLimit", () => ({ isEventsRateLimited: async () => false }));
vi.mock("@/lib/clientErrorRateLimit", () => ({ isClientErrorLimited: async () => false }));

const uploadState = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/nightMomentMedia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nightMomentMedia")>();
  return {
    ...actual,
    uploadNightMomentPhoto: async () => {
      uploadState.calls += 1;
      return "never";
    },
  };
});

import { POST as postClientError } from "@/app/api/client-error/route";
import { POST as postEvents } from "@/app/api/events/route";
import { POST as postMoment } from "@/app/api/night-memories/[id]/moments/route";
import { POST as postPintDrop } from "@/app/api/pint-drops/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { parsePriceSubmitPostBody } from "@/lib/priceSubmitPostBody.server";
import { FUNCTION_REQUEST_BODY_LIMIT_BYTES } from "@/lib/uploadBodyLimit";
import { countingRequest } from "@/__tests__/helpers/countingBody";

const MULTIPART = { "content-type": "multipart/form-data; boundary=pubmax-test-boundary" };
const JSON_TYPE = { "content-type": "application/json" };
const HUGE = 12 * 1024 * 1024;
// A bounded read stops within one chunk (and whatever the platform reads
// ahead) of its cap; an unbounded one reads all of HUGE.
const SLACK = 512 * 1024;

beforeEach(() => {
  __resetPintDrops();
  uploadState.calls = 0;
});

describe("upload routes stop reading at the platform's body ceiling", () => {
  it("POST /api/pint-drops refuses a multipart body over the ceiling without buffering it", async () => {
    const { request, pulled } = countingRequest("http://localhost/api/pint-drops", HUGE, MULTIPART);
    const response = await postPintDrop(request);
    expect(response.status).toBe(400);
    expect(pulled()).toBeLessThan(FUNCTION_REQUEST_BODY_LIMIT_BYTES + SLACK);
  });

  it("POST /api/pint-drops caps a JSON body too", async () => {
    const { request, pulled } = countingRequest("http://localhost/api/pint-drops", HUGE, JSON_TYPE);
    const response = await postPintDrop(request);
    expect(response.status).toBe(400);
    expect(pulled()).toBeLessThan(64 * 1024 + SLACK);
  });

  it("the price-submit body reader answers null for a multipart body over the ceiling", async () => {
    const { request, pulled } = countingRequest("http://localhost/api/price-submit", HUGE, MULTIPART);
    expect(await parsePriceSubmitPostBody(request)).toBeNull();
    expect(pulled()).toBeLessThan(FUNCTION_REQUEST_BODY_LIMIT_BYTES + SLACK);
  });

  it("the price-submit body reader caps a JSON body too", async () => {
    const { request, pulled } = countingRequest("http://localhost/api/price-submit", HUGE, JSON_TYPE);
    expect(await parsePriceSubmitPostBody(request)).toBeNull();
    expect(pulled()).toBeLessThan(64 * 1024 + SLACK);
  });

  it("POST /api/night-memories/[id]/moments answers 413 for an oversized photo body and uploads nothing", async () => {
    const { request, pulled } = countingRequest(
      "http://localhost/api/night-memories/m1/moments",
      HUGE,
      MULTIPART,
    );
    const response = await postMoment(request, { params: Promise.resolve({ id: "m1" }) });
    expect(response.status).toBe(413);
    expect(uploadState.calls).toBe(0);
    expect(pulled()).toBeLessThan(FUNCTION_REQUEST_BODY_LIMIT_BYTES + SLACK);
  });
});

describe("beacons stop reading at their 6 KB and 2 KB caps", () => {
  it("POST /api/events stops pulling once the body passes its cap", async () => {
    const { request, pulled } = countingRequest("http://localhost/api/events", HUGE, JSON_TYPE);
    const response = await postEvents(request);
    expect(response.status).toBe(204);
    expect(pulled()).toBeLessThan(SLACK);
  });

  it("POST /api/client-error stops pulling once the body passes its cap", async () => {
    const { request, pulled } = countingRequest("http://localhost/api/client-error", HUGE, JSON_TYPE);
    const response = await postClientError(request);
    expect(response.status).toBe(204);
    expect(pulled()).toBeLessThan(SLACK);
  });
});
