import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The email provider seam (lib/emailProvider.ts): env-based selection mirrors
// storeBackend.selectStore and pushProvider.selectPushProvider. No live Resend:
// selection is driven with vi.stubEnv, exactly like the push suite, and the
// Resend transport is driven through an injected fetch.
import { isEmailProviderConfigured } from "@/lib/emailProviderConfigured.mjs";
import {
  createResendEmailProvider,
  isResendConfigured,
  noopEmailProvider,
  RESEND_SEND_URL,
  resendEmailProvider,
  selectEmailProvider,
  type EmailMessage,
  type ResendConfig,
} from "@/lib/emailProvider";

const RESEND_ENV = {
  RESEND_API_KEY: "re_test_123",
  EMAIL_FROM: "hello@pubmaxxing.com",
};

const CONFIG: ResendConfig = {
  apiKey: "re_secret_key_do_not_log_7f3a",
  from: "PUBMAXX <hello@pubmaxxing.com>",
};

function stubResendEnv(): void {
  for (const [k, v] of Object.entries(RESEND_ENV)) vi.stubEnv(k, v);
}

const MSG: EmailMessage = {
  to: "drinker@example.com",
  subject: "Your week in pints",
  html: "<p>hi</p>",
  text: "hi",
};

type FetchCall = { input: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch double that records every call and answers from `answer`. */
function recordingFetch(answer: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const call = { input, init };
    calls.push(call);
    return answer(call);
  });
  return { fetch, calls };
}

function headersOf(call: FetchCall | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

function bodyOf(call: FetchCall | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>;
}

// Every line any logger wrote during a test, joined, so a test can prove what
// never reached a log.
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isEmailProviderConfigured", () => {
  it("is false when both keys are absent, the way the digest script gates", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(isEmailProviderConfigured()).toBe(false);
    expect(isResendConfigured()).toBe(false);
  });

  it("is true when both keys are set, the way the digest script gates", () => {
    stubResendEnv();
    expect(isEmailProviderConfigured()).toBe(true);
    expect(isResendConfigured()).toBe(true);
  });
});

describe("isResendConfigured", () => {
  it("is false unless both RESEND_API_KEY and EMAIL_FROM are present", () => {
    vi.stubEnv("RESEND_API_KEY", RESEND_ENV.RESEND_API_KEY);
    vi.stubEnv("EMAIL_FROM", "");
    expect(isResendConfigured()).toBe(false);
  });

  it("is true when both keys are set", () => {
    stubResendEnv();
    expect(isResendConfigured()).toBe(true);
  });
});

describe("selectEmailProvider", () => {
  it("chooses the no-op provider when Resend is unconfigured", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(selectEmailProvider()).toBe(noopEmailProvider);
  });

  it("chooses the Resend provider once both env keys exist", () => {
    stubResendEnv();
    expect(selectEmailProvider()).toBe(resendEmailProvider);
  });
});

describe("noopEmailProvider", () => {
  it("reports every message as skipped, in input order, and never throws", async () => {
    const results = await noopEmailProvider.send([
      MSG,
      { ...MSG, to: "second@example.com" },
    ]);
    expect(results).toEqual([
      { to: "drinker@example.com", status: "skipped", reason: "email_provider_not_configured" },
      { to: "second@example.com", status: "skipped", reason: "email_provider_not_configured" },
    ]);
  });

  it("returns [] for no messages", async () => {
    expect(await noopEmailProvider.send([])).toEqual([]);
  });
});

describe("resendEmailProvider keyless", () => {
  it("answers exactly as the no-op does and never calls fetch", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const results = await resendEmailProvider.send([MSG]);
    expect(results).toEqual(await noopEmailProvider.send([MSG]));
    expect(results[0]).toMatchObject({ status: "skipped", reason: "email_provider_not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logged.join("\n")).toMatch(/email provider not configured, skipping/);
  });

  it("skips when the key is present but blank after trimming", async () => {
    vi.stubEnv("RESEND_API_KEY", "   ");
    vi.stubEnv("EMAIL_FROM", RESEND_ENV.EMAIL_FROM);
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { id: "x" }));
    const provider = createResendEmailProvider({ fetch });
    const results = await provider.send([MSG]);
    expect(results[0]?.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("reads the env at send time, so importing the module never throws or sends", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.resetModules();
    const fresh = await import("@/lib/emailProvider");
    expect(fresh.selectEmailProvider()).toBe(fresh.noopEmailProvider);
  });
});

describe("resendEmailProvider transport", () => {
  it("POSTs one request per message to the Resend endpoint and returns the id", async () => {
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }),
    );
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    const results = await provider.send([MSG]);

    expect(results).toEqual([
      { to: MSG.to, status: "sent", id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(RESEND_SEND_URL);
    expect(RESEND_SEND_URL).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    const headers = headersOf(calls[0]);
    expect(headers.Authorization).toBe(`Bearer ${CONFIG.apiKey}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toMatch(/\S/);
    expect(bodyOf(calls[0])).toEqual({
      from: CONFIG.from,
      to: [MSG.to],
      subject: MSG.subject,
      html: MSG.html,
      text: MSG.text,
    });
  });

  it("reads the key and sender from the env when no config is injected", async () => {
    vi.stubEnv("RESEND_API_KEY", ` ${RESEND_ENV.RESEND_API_KEY}\n`);
    vi.stubEnv("EMAIL_FROM", RESEND_ENV.EMAIL_FROM);
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { id: "abc-1" }));
    const provider = createResendEmailProvider({ fetch });

    const results = await provider.send([MSG]);

    expect(results[0]).toEqual({ to: MSG.to, status: "sent", id: "abc-1" });
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${RESEND_ENV.RESEND_API_KEY}`);
    expect(bodyOf(calls[0]).from).toBe(RESEND_ENV.EMAIL_FROM);
  });

  it("sends reply_to and custom email headers when the message carries them", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { id: "abc-2" }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    await provider.send([
      {
        ...MSG,
        replyTo: "crew@pubmaxxing.com",
        headers: { "List-Unsubscribe": "<https://pubmaxxing.com/unsubscribe/t>" },
      },
    ]);

    const body = bodyOf(calls[0]);
    expect(body.reply_to).toBe("crew@pubmaxxing.com");
    expect(body.headers).toEqual({ "List-Unsubscribe": "<https://pubmaxxing.com/unsubscribe/t>" });
  });

  it("sends the Idempotency-Key header only when the caller supplies one", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { id: "abc-3" }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    await provider.send([
      { ...MSG, idempotencyKey: "plan-reminder/plan_42/user_7" },
      { ...MSG, to: "second@example.com" },
    ]);

    expect(headersOf(calls[0])["Idempotency-Key"]).toBe("plan-reminder/plan_42/user_7");
    expect(headersOf(calls[1])).not.toHaveProperty("Idempotency-Key");
    // The key is a request header, never part of the email itself.
    expect(JSON.stringify(bodyOf(calls[0]))).not.toContain("plan-reminder");
  });

  it("sends messages one after another and answers in input order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { fetch, calls } = recordingFetch(async (call) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const to = (bodyOf(call).to as string[])[0];
      return jsonResponse(200, { id: `id-${to?.split("@")[0]}` });
    });
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    const results = await provider.send([
      { ...MSG, to: "one@example.com" },
      { ...MSG, to: "two@example.com" },
      { ...MSG, to: "three@example.com" },
    ]);

    expect(maxInFlight).toBe(1);
    expect(calls).toHaveLength(3);
    expect(results.map((r) => [r.to, r.status, r.id])).toEqual([
      ["one@example.com", "sent", "id-one"],
      ["two@example.com", "sent", "id-two"],
      ["three@example.com", "sent", "id-three"],
    ]);
  });

  it("returns [] and calls nothing for no messages", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { id: "x" }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });
    expect(await provider.send([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("counts a 2xx with an unreadable body as sent, without an id", async () => {
    const { fetch } = recordingFetch(() => new Response("not json", { status: 200 }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });
    expect(await provider.send([MSG])).toEqual([{ to: MSG.to, status: "sent" }]);
  });
});

describe("resendEmailProvider failures", () => {
  it("marks a recipient Resend refuses on the `to` field as invalid", async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(422, {
        statusCode: 422,
        name: "validation_error",
        message:
          "Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.",
      }),
    );
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    const results = await provider.send([MSG]);

    expect(results).toEqual([{ to: MSG.to, status: "invalid", reason: "resend_invalid_recipient" }]);
  });

  it("marks a malformed address invalid without sending it", async () => {
    const { fetch, calls } = recordingFetch(() => jsonResponse(200, { id: "x" }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    const results = await provider.send([{ ...MSG, to: "not-an-address" }]);

    expect(results).toEqual([{ to: "not-an-address", status: "invalid", reason: "invalid_recipient" }]);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "validation_error", "API key is invalid"],
    [403, "validation_error", "The pubmaxxing.com domain is not verified."],
    [403, "validation_error", "You can only send testing emails to your own email address (owner@example.com)."],
    [409, "concurrent_idempotent_requests", "Another request is in progress."],
    [429, "rate_limit_exceeded", "Too many requests."],
    [429, "daily_quota_exceeded", "You have exceeded your daily email sending quota."],
    [500, "application_error", "An unexpected error occurred."],
  ])("treats a %i %s as a retryable error, never an invalid address", async (status, name, message) => {
    const { fetch } = recordingFetch(() => jsonResponse(status, { statusCode: status, name, message }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    const results = await provider.send([MSG]);

    expect(results).toEqual([{ to: MSG.to, status: "error", reason: `resend_http_${status}_${name}` }]);
    // Resend's own message can echo an address, so it never reaches a log.
    expect(logged.join("\n")).not.toContain(message);
  });

  it("names only the HTTP status when the error body is not Resend's shape", async () => {
    const { fetch } = recordingFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });
    expect(await provider.send([MSG])).toEqual([
      { to: MSG.to, status: "error", reason: "resend_http_502" },
    ]);
  });

  it("keeps sending the rest of a batch after one message fails", async () => {
    let n = 0;
    const { fetch, calls } = recordingFetch(() => {
      n += 1;
      return n === 1
        ? jsonResponse(500, { name: "application_error", message: "boom" })
        : jsonResponse(200, { id: "ok-2" });
    });
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    const results = await provider.send([MSG, { ...MSG, to: "second@example.com" }]);

    expect(calls).toHaveLength(2);
    expect(results.map((r) => r.status)).toEqual(["error", "sent"]);
  });

  it("aborts a request that passes the deadline and reports a timeout", async () => {
    let sawSignal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          sawSignal = init.signal ?? undefined;
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG, timeoutMs: 5 });

    const results = await provider.send([MSG]);

    expect(sawSignal?.aborted).toBe(true);
    expect(results).toEqual([{ to: MSG.to, status: "error", reason: "resend_timeout" }]);
  });

  it("reports a network failure as a retryable request failure", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    expect(await provider.send([MSG])).toEqual([
      { to: MSG.to, status: "error", reason: "resend_request_failed" },
    ]);
    expect(logged.join("\n")).toContain("fetch failed");
  });

  it("never throws, even when the transport throws a non-Error", async () => {
    const fetch = vi.fn(async () => {
      throw "socket hang up";
    });
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });
    await expect(provider.send([MSG])).resolves.toEqual([
      { to: MSG.to, status: "error", reason: "resend_request_failed" },
    ]);
  });
});

describe("resendEmailProvider logs", () => {
  it("never logs the API key or a full recipient address", async () => {
    let n = 0;
    const fetch = vi.fn(async (_input: string, init: RequestInit) => {
      n += 1;
      if (n === 1) return jsonResponse(200, { id: "ok-1" });
      if (n === 2) return jsonResponse(403, { name: "validation_error", message: "domain not verified" });
      // A transport error that echoes the key and the auth header: the worst case.
      const auth = (init.headers as Record<string, string>).Authorization;
      throw new Error(`connect failed with ${auth} using key ${CONFIG.apiKey}`);
    });
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });

    const results = await provider.send([
      { ...MSG, to: "first.person@example.com" },
      { ...MSG, to: "second.person@example.com" },
      { ...MSG, to: "third.person@example.com" },
      { ...MSG, to: "fourth person@example" },
    ]);

    expect(results.map((r) => r.status)).toEqual(["sent", "error", "error", "invalid"]);
    const all = logged.join("\n");
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(CONFIG.apiKey);
    for (const address of [
      "first.person@example.com",
      "second.person@example.com",
      "third.person@example.com",
      "fourth person@example",
    ]) {
      expect(all).not.toContain(address);
    }
    // The masked form is what an operator reads instead.
    expect(all).toContain("s…@example.com");
    expect(all).toContain("t…@example.com");
    // The batch is summarised once, with counts only.
    expect(all).toMatch(/"event":"email_provider.batch".*"messages":4.*"sent":1.*"invalid":1.*"failed":2/);
  });

  it("never logs the idempotency key", async () => {
    const { fetch } = recordingFetch(() => jsonResponse(500, { name: "application_error" }));
    const provider = createResendEmailProvider({ fetch, config: () => CONFIG });
    await provider.send([{ ...MSG, idempotencyKey: "digest/2026-11-02/user_99" }]);
    expect(logged.join("\n")).not.toContain("digest/2026-11-02/user_99");
  });
});
