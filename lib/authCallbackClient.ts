import type { AuthCallbackTokens } from "@/lib/authRedirect";

export type AuthSessionEstablishClient<SessionValue> = {
  setSession: (tokens: { access_token: string; refresh_token: string }) => Promise<{
    data: { session: SessionValue | null };
    error: unknown;
  }>;
};

export type AuthCallbackSessionResult<SessionValue> = {
  session: SessionValue | null;
  failed: boolean;
};

/**
 * Establish the session from implicit-flow callback tokens. Normalizes both
 * Supabase errors and network failures for the UI, exactly like the PKCE
 * exchange this replaced.
 */
export async function establishAuthCallbackSession<SessionValue>(
  auth: AuthSessionEstablishClient<SessionValue>,
  tokens: AuthCallbackTokens,
): Promise<AuthCallbackSessionResult<SessionValue>> {
  try {
    const { data, error } = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    return { session: data.session ?? null, failed: Boolean(error) };
  } catch {
    return { session: null, failed: true };
  }
}
