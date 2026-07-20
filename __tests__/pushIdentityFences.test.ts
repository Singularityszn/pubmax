import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("push identity security fences", () => {
  it("never trusts client-supplied account, member, or Plan identity", () => {
    const accountRoute = read("app/api/push-tokens/account/route.ts");
    const planRoute = read("app/api/plans/[id]/push-tokens/route.ts");
    expect(accountRoute).toMatch(/callerAuthSessionIdentity\(request\)/);
    expect(accountRoute).toMatch(/getByUserId\(identity\.id\)/);
    expect(accountRoute).not.toMatch(/body\.(?:userId|accountUserId)/);
    expect(planRoute).toMatch(/planMemberCapability\(request, body\.memberToken\)/);
    expect(planRoute).toMatch(/planMemberIdentityResult\(planId, capability\)/);
    expect(planRoute).not.toMatch(/body\.(?:memberId|planId)/);
  });

  it("keeps targeted delivery dormant even though the private query exists", () => {
    const sender = read("lib/pushSender.ts");
    const store = read("lib/pushTokenStore.ts");
    expect(store).toMatch(/listForPlan\(planId: string\)/);
    expect(store).toMatch(/push_tokens!inner\(token,platform,created_at,last_seen_at\)/);
    expect(store).not.toMatch(/\.in\("token"/);
    expect(sender).not.toMatch(/pushTokenStore\(\)\.listForPlan\(/);
    expect(sender).toMatch(/async function resolvePlanTokens[\s\S]*?return \[\];/);
  });

  it("unlinks person targeting before invalidating the local auth session", () => {
    const provider = read("components/auth/AuthProvider.tsx");
    const unlink = provider.indexOf("await unlinkPushInstallationFromClaimedAccount()");
    const signOut = provider.indexOf("await supabase.auth.signOut({ scope: \"local\" });", unlink);
    expect(unlink).toBeGreaterThan(-1);
    expect(signOut).toBeGreaterThan(unlink);
  });

  it("remembers delivery material only after anonymous registration succeeds", () => {
    for (const file of ["lib/nativePush.ts", "lib/webPush.ts"]) {
      const source = read(file);
      expect(source).toMatch(/if \(response\.ok\) rememberPushRegistration/);
    }
    const client = read("lib/pushIdentityClient.ts");
    expect(client).not.toMatch(/(?:localStorage|sessionStorage)\.(?:setItem|getItem)/);
  });

  it("recovers older native tokens without ever requesting OS permission", () => {
    const native = read("lib/nativePush.ts");
    const refresh = native.slice(native.indexOf("async function recoverExistingNativePushRegistration"));
    expect(refresh).toMatch(/checkPermissions\(\)/);
    expect(refresh).not.toMatch(/requestPermissions\(\)/);
  });

  it("uses bounded push I/O and a versioned sync marker", () => {
    const client = read("lib/pushIdentityClient.ts");
    const native = read("lib/nativePush.ts");
    const web = read("lib/webPush.ts");
    const provider = read("components/auth/AuthProvider.tsx");
    expect(client).toMatch(/withPushTimeout\(navigator\.serviceWorker\.ready\)/);
    expect(client).toMatch(/pushFetch\("\/api\/push-tokens\/account"/);
    expect(native).toMatch(/pushFetch\("\/api\/push-tokens"/);
    expect(web).toMatch(/withPushTimeout\(navigator\.serviceWorker\.ready\)/);
    expect(web).toMatch(/pushFetch\("\/api\/push-tokens"/);
    expect(provider).toContain("pubmax_identity_synced_user_push_v2_0047");
    expect(provider).not.toMatch(/const SYNCED_USER_KEY = "pubmax_identity_synced_user"/);
    const logout = provider.slice(provider.indexOf("const signOut = useCallback"));
    expect(logout).toMatch(/unlinkPushInstallationFromClaimedAccount/);
    expect(logout).not.toMatch(/recoverNativePushRegistration/);
  });
});
