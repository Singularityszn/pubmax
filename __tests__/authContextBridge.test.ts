import { describe, expect, it, vi } from "vitest";
import { createAuthContextBridge } from "@/lib/authContextBridge";

function setup() {
  const owner = new AbortController();
  const cancel = vi.fn();
  const bridge = createAuthContextBridge({ configured: true, clerkIntegrationConfigured: false }, {
    cancelPending: cancel, accountSignal: () => owner.signal,
  });
  const email = vi.fn(async () => ({ status: "sent" as const }));
  const attached = vi.fn(async () => true);
  const runtime = { ...bridge.read(), signInWithEmail: email, waitForAuthRuntime: attached };
  return { bridge, owner, cancel, email, attached, runtime };
}

describe("the auth context while its runtime loads", () => {
  it("keeps identity unknown and forms configured before a runtime exists", () => {
    const { bridge } = setup();
    expect(bridge.read()).toMatchObject({ configured: true, loading: true, user: null, identityResolved: false,
      providerAuthState: "unresolved", supabaseAuthState: "unresolved" });
  });

  it("forwards a pending submission once the runtime commits", async () => {
    const { bridge, email, runtime } = setup();
    const proxy = bridge.read().signInWithEmail;
    const pending = proxy("person@example.test", "/map");
    expect(email).not.toHaveBeenCalled();
    bridge.publish(runtime);
    expect(await pending).toEqual({ status: "sent" });
    expect(email).toHaveBeenCalledExactlyOnceWith("person@example.test", "/map");
    expect(bridge.read().signInWithEmail).toBe(proxy);
  });

  it("cancels synchronously and never revives a pending start", async () => {
    const { bridge, cancel, email, runtime } = setup();
    const pending = bridge.read().signInWithEmail("person@example.test");
    bridge.read().cancelAuthAttempt({ keepEmailLink: true });
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ keepEmailLink: true });
    bridge.publish(runtime);
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(email).not.toHaveBeenCalled();
  });

  it("allows only the latest start requested while loading", async () => {
    const { bridge, email, runtime } = setup();
    const obsolete = bridge.read().signInWithEmail("old@example.test");
    const latest = bridge.read().signInWithEmail("new@example.test");
    bridge.publish(runtime);
    expect(await obsolete).toMatchObject({ status: "cancelled" });
    expect(await latest).toMatchObject({ status: "sent" });
    expect(email).toHaveBeenCalledExactlyOnceWith("new@example.test", undefined);
  });

  it("cannot run a pending start for a departed account", async () => {
    const { bridge, owner, email, runtime } = setup();
    const pending = bridge.read().signInWithEmail("person@example.test");
    owner.abort();
    bridge.publish(runtime);
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(email).not.toHaveBeenCalled();
  });

  it.each(["fail", "dispose"] as const)("settles pending work when loading ends through %s", async (end) => {
    const { bridge, email, runtime } = setup();
    const pending = bridge.read().signInWithEmail("person@example.test");
    const directInstall = bridge.read().waitForAuthRuntime!();
    bridge[end]();
    bridge.publish(runtime);
    expect(await pending).toMatchObject({ status: end === "fail" ? "error" : "cancelled" });
    expect(await directInstall).toBe(false);
    expect(email).not.toHaveBeenCalled();
  });

  it("waits for the runtime subscription before a direct session installation", async () => {
    const { bridge, runtime, attached } = setup();
    let finish!: (ready: boolean) => void;
    attached.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const pending = bridge.read().waitForAuthRuntime!();
    bridge.publish(runtime);
    await vi.waitFor(() => expect(attached).toHaveBeenCalledOnce());
    finish(true);
    expect(await pending).toBe(true);
  });
});
