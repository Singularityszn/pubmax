export type AuthCodeExchangeClient<SessionValue> = {
  exchangeCodeForSession: (code: string) => Promise<{
    data: { session: SessionValue | null };
    error: unknown;
  }>;
};

export type AuthCodeExchangeResult<SessionValue> = {
  session: SessionValue | null;
  failed: boolean;
};

/** Normalize both Supabase exchange errors and network failures for the UI. */
export async function exchangeAuthCallbackCode<SessionValue>(
  auth: AuthCodeExchangeClient<SessionValue>,
  code: string,
): Promise<AuthCodeExchangeResult<SessionValue>> {
  try {
    const { data, error } = await auth.exchangeCodeForSession(code);
    return { session: data.session ?? null, failed: Boolean(error) };
  } catch {
    return { session: null, failed: true };
  }
}
