import { afterEach, expect, it, vi } from "vitest";

const reset = vi.hoisted(() => vi.fn());
const report = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { resetPasswordForEmail: reset } }) }));
vi.mock("@/lib/log", () => ({ log: report }));
import { sendPasswordRecoveryEmail } from "@/lib/passwordRecovery.server";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("raises the existing error alert contract for delivery refusal without account or provider message data", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery-email-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_recovery_email");
  reset.mockResolvedValue({ error: { code: "captcha_failed", status: 400, message: "Private email and recovery proof" } });
  await sendPasswordRecoveryEmail("private@example.test", "https://pubmaxxing.com/auth/forgot-password");
  expect(report).toHaveBeenCalledWith("error", "auth.password_recovery.delivery_refused", { code: "captcha_failed", status: 400 });
});

it.each([{ status: 429, code: "rate_limit" }, { status: 400, code: "over_email_send_rate_limit" }, { status: 400, code: "over_request_rate_limit" }])("does not raise an operator alert for an expected provider throttle: %j", async error => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery-email-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_recovery_email");
  reset.mockResolvedValue({ error });
  await sendPasswordRecoveryEmail("private@example.test", "https://pubmaxxing.com/auth/forgot-password");
  expect(report).toHaveBeenCalledWith("warn", "auth.password_recovery.delivery_refused", error);
});

it.each(["validation_failed", "email_address_invalid"])("does not alert for an address the public provider rejects: %s", async code => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://recovery-email-test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_recovery_email");
  reset.mockResolvedValue({ error: { code, status: 400 } });
  await sendPasswordRecoveryEmail("a,b@example.test", "https://pubmaxxing.com/auth/forgot-password");
  expect(report).toHaveBeenCalledWith("warn", "auth.password_recovery.delivery_refused", { code, status: 400 });
});
