import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import {
  isSocialProvider,
  publicSocialConnection,
  validateManualSocialProfile,
} from "@/lib/socialConnections";
import { createSocialOAuthStart } from "@/lib/socialOAuth";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

type Context = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to connect an account." }, { status: 401 });
  const provider = (await context.params).provider;
  if (!isSocialProvider(provider)) return jsonNoStore({ error: "Unsupported social provider." }, { status: 404 });
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return jsonNoStore({ error: "Malformed request body." }, { status: 400 }); }

  if (body.mode === "manual") {
    const validated = validateManualSocialProfile({
      provider,
      accountKind: body.accountKind === "professional" ? "professional" : "personal",
      profileUrl: body.profileUrl,
    });
    if (!validated.ok) return jsonNoStore({ error: validated.error }, { status: 400 });
    try {
      const row = await socialConnectionStore().saveManual(ownerId, {
        provider: "instagram",
        username: validated.username,
        profileUrl: validated.profileUrl,
      });
      return jsonNoStore({ connection: publicSocialConnection(row) }, { status: 201 });
    } catch {
      return jsonNoStore({ error: "Connected accounts are unavailable." }, { status: 503 });
    }
  }

  try {
    const rateKey = `social-oauth:${ownerId}:${hashIp(clientIp(request))}`;
    if (await isLimited(rateKey, rateKey, 10, 10 * 60_000)) {
      return jsonNoStore({ error: "Too many connection attempts. Try again shortly." }, { status: 429 });
    }
    const origin = process.env.NODE_ENV === "production"
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://pubmaxxing.com").origin
      : new URL(request.url).origin;
    return jsonNoStore(await createSocialOAuthStart({ ownerId, provider, origin }));
  } catch (error) {
    return jsonNoStore({ error: error instanceof Error ? error.message : "OAuth is unavailable." }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return jsonNoStore({ error: "Sign in to disconnect an account." }, { status: 401 });
  const provider = (await context.params).provider;
  if (!isSocialProvider(provider)) return jsonNoStore({ error: "Unsupported social provider." }, { status: 404 });
  try {
    await socialConnectionStore().disconnect(ownerId, provider);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonNoStore({ error: "Connected accounts are unavailable." }, { status: 503 });
  }
}
