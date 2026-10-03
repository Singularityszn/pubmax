import type { Metadata } from "next";
import { cookies } from "next/headers";

import LoginPage from "@/components/auth/LoginPage";
import {
  ARRIVAL_FROM_PARAM,
  ARRIVAL_INTENT_PARAM,
  LOGIN_ADD_ACCOUNT_PARAM,
  parseAddAccount,
  parseArrivalIntent,
} from "@/lib/arrivalWelcome";
import { AUTH_CALLBACK_MARKER } from "@/lib/authRedirect";
import { AUTH_RESUME_COOKIE } from "@/lib/authSessionResume";
import { loginPageHasSessionHint } from "@/lib/loginPageFraming";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to PUBMAXXING with email or a social account. Save prices, claim a handle, keep your nights.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

type RouteSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The chosen door, the page to return to and whether this is a SECOND account
 * are read on the server, so /login?mode=signup is a real destination that
 * renders as the sign-up door on first paint, and a nav hand-off (?from=/map)
 * needs no client round trip.
 */
export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const jar = await cookies();
  // The resume cookie is HttpOnly. Its value is a refresh token, so only the
  // boolean leaves this function: the browser never receives the cookie body.
  const sessionHint = loginPageHasSessionHint({
    resumeCookie: jar.get(AUTH_RESUME_COOKIE)?.value,
    authCallback: first(params[AUTH_CALLBACK_MARKER]),
    authError: first(params.authError),
  });
  return (
    <LoginPage
      initialIntent={parseArrivalIntent(first(params[ARRIVAL_INTENT_PARAM]))}
      from={first(params[ARRIVAL_FROM_PARAM])}
      addAccount={parseAddAccount(first(params[LOGIN_ADD_ACCOUNT_PARAM]))}
      sessionHint={sessionHint}
    />
  );
}
