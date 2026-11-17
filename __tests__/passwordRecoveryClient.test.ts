import { AuthApiError, type Session } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { passwordRecoveryFinisher } from "@/lib/passwordRecoveryClient";
import { recoveryFormTransition, recoveryToken } from "@/lib/passwordRecovery";

const session: Session = {
  access_token: "recovery-access", refresh_token: "recovery-refresh", expires_in: 3600, token_type: "bearer",
  user: { id: "owner", aud: "authenticated", created_at: "2026-11-17T00:00:00Z", app_metadata: {}, user_metadata: {} },
};

function fixture() {
  type Auth = Parameters<typeof passwordRecoveryFinisher>[0];
  return {
    verifyOtp: vi.fn<Auth["verifyOtp"]>().mockResolvedValue({ data: { session, user: session.user }, error: null }),
    updateUser: vi.fn<Auth["updateUser"]>().mockResolvedValue({ data: { user: session.user }, error: null }),
    signOut: vi.fn<Auth["signOut"]>().mockResolvedValue({ error: null }),
    getSession: vi.fn<Auth["getSession"]>().mockResolvedValue({ data: { session }, error: null }),
  };
}

it("refuses a weak password without consuming the recovery proof", async () => {
  const auth = fixture();
  expect(await passwordRecoveryFinisher(auth, "token")("weak")).toMatchObject({ status: "retry", passwordSaved: false });
  expect(auth.verifyOtp).not.toHaveBeenCalled();
  expect(auth.updateUser).not.toHaveBeenCalled();
});

it("cannot change a password with an expired or reused link", async () => {
  const auth = fixture();
  auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: new AuthApiError("expired", 403, "otp_expired") });
  expect(await passwordRecoveryFinisher(auth, "token")("London123!")).toEqual({ status: "invalid" });
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("keeps a verified session private and retries session revocation without resetting again", async () => {
  const auth = fixture();
  auth.signOut.mockResolvedValueOnce({ error: new AuthApiError("unavailable", 503, "unexpected_failure") });
  const finish = passwordRecoveryFinisher(auth, "token");
  const first = await finish("London123!");
  expect(first).toMatchObject({ status: "retry", passwordSaved: true });
  expect(first).not.toHaveProperty("session");
  expect(await finish("")).toEqual({ status: "saved", session });
  expect(auth.updateUser).toHaveBeenCalledTimes(1);
  expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  expect(auth.signOut).toHaveBeenLastCalledWith({ scope: "others" });
});

it("allows a corrected password after GoTrue refuses the first one", async () => {
  const auth = fixture();
  auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error: new AuthApiError("same", 422, "same_password") });
  const finish = passwordRecoveryFinisher(auth, "token");
  expect(await finish("London123!")).toMatchObject({ status: "retry", passwordSaved: false });
  expect(await finish("London456!")).toMatchObject({ status: "saved" });
  expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
});

it("accepts one recovery proof and rejects duplicate or malformed proofs", () => {
  const token = "a".repeat(56);
  expect(recoveryToken(`#token_hash=${token}`)).toBe(token);
  expect(recoveryToken(`#token_hash=${token}&token_hash=${token}`)).toBeNull();
  expect(recoveryToken("#token_hash=invalid")).toBeNull();
});

it("keeps the saved password locked while session cleanup needs another attempt", () => {
  const pending = recoveryFormTransition({ status: "busy" }, { type: "failed", message: "retry", passwordSaved: true });
  expect(pending).toEqual({ status: "securing", error: "retry" });
  expect(recoveryFormTransition({ status: "complete" }, { type: "submit" })).toEqual({ status: "complete" });
});

it.each(["unmount", "replacement"])("does not start a password update when %s cancels pending verification", async () => {
  const auth = fixture();
  let release!: (value: Awaited<ReturnType<typeof auth.verifyOtp>>) => void;
  auth.verifyOtp.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  let current = true;
  const finish = passwordRecoveryFinisher(auth, "token");
  const result = finish("London123!", () => current);
  current = false;
  release({ data: { session, user: session.user }, error: null });
  expect(await result).toMatchObject({ status: "retry", passwordSaved: false });
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("does not start revocation after cancellation during an already-sent password update", async () => {
  const auth = fixture();
  let release!: (value: Awaited<ReturnType<typeof auth.updateUser>>) => void;
  let reached!: () => void;
  const updating = new Promise<void>(resolve => { reached = resolve; });
  auth.updateUser.mockImplementation(() => { reached(); return new Promise(resolve => { release = resolve; }); });
  let current = true;
  const result = passwordRecoveryFinisher(auth, "token")("London123!", () => current);
  await updating;
  current = false;
  release({ data: { user: session.user }, error: null });
  expect(await result).toMatchObject({ status: "retry", passwordSaved: true });
  expect(auth.signOut).not.toHaveBeenCalled();
});
