import type { Session } from "@supabase/supabase-js";

export type AccountAuthSnapshot = Readonly<{
  userId: string;
  accessToken: string;
}>;

export type AccountBoundRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function captureAccountAuth(
  expectedUserId: string | null,
  session: Pick<Session, "access_token" | "user"> | null,
): AccountAuthSnapshot | null {
  if (
    !expectedUserId ||
    session?.user.id !== expectedUserId ||
    !session.access_token
  ) {
    return null;
  }
  return {
    userId: expectedUserId,
    accessToken: session.access_token,
  };
}

export async function accountBoundFetch(
  auth: AccountAuthSnapshot | null,
  input: RequestInfo | URL,
  init: RequestInit = {},
  request: AccountBoundRequest = fetch,
): Promise<Response> {
  if (!auth) throw new Error("Authenticated account changed.");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${auth.accessToken}`);
  return request(input, { ...init, headers });
}
