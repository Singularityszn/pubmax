import { describe, expect, it, vi } from "vitest";

import {
  checkPhoneCode,
  displayPhoneNumber,
  parsePhoneCode,
  parsePhoneNumber,
  PHONE_CODE_CHECK_ERROR_MESSAGE,
  PHONE_CODE_FORMAT_MESSAGE,
  PHONE_CODE_RATE_LIMIT_MESSAGE,
  PHONE_CODE_SEND_ERROR_MESSAGE,
  PHONE_CODE_SENT_MESSAGE,
  PHONE_CODE_WRONG_MESSAGE,
  PHONE_NUMBER_INVALID_MESSAGE,
  requestPhoneCode,
  type PhoneSignInAuthClient,
} from "@/lib/phoneSignIn";

type Session = { access_token: string; refresh_token: string };

function client(overrides: Partial<PhoneSignInAuthClient<Session>> = {}): PhoneSignInAuthClient<Session> {
  return {
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    ...overrides,
  };
}

describe("parsePhoneNumber", () => {
  it.each([
    ["07700 900123", "+447700900123"],
    ["07700-900-123", "+447700900123"],
    ["+44 7700 900123", "+447700900123"],
    ["+44 (0) 7700 900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
    [" (07700) 900.123 ", "+447700900123"],
  ])("reads %s as a UK mobile", (input, expected) => {
    expect(parsePhoneNumber(input)).toBe(expected);
  });

  it.each([
    "",
    "7700900123",
    "020 7946 0123",
    "0770090012",
    "077009001234",
    "+1 415 555 0100",
    "+33 6 12 34 56 78",
    "07700 9OO123",
    "+44 20 7946 0123",
  ])("refuses %j, which is not a UK mobile", (input) => {
    expect(parsePhoneNumber(input)).toBeNull();
  });
});

describe("displayPhoneNumber", () => {
  it("prints the number the way a person wrote it, not as E.164", () => {
    expect(displayPhoneNumber("+447700900123")).toBe("07700 900 123");
  });
});

describe("parsePhoneCode", () => {
  it("accepts 6 to 10 digits and ignores spaces", () => {
    expect(parsePhoneCode("123 456")).toBe("123456");
    expect(parsePhoneCode("1234567890")).toBe("1234567890");
  });

  it.each(["12345", "12345678901", "12a456", ""])("refuses %j", (input) => {
    expect(parsePhoneCode(input)).toBeNull();
  });
});

describe("requestPhoneCode", () => {
  it("sends one SMS code to the E.164 number and makes the account on first use", async () => {
    const auth = client();
    await expect(requestPhoneCode(auth, "07700 900123")).resolves.toEqual({
      status: "sent",
      message: PHONE_CODE_SENT_MESSAGE,
    });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      phone: "+447700900123",
      options: { shouldCreateUser: true, channel: "sms" },
    });
  });

  it("never spends a text on a number that is not a UK mobile", async () => {
    const auth = client();
    await expect(requestPhoneCode(auth, "+1 415 555 0100")).resolves.toEqual({
      status: "invalid",
      message: PHONE_NUMBER_INVALID_MESSAGE,
    });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("says when the number has asked too often", async () => {
    const auth = client({
      signInWithOtp: vi.fn().mockResolvedValue({ error: { status: 429, code: "over_sms_send_rate_limit" } }),
    });
    await expect(requestPhoneCode(auth, "07700900123")).resolves.toEqual({
      status: "rate_limited",
      message: PHONE_CODE_RATE_LIMIT_MESSAGE,
    });
  });

  it.each([
    { code: "phone_provider_disabled", status: 400 },
    { code: "sms_send_failed", status: 500 },
    { status: 502 },
  ])("owns a failure on our side (%j)", async (error) => {
    const auth = client({ signInWithOtp: vi.fn().mockResolvedValue({ error }) });
    await expect(requestPhoneCode(auth, "07700900123")).resolves.toEqual({
      status: "error",
      message: PHONE_CODE_SEND_ERROR_MESSAGE,
    });
  });

  it.each([
    { code: "user_banned", status: 400 },
    { code: "signup_disabled", status: 422 },
    { code: "otp_disabled", status: 422 },
  ])("answers an account-state refusal (%j) with the sent words, so it is no oracle", async (error) => {
    const auth = client({ signInWithOtp: vi.fn().mockResolvedValue({ error }) });
    await expect(requestPhoneCode(auth, "07700900123")).resolves.toEqual({
      status: "sent",
      message: PHONE_CODE_SENT_MESSAGE,
    });
  });

  it("answers a thrown network failure as our fault", async () => {
    const auth = client({ signInWithOtp: vi.fn().mockRejectedValue(new TypeError("offline")) });
    await expect(requestPhoneCode(auth, "07700900123")).resolves.toMatchObject({ status: "error" });
  });
});

describe("checkPhoneCode", () => {
  const session = { access_token: "a", refresh_token: "r" };

  it("hands back the session for the right code", async () => {
    const auth = client({ verifyOtp: vi.fn().mockResolvedValue({ data: { session }, error: null }) });
    await expect(checkPhoneCode(auth, "07700 900123", "123 456")).resolves.toEqual({
      status: "signed_in",
      session,
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: "+447700900123", token: "123456", type: "sms" });
  });

  it("refuses a malformed code without asking Supabase", async () => {
    const auth = client();
    await expect(checkPhoneCode(auth, "07700900123", "12")).resolves.toEqual({
      status: "invalid",
      message: PHONE_CODE_FORMAT_MESSAGE,
    });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("gives a wrong code and an expired code one answer", async () => {
    const auth = client({
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: { status: 403, code: "otp_expired" } }),
    });
    await expect(checkPhoneCode(auth, "07700900123", "123456")).resolves.toEqual({
      status: "wrong_code",
      message: PHONE_CODE_WRONG_MESSAGE,
    });
  });

  it("says banned only after the right code has been checked", async () => {
    const auth = client({
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: { status: 403, code: "user_banned" } }),
    });
    await expect(checkPhoneCode(auth, "07700900123", "123456")).resolves.toMatchObject({ status: "banned" });
  });

  it("never reads a reply with no session as signed in", async () => {
    const auth = client();
    await expect(checkPhoneCode(auth, "07700900123", "123456")).resolves.toMatchObject({ status: "wrong_code" });
  });

  it("owns a server failure and a thrown one", async () => {
    const broken = client({
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: { status: 500 } }),
    });
    await expect(checkPhoneCode(broken, "07700900123", "123456")).resolves.toEqual({
      status: "error",
      message: PHONE_CODE_CHECK_ERROR_MESSAGE,
    });
    const thrown = client({ verifyOtp: vi.fn().mockRejectedValue(new Error("x")) });
    await expect(checkPhoneCode(thrown, "07700900123", "123456")).resolves.toMatchObject({ status: "error" });
  });

  it("says when the code has been tried too often", async () => {
    const auth = client({
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: { status: 429 } }),
    });
    await expect(checkPhoneCode(auth, "07700900123", "123456")).resolves.toMatchObject({ status: "rate_limited" });
  });
});
