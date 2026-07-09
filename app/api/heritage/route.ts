// POST /api/heritage — "The Landlord" heritage Q&A for one pub.
// Grounded in retrieved facts only; never exposes API keys; never 500s the demo.

import { jsonNoStore } from "@/lib/apiResponses";
import { answerHeritage, NO_STORY_LINE } from "@/lib/heritage";
import { isLimited } from "@/lib/pintDrops";
import { assertProductionSecrets } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

// Heritage does not require Supabase durability, but production still needs
// ADMIN_TOKEN / RATE_LIMIT_SALT so the durable limiter salt is real.
if (process.env.NODE_ENV === "production") assertProductionSecrets();

const MAX_QUESTION_LEN = 300;

// Cost protection: The Landlord fronts a paid OpenRouter call, so this route
// is rate-limited like Pint Drop writes — durable (Supabase RPC) when
// configured, in-memory fallback otherwise. Keyed on the hashed IP (there is
// no contributor handle here), so spend can't be scripted from one machine.
const HERITAGE_RATE_LIMIT = 10;
const HERITAGE_RATE_WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonNoStore({ error: "Malformed JSON." }, { status: 400 });
    }

    const record = (body ?? {}) as Record<string, unknown>;

    const venueName = typeof record.venueName === "string" ? record.venueName.trim() : "";
    if (!venueName) {
      return jsonNoStore({ error: "venueName is required." }, { status: 400 });
    }

    const rawQuestion = typeof record.question === "string" ? record.question.trim() : "";
    if (!rawQuestion) {
      return jsonNoStore({ error: "question is required." }, { status: 400 });
    }
    const question = rawQuestion.slice(0, MAX_QUESTION_LEN);

    const limiterKey = `heritage:${hashIp(clientIp(request))}`;
    if (await isLimited(limiterKey, limiterKey, HERITAGE_RATE_LIMIT, HERITAGE_RATE_WINDOW_MS)) {
      return jsonNoStore({ error: "Too many questions, slow down." }, { status: 429 });
    }

    // Any client-supplied `context` is deliberately ignored — venue context is
    // reconstructed server-side (heritage cache + pub_heritage) so a client
    // cannot forge pub history.
    const venueId = typeof record.venueId === "string" ? record.venueId : undefined;

    const response = await answerHeritage({ venueId, venueName, question });
    return jsonNoStore(response, { status: 200 });
  } catch {
    // Never 500 the demo — degrade to the honest empty-line answer.
    return jsonNoStore({ answer: NO_STORY_LINE, citations: [] }, { status: 200 });
  }
}
