import { socialConnectionStore } from "@/lib/socialConnectionStore";
import { isSocialProvider } from "@/lib/socialConnections";
import { completeSocialOAuth } from "@/lib/socialOAuth";
import { assertServerEnv } from "@/lib/serverEnv";
import { siteOrigin } from "@/lib/siteUrl";

assertServerEnv();

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const provider = (await params).provider;
  const requestUrl = new URL(request.url);
  const redirectOrigin = siteOrigin(request.url);
  if (!redirectOrigin) return new Response(null, { status: 500 });
  const destination = new URL("/u/you", redirectOrigin);
  if (!isSocialProvider(provider)) {
    destination.searchParams.set("socialConnection", "unsupported");
    destination.searchParams.set("status", "failed");
    return Response.redirect(destination, 303);
  }
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state || requestUrl.searchParams.has("error")) {
    destination.searchParams.set("socialConnection", provider);
    destination.searchParams.set("status", "cancelled");
    return Response.redirect(destination, 303);
  }
  try {
    const completed = await completeSocialOAuth({ provider, code, state });
    await socialConnectionStore().saveOAuth(completed.ownerId, completed.connection);
    destination.searchParams.set("socialConnection", provider);
    destination.searchParams.set("status", "connected");
  } catch {
    destination.searchParams.set("socialConnection", provider);
    destination.searchParams.set("status", "failed");
  }
  return Response.redirect(destination, 303);
}
