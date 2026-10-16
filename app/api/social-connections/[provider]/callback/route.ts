import { publicApiError } from "@/lib/apiError";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import { isSocialOAuthProvider } from "@/lib/socialConnections";
import {
  completeSocialOAuth,
  SOCIAL_OAUTH_BROWSER_COOKIE,
  socialOAuthBrowserNonceFromCookieHeader,
} from "@/lib/socialOAuth";
import { providerCapability } from "@/lib/socialProviderCapabilities";
import { assertServerEnv } from "@/lib/serverEnv";
import { siteOrigin } from "@/lib/siteUrl";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

assertServerEnv();

/**
 * The end of a flow this browser started: the start's nonce cookie has done its
 * one job (binding the state to this browser), so it is cleared whatever the
 * outcome.
 */
function finishFlow(destination: URL): Response {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.toString(),
      "Set-Cookie": `${SOCIAL_OAUTH_BROWSER_COOKIE}=; Path=/api/social-connections; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const provider = (await params).provider;
  const requestUrl = new URL(request.url);
  const redirectOrigin = siteOrigin(request.url);
  if (!redirectOrigin) return new Response(null, { status: 500 });
  const destination = new URL("/u/you", redirectOrigin);
  // Only an OAuth-capable provider can land here. Every other provider is
  // linked by typing a handle, which never leaves the site.
  if (!isSocialOAuthProvider(provider)) {
    destination.searchParams.set("socialConnection", "unsupported");
    destination.searchParams.set("status", "failed");
    return Response.redirect(destination, 303);
  }
  if (!providerCapability(provider, "oauth_identity")) {
    destination.searchParams.set("socialConnection", provider);
    destination.searchParams.set("status", "failed");
    return Response.redirect(destination, 303);
  }
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state || requestUrl.searchParams.has("error")) {
    destination.searchParams.set("socialConnection", provider);
    destination.searchParams.set("status", "cancelled");
    return finishFlow(destination);
  }
  try {
    // A state is only answered to the browser that started it, so a callback
    // link forwarded to somebody else links nothing.
    const browserNonce = socialOAuthBrowserNonceFromCookieHeader(request.headers.get("cookie"));
    const completed = await completeSocialOAuth({ provider, code, state, browserNonce });
    await socialConnectionStore().saveOAuth(completed.ownerId, completed.connection);
    destination.searchParams.set("socialConnection", provider);
    destination.searchParams.set("status", "connected");
  } catch {
    destination.searchParams.set("socialConnection", provider);
    destination.searchParams.set("status", "failed");
  }
  return finishFlow(destination);
}
